const express = require('express')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { io } = require('socket.io-client')
const { mergeKnowledgeFoldersMany } = require('./src/knowledge-merge')
const { registerSupportRoutes } = require('./src/routes')
const { systemHealth: buildSystemHealth } = require('./src/health')
process.env.TZ ||= 'Europe/Amsterdam'

const HUB_PORT = Number(process.env.HUB_PORT || 3100)
const HUB_HOST = process.env.HUB_HOST || '0.0.0.0'
const LOCAL_HOST = '127.0.0.1'
const portableRoot = path.dirname(__dirname)
const configRoot = path.join(portableRoot, 'Config')
const dataRoot = path.join(portableRoot, 'Data')
const settingsFile = path.join(configRoot, 'settings.json')
const portsFile = path.join(configRoot, 'ports.json')
const legacySettingsFile = path.join(__dirname, 'hub-settings.json')
const mergedRoot = path.join(dataRoot, 'knowledge', 'merged')
const logsRoot = path.join(portableRoot, 'Logs', 'hub')
const updateBackupsRoot = path.join(dataRoot, 'backups', 'update-backups')
const startupBackupsRoot = path.join(dataRoot, 'backups', 'startup')
const configBackupsRoot = path.join(dataRoot, 'backups', 'config')
const botsRoot = path.join(portableRoot, 'Bots')
const discordBridgeRoot = path.join(portableRoot, 'minecraft-discord-bot')
const discordBridgeFile = path.join(discordBridgeRoot, 'index.js')
const discordEnvFile = path.join(discordBridgeRoot, '.env')
const discordPidFile = path.join(discordBridgeRoot, 'discord-bridge.pid')
const discordOutLog = path.join(portableRoot, 'Logs', 'discord-bridge.out.log')
const discordErrLog = path.join(portableRoot, 'Logs', 'discord-bridge.err.log')
const runningBots = new Map()
const telemetrySockets = new Map()
const botPortBase = 3110
const botPortStep = 2
const perBotBackupLimit = 5
const supportedMinecraftVersions = ['1.21.11', '1.21.9', '1.21.8', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20', '1.19.4', '1.19.3', '1.19.2', '1.19', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.8', '1.7']
const crashWindowMs = 10 * 60 * 1000
const crashWindowLimit = 5
const defaultPresets = [
  { id: 'survival', name: 'Survival', commands: ['ai stop', 'ai auto progression'], delayMs: 1000, builtIn: true },
  { id: 'miner', name: 'Miner', commands: ['ai stop', 'ai auto mine'], delayMs: 1000, builtIn: true },
  { id: 'explorer', name: 'Explorer', commands: ['ai stop', 'ai explore'], delayMs: 1000, builtIn: true },
  { id: 'pvp', name: 'PvP', commands: ['ai stop', 'ai pvp', 'ai auto combat'], delayMs: 1000, builtIn: true },
  { id: 'guard', name: 'Guard', commands: ['ai stop', 'ai guard {player}'], delayMs: 1000, requiresPlayer: true, builtIn: true }
]

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return env
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function localStamp(date = new Date(), separator = ' ') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const time = `${parts.hour}${parts.minute}${parts.second}`
  const day = `${parts.day}${parts.month}${parts.year}`
  return `${time}${separator}${day}`
}

function localStampFile(date = new Date()) {
  return localStamp(date, '-')
}

function normalizePort(value, fallback) {
  const port = Math.floor(Number(value))
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

function normalizeHostAndPort(hostValue, portValue) {
  const rawHost = String(hostValue || '').trim()
  const combined = rawHost.match(/^(.+):(\d{1,5})$/)
  return {
    host: combined ? combined[1] : rawHost,
    port: normalizePort(combined ? combined[2] : portValue, 25565)
  }
}

function normalizeMinecraftVersion(value, fallback = '1.21.4') {
  const version = String(value || '').trim()
  return supportedMinecraftVersions.includes(version) ? version : fallback
}

function normalizeServerProfile(profile) {
  const server = normalizeHostAndPort(profile?.host, profile?.port)
  const name = String(profile?.name || 'Server').trim().slice(0, 80) || 'Server'
  return {
    id: String(profile?.id || crypto.randomUUID()).trim().slice(0, 80) || crypto.randomUUID(),
    name,
    host: server.host || 'localhost',
    port: server.port,
    version: normalizeMinecraftVersion(profile?.version, '1.21.4')
  }
}

function normalizePreset(preset, fallbackId = crypto.randomUUID()) {
  const commands = Array.isArray(preset?.commands)
    ? preset.commands.map(command => String(command || '').trim()).filter(Boolean).slice(0, 12)
    : []
  const delayMs = Math.max(0, Math.min(10000, Math.floor(Number(preset?.delayMs || 0))))
  return {
    id: String(preset?.id || fallbackId).trim().slice(0, 80) || fallbackId,
    name: String(preset?.name || 'Custom preset').trim().slice(0, 80) || 'Custom preset',
    commands,
    delayMs,
    requiresPlayer: Boolean(preset?.requiresPlayer || commands.some(command => command.includes('{player}'))),
    builtIn: Boolean(preset?.builtIn)
  }
}

function validateBotFolder(folderValue) {
  const raw = String(folderValue || '').trim()
  const folder = path.resolve(path.isAbsolute(raw) ? raw : path.join(__dirname, raw))
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Bot folder does not exist.')
  if (!fs.existsSync(path.join(folder, 'bot.js'))) throw new Error('The selected folder does not contain bot.js.')
  return folder
}

function resolvedBotFolder(bot) {
  if (String(bot.folder).startsWith('@/')) return path.resolve(portableRoot, String(bot.folder).slice(2))
  return path.resolve(path.isAbsolute(bot.folder) ? bot.folder : path.join(__dirname, bot.folder))
}

function portablePath(folder) {
  const relative = path.relative(portableRoot, path.resolve(folder))
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `@/${relative}` : path.resolve(folder)
}

function nextPorts(bots) {
  const used = new Set(bots.flatMap(bot => [bot.hudPort, bot.viewerPort].map(Number)))
  let hudPort = botPortBase
  while (used.has(hudPort) || used.has(hudPort + 1) || hudPort === HUB_PORT || hudPort + 1 === HUB_PORT) hudPort += botPortStep
  return { hudPort, viewerPort: hudPort + 1 }
}

function compactBotPorts(bots) {
  let hudPort = botPortBase
  for (const bot of bots) {
    if (hudPort === HUB_PORT || hudPort + 1 === HUB_PORT) hudPort += botPortStep
    bot.hudPort = hudPort
    bot.viewerPort = hudPort + 1
    hudPort += botPortStep
  }
  return bots
}

function writePortsConfig() {
  const bots = {}
  for (const bot of settings?.bots || []) {
    bots[bot.name] = {
      hud: normalizePort(bot.hudPort, botPortBase),
      viewer: normalizePort(bot.viewerPort, botPortBase + 1)
    }
  }
  fs.mkdirSync(path.dirname(portsFile), { recursive: true })
  fs.writeFileSync(portsFile, `${JSON.stringify({ hub: HUB_PORT, bots }, null, 2)}\n`, 'utf8')
}

function botFromFolder(folder, existingBots = []) {
  const botSettings = readJson(path.join(folder, 'bot-settings.json'), {})
  const ports = nextPorts(existingBots)
  return {
    id: crypto.randomUUID(),
    name: path.basename(folder),
    folder: portablePath(folder),
    host: String(botSettings.host || 'localhost'),
    port: normalizePort(botSettings.port, 25565),
    version: normalizeMinecraftVersion(botSettings.version, '1.21.4'),
    hudPort: ports.hudPort,
    viewerPort: ports.viewerPort,
    group: 'Ungrouped',
    autoRestart: true,
    disabledUntil: null,
    stats: { starts: 0, crashes: 0, totalRuntimeMs: 0, lastExit: null, lastError: '' }
  }
}

function findBotFolders(rootValue) {
  const root = path.resolve(String(rootValue || '').trim())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Folder does not exist.')
  const found = []
  const ignored = new Set(['node_modules', '.git', 'knowledge', 'worlds', 'backups', 'logs', 'merged-knowledge'])
  const visit = (folder, depth) => {
    if (found.length >= 100 || depth > 4) return
    try {
      if (fs.existsSync(path.join(folder, 'bot.js'))) {
        found.push(folder)
        return
      }
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.')) visit(path.join(folder, entry.name), depth + 1)
      }
    } catch {}
  }
  visit(root, 0)
  return found
}

function normalizeBot(bot) {
  const folder = String(bot.folder || '').startsWith('@/')
    ? path.resolve(portableRoot, String(bot.folder).slice(2))
    : path.resolve(path.isAbsolute(String(bot.folder || '')) ? String(bot.folder || '') : path.join(__dirname, String(bot.folder || '')))
  const server = normalizeHostAndPort(bot.host, bot.port)
  return {
    id: String(bot.id || crypto.randomUUID()),
    name: String(bot.name || path.basename(folder || 'Minecraft AI')).trim().slice(0, 80) || 'Minecraft AI',
    folder: portablePath(folder),
    host: server.host || 'localhost',
    port: server.port,
    version: normalizeMinecraftVersion(bot.version, '1.21.4'),
    hudPort: normalizePort(bot.hudPort, botPortBase),
    viewerPort: normalizePort(bot.viewerPort, botPortBase + 1),
    group: String(bot.group || 'Ungrouped').trim().slice(0, 60) || 'Ungrouped',
    autoRestart: bot.autoRestart !== false,
    disabledUntil: bot.disabledUntil || null,
    stats: {
      starts: 0,
      crashes: 0,
      totalRuntimeMs: 0,
      lastExit: null,
      lastError: '',
      recentCrashes: [],
      ...(bot.stats || {})
    }
  }
}

function loadSettings() {
  const loaded = readJson(settingsFile, readJson(legacySettingsFile, {}))
  const bots = compactBotPorts(Array.isArray(loaded.bots) ? loaded.bots.map(normalizeBot) : [])
  const customPresets = Array.isArray(loaded.presets)
    ? loaded.presets.map(preset => normalizePreset({ ...preset, builtIn: false })).filter(preset => preset.commands.length && !defaultPresets.some(item => item.id === preset.id))
    : []
  return {
    bots,
    groups: Array.isArray(loaded.groups) ? loaded.groups : [],
    serverProfiles: Array.isArray(loaded.serverProfiles) ? loaded.serverProfiles.map(normalizeServerProfile) : [],
    schedules: Array.isArray(loaded.schedules) ? loaded.schedules : [],
    presets: [...defaultPresets, ...customPresets],
    mergeHistory: Array.isArray(loaded.mergeHistory) ? loaded.mergeHistory : [],
    viewerLayout: {
      columns: [1, 2, 3, 4].includes(Number(loaded.viewerLayout?.columns)) ? Number(loaded.viewerLayout.columns) : 2,
      order: Array.isArray(loaded.viewerLayout?.order) ? loaded.viewerLayout.order.map(String) : [],
      hidden: Array.isArray(loaded.viewerLayout?.hidden) ? loaded.viewerLayout.hidden.map(String) : []
    }
  }
}

let settings = loadSettings()

function saveSettings() {
  cleanupViewerLayout()
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  const temp = `${settingsFile}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, settingsFile)
  writePortsConfig()
}
saveSettings()

function cleanupViewerLayout() {
  if (!settings?.viewerLayout) return
  const ids = new Set((settings.bots || []).map(bot => bot.id))
  settings.viewerLayout.order = (settings.viewerLayout.order || []).filter(id => ids.has(id))
  settings.viewerLayout.hidden = (settings.viewerLayout.hidden || []).filter(id => ids.has(id))
}

function pruneOldDirectories(root, keep = perBotBackupLimit) {
  if (!fs.existsSync(root)) return 0
  const folders = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const folder = path.join(root, entry.name)
      return { folder, mtimeMs: fs.statSync(folder).mtimeMs }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  let removed = 0
  for (const entry of folders.slice(Math.max(0, keep))) {
    fs.rmSync(entry.folder, { recursive: true, force: true })
    removed++
  }
  return removed
}

function cleanupBotBackups() {
  let removed = 0
  for (const bot of settings.bots || []) {
    const folder = resolvedBotFolder(bot)
    removed += pruneOldDirectories(path.join(folder, 'backups'), perBotBackupLimit)
    removed += pruneOldDirectories(path.join(folder, 'knowledge-backups'), perBotBackupLimit)
    removed += pruneOldDirectories(path.join(updateBackupsRoot, bot.id), perBotBackupLimit)
  }
  return removed
}

function cleanupStaleHubLogs() {
  if (!fs.existsSync(logsRoot)) return 0
  const ids = new Set((settings.bots || []).map(bot => bot.id))
  let removed = 0
  for (const entry of fs.readdirSync(logsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue
    const id = entry.name.replace(/\.log$/i, '')
    if (/^[0-9a-f-]{36}$/i.test(id) && !ids.has(id)) {
      fs.rmSync(path.join(logsRoot, entry.name), { force: true })
      removed++
    }
  }
  return removed
}

function runMaintenance() {
  return {
    botBackupsRemoved: cleanupBotBackups(),
    staleLogsRemoved: cleanupStaleHubLogs()
  }
}
setTimeout(() => {
  try {
    const result = runMaintenance()
    if (result.botBackupsRemoved || result.staleLogsRemoved) console.log('Maintenance cleanup:', result)
  } catch (err) {
    console.log('Maintenance cleanup skipped:', err.message)
  }
}, 1000)

function processAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

function botPauseMs(bot) {
  const until = bot.disabledUntil ? Date.parse(bot.disabledUntil) : 0
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0
}

function recordBotCrash(bot, message) {
  const now = Date.now()
  bot.stats.recentCrashes = Array.isArray(bot.stats.recentCrashes) ? bot.stats.recentCrashes : []
  bot.stats.recentCrashes = bot.stats.recentCrashes
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value) && now - value < crashWindowMs)
    .map(value => new Date(value).toISOString())
  bot.stats.recentCrashes.push(new Date(now).toISOString())
  bot.stats.crashes = (bot.stats.crashes || 0) + 1
  bot.stats.lastError = message
  if (bot.stats.recentCrashes.length >= crashWindowLimit) {
    bot.disabledUntil = new Date(now + crashWindowMs).toISOString()
    bot.stats.lastError = `Paused after ${crashWindowLimit} crashes in 10 minutes.`
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.killed) return resolve(true)
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function killPidTree(pid) {
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    let output = ''
    let error = ''
    killer.stdout.on('data', chunk => { output += chunk })
    killer.stderr.on('data', chunk => { error += chunk })
    killer.once('exit', code => {
      if (code === 0) resolve(output.trim())
      else reject(new Error(error.trim() || output.trim() || `taskkill exited with code ${code}`))
    })
  })
}

function portListening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: LOCAL_HOST, port })
    const finish = result => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(1200)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function portOwnerPid(port) {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    const netstat = spawn('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true })
    let output = ''
    netstat.stdout.on('data', chunk => { output += chunk })
    netstat.once('error', () => resolve(null))
    netstat.once('exit', () => {
      const suffix = `:${Number(port)}`
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 5 && parts[1]?.endsWith(suffix) && parts[3] === 'LISTENING') {
          const pid = Number(parts[4])
          return resolve(Number.isInteger(pid) && pid > 0 ? pid : null)
        }
      }
      resolve(null)
    })
  })
}

function botRootPid(pid) {
  if (process.platform !== 'win32' || !pid) return Promise.resolve(pid || null)
  const script = [
    `$currentId=${Number(pid)}`,
    '$rootId=$currentId',
    'while ($currentId -gt 0) {',
    '  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$currentId" -ErrorAction SilentlyContinue',
    '  if (-not $process) { break }',
    '  if ($process.CommandLine -match "bot\\.js") { $rootId=$currentId }',
    '  $currentId=[int]$process.ParentProcessId',
    '}',
    'Write-Output $rootId'
  ].join('; ')
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.once('error', () => resolve(pid))
    child.once('exit', () => {
      const root = Number(output.trim().split(/\r?\n/).pop())
      resolve(Number.isInteger(root) && root > 0 ? root : pid)
    })
  })
}

async function botStatus(bot) {
  const runtime = runningBots.get(bot.id)
  if (runtime && !processAlive(runtime.pid)) runningBots.delete(bot.id)
  const managed = runningBots.get(bot.id)
  const telemetry = telemetrySockets.get(bot.id)
  const telemetryFresh = telemetry?.receivedAt && Date.now() - Date.parse(telemetry.receivedAt) < 20000
  const [hudOnline, viewerOnline] = await Promise.all([portListening(bot.hudPort), portListening(bot.viewerPort)])
  const effectiveHudOnline = Boolean(hudOnline || telemetryFresh || managed)
  return {
    running: Boolean(managed) || effectiveHudOnline,
    managed: Boolean(managed),
    pid: managed?.pid || null,
    startedAt: managed?.startedAt || null,
    pausedUntil: bot.disabledUntil || null,
    pausedMs: botPauseMs(bot),
    hudOnline: effectiveHudOnline,
    viewerOnline
  }
}

function ensureTelemetry(bot) {
  const current = telemetrySockets.get(bot.id)
  if (current?.port === bot.hudPort) return current
  if (current) current.socket.close()

  const entry = { port: bot.hudPort, data: null, receivedAt: null, socket: null }
  const socket = io(`http://127.0.0.1:${bot.hudPort}`, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 3000,
    timeout: 1200
  })
  entry.socket = socket
  socket.on('update', data => {
    entry.data = {
      connected: Boolean(data?.connected),
      health: data?.health ?? null,
      food: data?.food ?? null,
      mode: data?.mode ?? 'unknown',
      autonomy: Boolean(data?.autonomy?.enabled),
      pvp: Boolean(data?.pvp),
      xp: data?.xp ?? 0,
      position: data?.position ?? null,
      chatHistory: Array.isArray(data?.chatHistory) ? data.chatHistory.slice(0, 80) : [],
      username: data?.botUsername ||
        data?.chatHistory?.find(entry => entry?.role === 'ai')?.author ||
        data?.botSettings?.username ||
        null
    }
    entry.receivedAt = new Date().toISOString()
  })
  telemetrySockets.set(bot.id, entry)
  return entry
}

function sendToBots(botIds, text) {
  const message = String(text || '').trim()
  if (!message) throw new Error('Enter a message or AI command.')
  if (message.length > 256) throw new Error('Messages and commands may contain at most 256 characters.')
  const ids = [...new Set((botIds || []).map(String))]
  const targets = ids.length ? settings.bots.filter(bot => ids.includes(bot.id)) : settings.bots
  if (!targets.length) throw new Error('No bots were selected.')
  const sent = []
  const skipped = []
  for (const bot of targets) {
    const telemetry = ensureTelemetry(bot)
    if (!telemetry.socket.connected || telemetry.data?.connected !== true) {
      skipped.push(bot.name)
      continue
    }
    telemetry.socket.emit('command', message)
    sent.push(bot.name)
  }
  return { sent, skipped, message }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function applyPreset(request) {
  const preset = settings.presets.find(item => item.id === String(request?.presetId || ''))
  if (!preset) throw new Error('Preset was not found.')
  const playerName = String(request?.player || '').trim()
  if (preset.requiresPlayer && !/^[A-Za-z0-9_]{1,16}$/.test(playerName)) throw new Error('This preset needs a valid Minecraft player name.')
  let targets = []
  if (request?.targetType === 'all') {
    targets = settings.bots
  } else if (request?.targetType === 'group') {
    const group = String(request?.group || '')
    targets = settings.bots.filter(bot => bot.group === group)
  } else {
    const ids = new Set(Array.isArray(request?.botIds) ? request.botIds.map(String) : [])
    targets = settings.bots.filter(bot => ids.has(bot.id))
  }
  if (!targets.length) throw new Error('Choose at least one preset target.')

  const commands = preset.commands.map(command => command.replaceAll('{player}', playerName))
  const results = []
  const skipped = new Set()
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index]
    const result = sendToBots(targets.map(bot => bot.id), command)
    results.push({ command, sent: result.sent, skipped: result.skipped })
    for (const name of result.skipped) skipped.add(name)
    if (index < commands.length - 1 && preset.delayMs > 0) await wait(preset.delayMs)
  }
  return {
    preset: preset.name,
    commands,
    sent: [...new Set(results.flatMap(result => result.sent))],
    skipped: [...skipped],
    results
  }
}

function mergedKnowledgeList() {
  if (!fs.existsSync(mergedRoot)) return []
  return fs.readdirSync(mergedRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const folder = path.join(mergedRoot, entry.name)
      const files = fs.readdirSync(folder).filter(name => name.endsWith('.json')).sort()
      return {
        id: entry.name,
        folder,
        files,
        fileCount: files.length,
        createdAt: fs.statSync(folder).birthtime.toISOString()
      }
    })
    .filter(entry => entry.fileCount)
    .sort((left, right) => right.id.localeCompare(left.id))
}

function copyKnowledgeExact(source, target) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('Merged knowledge folder does not exist.')
  fs.mkdirSync(target, { recursive: true })
  for (const name of fs.readdirSync(target)) {
    const file = path.join(target, name)
    if (fs.statSync(file).isFile() && name.endsWith('.json')) fs.unlinkSync(file)
  }
  for (const name of fs.readdirSync(source)) {
    const file = path.join(source, name)
    if (!fs.statSync(file).isFile() || !name.endsWith('.json')) continue
    fs.copyFileSync(file, path.join(target, name))
  }
}

function tailLog(bot, search = '') {
  const file = path.join(logsRoot, `${bot.id}.log`)
  if (!fs.existsSync(file)) return []
  const query = String(search || '').toLowerCase()
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => line && (!query || line.toLowerCase().includes(query))).slice(-300)
}

function tailFile(file, lines = 80) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines)
}

function parseChannelMap(value) {
  return String(value || '').split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const index = entry.includes(':') ? entry.indexOf(':') : entry.indexOf('=')
    if (index <= 0) return null
    const channelId = entry.slice(0, index).trim()
    const botId = entry.slice(index + 1).trim()
    const bot = settings.bots.find(item => item.id === botId || item.name === botId)
    return { channelId, botId, botName: bot?.name || botId }
  }).filter(Boolean)
}

function discordBridgeStatus() {
  const env = readEnv(discordEnvFile)
  const pid = fs.existsSync(discordPidFile) ? Number(fs.readFileSync(discordPidFile, 'utf8').trim()) : 0
  const outLines = tailFile(discordOutLog, 80)
  const errLines = tailFile(discordErrLog, 80)
  const lastError = errLines.slice().reverse().find(line => line && !/^Node\.js/i.test(line)) || ''
  return {
    installed: fs.existsSync(discordBridgeFile),
    running: processAlive(pid),
    pid: processAlive(pid) ? pid : null,
    prefix: env.DISCORD_PREFIX || '!mc',
    hubUrl: env.HUB_URL || `http://localhost:${HUB_PORT}`,
    channelId: env.DISCORD_CHANNEL_ID || '',
    botChannels: parseChannelMap(env.DISCORD_BOT_CHANNELS),
    serverChatChannels: parseChannelMap(env.DISCORD_SERVER_CHAT_CHANNELS),
    botChannelCount: parseChannelMap(env.DISCORD_BOT_CHANNELS).length,
    serverChatChannelCount: parseChannelMap(env.DISCORD_SERVER_CHAT_CHANNELS).length,
    lastError,
    lastOutput: outLines.slice(-12),
    errorLines: errLines.slice(-12)
  }
}

async function stopDiscordBridge() {
  const pid = fs.existsSync(discordPidFile) ? Number(fs.readFileSync(discordPidFile, 'utf8').trim()) : 0
  if (pid && processAlive(pid)) {
    try { await killPidTree(pid) } catch {
      try { process.kill(pid) } catch {}
    }
  }
  try { fs.unlinkSync(discordPidFile) } catch {}
}

function startDiscordBridge() {
  if (!fs.existsSync(discordBridgeFile)) throw new Error('Discord bridge is not installed.')
  fs.mkdirSync(path.dirname(discordOutLog), { recursive: true })
  const script = [
    `Start-Process -WindowStyle Hidden -FilePath ${psQuote(process.execPath)} -ArgumentList 'index.js' -WorkingDirectory ${psQuote(discordBridgeRoot)} -RedirectStandardOutput ${psQuote(discordOutLog)} -RedirectStandardError ${psQuote(discordErrLog)}`
  ].join('; ')
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  })
  child.unref()
}

async function restartDiscordBridge() {
  await stopDiscordBridge()
  await wait(700)
  startDiscordBridge()
  return discordBridgeStatus()
}

async function sendDiscordTestMessage(channelId) {
  const env = readEnv(discordEnvFile)
  const token = env.DISCORD_TOKEN
  if (!token) throw new Error('DISCORD_TOKEN is missing.')
  const status = discordBridgeStatus()
  const targetChannel = String(channelId || status.channelId || status.serverChatChannels[0]?.channelId || status.botChannels[0]?.channelId || '').trim()
  if (!/^\d{10,30}$/.test(targetChannel)) throw new Error('No Discord channel is linked yet.')
  const response = await fetch(`https://discord.com/api/v10/channels/${targetChannel}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `Hub testbericht ${localStamp()}`, allowed_mentions: { parse: [] } })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `Discord test failed: ${response.status}`)
  return { channelId: targetChannel }
}

function configBackupList() {
  if (!fs.existsSync(configBackupsRoot)) return []
  return fs.readdirSync(configBackupsRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => {
      const file = path.join(configBackupsRoot, entry.name)
      const stat = fs.statSync(file)
      return { name: entry.name, file, createdAt: stat.mtime.toISOString(), size: stat.size }
    })
    .sort((left, right) => right.name.localeCompare(left.name))
}

function backupConfigNow(reason = 'manual') {
  if (!fs.existsSync(settingsFile)) throw new Error('settings.json does not exist.')
  fs.mkdirSync(configBackupsRoot, { recursive: true })
  const file = path.join(configBackupsRoot, `settings-${reason}-${localStampFile()}.json`)
  fs.copyFileSync(settingsFile, file)
  return { name: path.basename(file), file }
}

function restoreLatestConfigBackup() {
  const latest = configBackupList()[0]
  if (!latest) throw new Error('No config backup is available.')
  backupConfigNow('before-restore')
  fs.copyFileSync(latest.file, settingsFile)
  settings = loadSettings()
  saveSettings()
  return latest
}

function setViewers(botIds, enabled) {
  const ids = new Set(Array.isArray(botIds) && botIds.length ? botIds.map(String) : settings.bots.map(bot => bot.id))
  const sent = []
  const skipped = []
  for (const bot of settings.bots.filter(item => ids.has(item.id))) {
    const telemetry = ensureTelemetry(bot)
    if (!telemetry.socket.connected) {
      skipped.push(bot.name)
      continue
    }
    telemetry.socket.emit('command', `ai viewer ${enabled ? 'on' : 'off'}`)
    sent.push(bot.name)
  }
  return { sent, skipped }
}

function displayedStats(bot) {
  const lines = tailLog(bot)
  const workerCrashes = lines.filter(line => /Bot worker stopped|Minecraft connection error|Priority loop error/i.test(line)).length
  const stats = bot.stats || { starts: 0, crashes: 0, totalRuntimeMs: 0, lastExit: null, lastError: '' }
  const lastErrorIndex = lines.findLastIndex(line => /error|timed out|ECONN|worker stopped/i.test(line))
  const lastRecoveryIndex = lines.findLastIndex(line => /Minecraft spawn complete|Hub online|HUD open/i.test(line))
  const lastError = lastRecoveryIndex > lastErrorIndex ? '' : (lastErrorIndex >= 0 ? lines[lastErrorIndex] : stats.lastError || '')
  return { ...stats, crashes: Math.max(stats.crashes || 0, workerCrashes), lastError }
}

function knowledgeScores(bot) {
  const folder = path.join(resolvedBotFolder(bot), 'knowledge')
  const sum = value => typeof value === 'number' ? value : value && typeof value === 'object'
    ? Object.values(value).reduce((total, child) => total + sum(child), 0) : 0
  return Object.fromEntries(['mining', 'combat', 'movement', 'crafting'].map(domain => {
    const data = readJson(path.join(folder, `${domain}.json`), {})
    return [domain, Math.round(sum(data.stats || {}) + sum(data.learning || {}))]
  }))
}

function updateBotCode(sourceFolder, bot) {
  const source = validateBotFolder(sourceFolder)
  const target = validateBotFolder(resolvedBotFolder(bot))
  const protectedNames = new Set(['bot-settings.json', 'ai-memory.json', 'ai-recipes.json', 'knowledge', 'worlds', 'profiles', 'backups', 'node_modules'])
  const backup = path.join(updateBackupsRoot, bot.id, localStampFile())
  fs.mkdirSync(backup, { recursive: true })
  const copied = []
  const copyTree = (from, to, backupTo) => {
    fs.mkdirSync(to, { recursive: true })
    fs.mkdirSync(backupTo, { recursive: true })
    for (const name of fs.readdirSync(from)) {
      const sourceItem = path.join(from, name)
      const targetItem = path.join(to, name)
      const backupItem = path.join(backupTo, name)
      if (fs.statSync(sourceItem).isDirectory()) copyTree(sourceItem, targetItem, backupItem)
      else {
        if (fs.existsSync(targetItem)) fs.copyFileSync(targetItem, backupItem)
        fs.copyFileSync(sourceItem, targetItem)
        copied.push(path.relative(source, sourceItem))
      }
    }
  }
  for (const name of fs.readdirSync(source)) {
    if (protectedNames.has(name) || name.startsWith('.')) continue
    const from = path.join(source, name)
    if (fs.statSync(from).isDirectory()) {
      if (['src', 'public', 'tools', 'test'].includes(name)) copyTree(from, path.join(target, name), path.join(backup, name))
      continue
    }
    const to = path.join(target, name)
    if (fs.existsSync(to)) fs.copyFileSync(to, path.join(backup, name))
    fs.copyFileSync(from, to)
    copied.push(name)
  }
  return { copied, backup }
}

function copyTreeFiltered(source, target, ignoredNames = new Set()) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name) || entry.name.startsWith('.')) continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyTreeFiltered(from, to, ignoredNames)
    else fs.copyFileSync(from, to)
  }
}

function uniqueBotFolderName(baseName) {
  const safeBase = String(baseName || 'minecraft-ai-bot')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'minecraft-ai-bot'
  let name = safeBase
  let counter = 2
  while (fs.existsSync(path.join(botsRoot, name))) name = `${safeBase}-${counter++}`
  return name
}

async function cloneBot(sourceBot, requestedName) {
  if ((await botStatus(sourceBot)).running) throw new Error(`Stop ${sourceBot.name} before cloning it.`)
  const source = validateBotFolder(resolvedBotFolder(sourceBot))
  const name = uniqueBotFolderName(requestedName || `${sourceBot.name}-copy`)
  const target = path.join(botsRoot, name)
  const ignored = new Set(['node_modules', 'bot-output.log', 'bot-error.log', 'logs', 'backups'])
  copyTreeFiltered(source, target, ignored)
  const bot = normalizeBot({
    ...sourceBot,
    id: crypto.randomUUID(),
    name,
    folder: portablePath(target),
    stats: { starts: 0, crashes: 0, totalRuntimeMs: 0, lastExit: null, lastError: '', recentCrashes: [] },
    disabledUntil: null
  })
  const ports = nextPorts([...settings.bots, bot])
  bot.hudPort = ports.hudPort
  bot.viewerPort = ports.viewerPort
  settings.bots.push(bot)
  settings.viewerLayout.order = [...new Set([...(settings.viewerLayout.order || []), bot.id])]
  saveSettings()
  await assignFreePorts(bot)
  return bot
}

function latestDirectory(root) {
  if (!fs.existsSync(root)) return null
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const folder = path.join(root, entry.name)
      const stat = fs.statSync(folder)
      return { name: entry.name, folder, createdAt: localStamp(stat.birthtime), modifiedAt: localStamp(stat.mtime), modifiedMs: stat.mtimeMs }
    })
    .sort((left, right) => right.modifiedMs - left.modifiedMs)[0] || null
}

function fileCount(root, extension = '') {
  if (!fs.existsSync(root)) return 0
  let count = 0
  const visit = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (!extension || entry.name.toLowerCase().endsWith(extension)) count++
    }
  }
  visit(root)
  return count
}

function diskInfo() {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const drive = path.parse(portableRoot).root.replace(/\\$/, '')
  const script = `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress`
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.once('error', () => resolve(null))
    child.once('exit', () => {
      try {
        const data = JSON.parse(output || '{}')
        resolve({ drive, size: Number(data.Size || 0), free: Number(data.FreeSpace || 0) })
      } catch {
        resolve(null)
      }
    })
  })
}

async function systemHealth() {
  return buildSystemHealth({
    settings,
    HUB_PORT,
    portableRoot,
    hubRoot: __dirname,
    settingsFile,
    portsFile,
    logsRoot,
    startupBackupsRoot,
    botsRoot,
    path,
    fs,
    portListening,
    latestDirectory,
    fileCount,
    diskInfo,
    resolvedBotFolder,
    botStatus,
    displayedStats,
    configBackupList,
    discordBridgeStatus
  })
}

async function statePayload() {
  const registeredIds = new Set(settings.bots.map(bot => bot.id))
  for (const [id, entry] of telemetrySockets) {
    if (!registeredIds.has(id)) {
      entry.socket.close()
      telemetrySockets.delete(id)
    }
  }
  return {
    hubPort: HUB_PORT,
    mergedKnowledge: mergedKnowledgeList(),
    groups: [...new Set([...settings.groups, ...settings.bots.map(bot => bot.group)])].sort(),
    serverProfiles: settings.serverProfiles,
    supportedMinecraftVersions,
    schedules: settings.schedules,
    presets: settings.presets,
    viewerLayout: settings.viewerLayout,
    mergeHistory: settings.mergeHistory.slice(-50).reverse(),
    discordBridge: (() => {
      const status = discordBridgeStatus()
      return {
        installed: status.installed,
        running: status.running,
        pid: status.pid,
        botChannelCount: status.botChannelCount,
        serverChatChannelCount: status.serverChatChannelCount,
        lastError: status.lastError
      }
    })(),
    bots: await Promise.all(settings.bots.map(async bot => {
      const telemetry = ensureTelemetry(bot)
      const stats = displayedStats(bot)
      if (telemetry.data?.connected) stats.lastError = ''
      return { ...bot, stats, folder: resolvedBotFolder(bot), status: await botStatus(bot), telemetry: telemetry.data, telemetryAt: telemetry.receivedAt }
    }))
  }
}

async function portsAvailable(bot) {
  const conflicts = settings.bots.filter(other =>
    other.id !== bot.id &&
    [other.hudPort, other.viewerPort].some(port => port === bot.hudPort || port === bot.viewerPort) &&
    runningBots.has(other.id)
  )
  if (conflicts.length) throw new Error(`HUD/viewer port conflicts with ${conflicts.map(item => item.name).join(', ')}.`)
  if (await portListening(bot.hudPort)) throw new Error(`HUD port ${bot.hudPort} is already in use.`)
  if (await portListening(bot.viewerPort)) throw new Error(`Viewer port ${bot.viewerPort} is already in use.`)
}

async function assignFreePorts(bot) {
  const currentHud = normalizePort(bot.hudPort, 0)
  const currentViewer = normalizePort(bot.viewerPort, 0)
  const usedByOtherBots = new Set(settings.bots
    .filter(other => other.id !== bot.id)
    .flatMap(other => [other.hudPort, other.viewerPort].map(Number)))

  const pairIsUsable = async (hudPort, viewerPort) => {
    if (!hudPort || !viewerPort || hudPort === viewerPort) return false
    if (hudPort === HUB_PORT || viewerPort === HUB_PORT) return false
    if (usedByOtherBots.has(hudPort) || usedByOtherBots.has(viewerPort)) return false
    return !(await portListening(hudPort)) && !(await portListening(viewerPort))
  }

  if (await pairIsUsable(currentHud, currentViewer)) return false

  let hudPort = botPortBase
  while (!(await pairIsUsable(hudPort, hudPort + 1))) hudPort += botPortStep
  bot.hudPort = hudPort
  bot.viewerPort = hudPort + 1
  saveSettings()
  return true
}

async function startBot(bot) {
  const pausedMs = botPauseMs(bot)
  if (pausedMs > 0) throw new Error(`${bot.name} is paused by crash monitor for ${Math.ceil(pausedMs / 60000)} more minute(s).`)
  bot.disabledUntil = null
  if (runningBots.has(bot.id) && processAlive(runningBots.get(bot.id).pid)) throw new Error('This bot is already running from the Hub.')
  const folder = validateBotFolder(resolvedBotFolder(bot))
  await assignFreePorts(bot)
  await portsAvailable(bot)
  fs.mkdirSync(logsRoot, { recursive: true })
  const logFile = path.join(logsRoot, `${bot.id}.log`)
  const logHandle = fs.openSync(logFile, 'a')
  const childEnv = { ...process.env }
  delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED
  const child = spawn(process.execPath, [path.join(folder, 'bot.js')], {
    cwd: folder,
    env: {
      ...childEnv,
      PORT: String(bot.hudPort),
      VIEWER_PORT: String(bot.viewerPort),
      VIEWER_DISTANCE: '2',
      MC_HOST: bot.host,
      MC_PORT: String(bot.port),
      MC_VERSION: bot.version,
      MINECRAFT_AI_WORKER: '1'
    },
    detached: false,
    windowsHide: true,
    stdio: ['ignore', logHandle, logHandle]
  })
  fs.closeSync(logHandle)
  bot.stats.starts = (bot.stats.starts || 0) + 1
  saveSettings()
  const runtime = { pid: child.pid, child, startedAt: new Date().toISOString(), stopping: false }
  runningBots.set(bot.id, runtime)
  child.once('exit', (code, signal) => {
    const runtime = runningBots.get(bot.id)
    if (!runtime) return
    bot.stats.totalRuntimeMs = (bot.stats.totalRuntimeMs || 0) + Date.now() - Date.parse(runtime.startedAt)
    bot.stats.lastExit = new Date().toISOString()
    const plannedReconnect = Number(code) === 75
    if (!runtime.stopping && !plannedReconnect) {
      recordBotCrash(bot, `Worker exited (${signal || code || 'unknown'}).`)
    }
    runningBots.delete(bot.id)
    saveSettings()
    if (!runtime.stopping && bot.autoRestart && botPauseMs(bot) === 0) {
      const livedFor = Date.now() - Date.parse(runtime.startedAt)
      const restartDelay = plannedReconnect ? 2000 : (livedFor < 30000 ? 30000 : 5000)
      setTimeout(() => startBot(bot).catch(() => {}), restartDelay)
    }
  })
  return runtime
}

async function stopBot(bot) {
  const runtime = runningBots.get(bot.id)
  if (runtime) {
    runtime.stopping = true
    try { runtime.child.kill('SIGTERM') } catch {}
    if (await waitForExit(runtime.child, 3500)) {
      runningBots.delete(bot.id)
      return
    }
  }
  const hudPid = runtime?.pid || await portOwnerPid(bot.hudPort)
  const pid = runtime?.pid || await botRootPid(hudPid)
  if (!pid) throw new Error(`Could not find the process using HUD port ${bot.hudPort}.`)
  try {
    await killPidTree(pid)
  } finally {
    runningBots.delete(bot.id)
  }
}

function chooseFolder() {
  if (process.platform !== 'win32') throw new Error('Folder picker is currently available on Windows only.')
  const requestId = crypto.randomUUID()
  const pickerDirectory = path.join(__dirname, '.picker')
  const scriptFile = path.join(pickerDirectory, `${requestId}.ps1`)
  const resultFile = path.join(pickerDirectory, `${requestId}.result`)
  fs.mkdirSync(pickerDirectory, { recursive: true })
  const quote = value => String(value).replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    "$owner.Text = 'Minecraft AI Bot Hub'",
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $true',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1, 1)',
    '$owner.Show()',
    '$owner.Activate()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = 'Choose the folder containing bot.js'",
    `$dialog.InitialDirectory = '${quote(__dirname)}'`,
    "$dialog.FileName = 'Select Folder'",
    "$dialog.Filter = 'Folder|*.folder'",
    '$dialog.CheckFileExists = $false',
    '$dialog.CheckPathExists = $true',
    '$dialog.ValidateNames = $false',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    "$value = if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Split-Path -Parent $dialog.FileName } else { '' }",
    `[System.IO.File]::WriteAllText('${quote(resultFile)}', $value)`
  ].join("\r\n")
  fs.writeFileSync(scriptFile, script, 'utf8')

  return new Promise((resolve, reject) => {
    const picker = spawn('cmd.exe', ['/d', '/c', 'start', '', 'powershell.exe', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    })
    picker.unref()
    const startedAt = Date.now()
    const cleanup = () => {
      try { fs.unlinkSync(scriptFile) } catch {}
      try { fs.unlinkSync(resultFile) } catch {}
    }
    const timer = setInterval(() => {
      if (fs.existsSync(resultFile)) {
        clearInterval(timer)
        const result = fs.readFileSync(resultFile, 'utf8').trim()
        cleanup()
        resolve(result)
      } else if (Date.now() - startedAt > 120000) {
        clearInterval(timer)
        cleanup()
        reject(new Error('Folder picker timed out. Try starting the Hub with start-hub.cmd.'))
      }
    }, 150)
  })
}

function findBot(id) {
  const bot = settings.bots.find(item => item.id === id)
  if (!bot) throw new Error('Bot registration was not found.')
  return bot
}

const app = express()
app.use(express.json({ limit: '256kb' }))
app.get('/', (_request, response) => response.sendFile(path.join(__dirname, 'public', 'hub.html')))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/state', async (_request, response, next) => {
  try { response.json(await statePayload()) } catch (err) { next(err) }
})

registerSupportRoutes(app, {
  fs,
  settingsFile,
  systemHealth,
  discordBridgeStatus,
  restartDiscordBridge,
  sendDiscordTestMessage,
  configBackupList,
  backupConfigNow,
  restoreLatestConfigBackup
})

app.post('/api/maintenance/cleanup', (_request, response, next) => {
  try {
    response.json({ ok: true, ...runMaintenance() })
  } catch (err) { next(err) }
})

app.post('/api/command', (request, response, next) => {
  try {
    const result = sendToBots(request.body?.botIds, request.body?.text)
    response.json({ ok: true, ...result })
  } catch (err) { next(err) }
})

app.get('/api/logs/:id', (request, response, next) => {
  try { response.json({ ok: true, lines: tailLog(findBot(request.params.id), request.query.search) }) } catch (err) { next(err) }
})

app.get('/api/knowledge-scores', (_request, response, next) => {
  try { response.json({ ok: true, bots: settings.bots.map(bot => ({ id: bot.id, name: bot.name, scores: knowledgeScores(bot) })) }) } catch (err) { next(err) }
})

app.post('/api/config', (request, response, next) => {
  try {
    settings.groups = Array.isArray(request.body?.groups) ? request.body.groups.map(String).filter(Boolean) : settings.groups
    settings.serverProfiles = Array.isArray(request.body?.serverProfiles) ? request.body.serverProfiles : settings.serverProfiles
    settings.schedules = Array.isArray(request.body?.schedules) ? request.body.schedules : settings.schedules
    if (Array.isArray(request.body?.presets)) {
      const customPresets = request.body.presets
        .map(preset => normalizePreset({ ...preset, builtIn: false }))
        .filter(preset => preset.commands.length && !defaultPresets.some(item => item.id === preset.id))
      settings.presets = [...defaultPresets, ...customPresets]
    }
    if (request.body?.viewerLayout && typeof request.body.viewerLayout === 'object') {
      const layout = request.body.viewerLayout
      settings.viewerLayout = {
        columns: [1, 2, 3, 4].includes(Number(layout.columns)) ? Number(layout.columns) : settings.viewerLayout.columns,
        order: Array.isArray(layout.order) ? layout.order.map(String) : settings.viewerLayout.order,
        hidden: Array.isArray(layout.hidden) ? layout.hidden.map(String) : settings.viewerLayout.hidden
      }
    }
    saveSettings()
    response.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/presets/apply', async (request, response, next) => {
  try {
    response.json({ ok: true, ...await applyPreset(request.body || {}) })
  } catch (err) { next(err) }
})

app.post('/api/group/action', async (request, response, next) => {
  try {
    const bots = settings.bots.filter(bot => bot.group === String(request.body?.group || ''))
    const action = request.body?.action
    const results = []
    for (const bot of bots) {
      try {
        if (action === 'start' && !(await botStatus(bot)).running) await startBot(bot)
        if (action === 'stop' && runningBots.has(bot.id)) await stopBot(bot)
        results.push(bot.name)
      } catch {}
    }
    response.json({ ok: true, bots: results })
  } catch (err) { next(err) }
})

app.post('/api/group/delete', async (request, response, next) => {
  try {
    const group = String(request.body?.group || '').trim()
    if (!group || group === 'Ungrouped') throw new Error('This group cannot be deleted.')
    for (const bot of settings.bots) {
      if (bot.group === group) bot.group = 'Ungrouped'
    }
    settings.groups = settings.groups.filter(item => item !== group)
    settings.schedules = settings.schedules.filter(schedule => schedule.group !== group)
    saveSettings()
    response.json({ ok: true, group })
  } catch (err) { next(err) }
})

app.post('/api/bots/action', async (request, response, next) => {
  try {
    const action = String(request.body?.action || '')
    if (!['start', 'stop'].includes(action)) throw new Error('Bot action must be start or stop.')
    const results = []
    const skipped = []
    const errors = []
    for (const bot of settings.bots) {
      try {
        const status = await botStatus(bot)
        if (action === 'start') {
          if (status.running) {
            skipped.push(bot.name)
          } else {
            await startBot(bot)
            results.push(bot.name)
          }
        } else if (action === 'stop') {
          if (!status.running) {
            skipped.push(bot.name)
          } else {
            await stopBot(bot)
            results.push(bot.name)
          }
        }
      } catch (err) {
        errors.push({ bot: bot.name, error: err.message || String(err) })
      }
    }
    response.json({ ok: true, action, bots: results, skipped, errors })
  } catch (err) { next(err) }
})

app.post('/api/server-profile/apply', (request, response, next) => {
  try {
    const profile = settings.serverProfiles.find(item => item.id === request.body?.profileId)
    if (!profile) throw new Error('Server profile was not found.')
    const ids = new Set(Array.isArray(request.body?.botIds) ? request.body.botIds : [])
    for (const bot of settings.bots.filter(item => ids.has(item.id))) {
      bot.host = profile.host
      bot.port = normalizePort(profile.port, 25565)
      bot.version = normalizeMinecraftVersion(profile.version, bot.version)
    }
    saveSettings()
    response.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/update-code', async (request, response, next) => {
  try {
    const source = findBot(String(request.body?.sourceBotId || ''))
    const ids = [...new Set(Array.isArray(request.body?.targetBotIds) ? request.body.targetBotIds : [])].filter(id => id !== source.id)
    if (!ids.length) throw new Error('Choose at least one target bot that is not the source bot.')
    const targets = ids.map(findBot)
    for (const bot of targets) if ((await botStatus(bot)).running) throw new Error(`Stop ${bot.name} before updating code.`)
    const results = targets.map(bot => ({ bot: bot.name, ...updateBotCode(resolvedBotFolder(source), bot) }))
    response.json({ ok: true, results })
  } catch (err) { next(err) }
})

app.post('/api/knowledge/restore-latest', async (request, response, next) => {
  try {
    const bot = findBot(String(request.body?.botId || ''))
    if ((await botStatus(bot)).running) throw new Error(`Stop ${bot.name} before restoring knowledge.`)
    const root = path.join(resolvedBotFolder(bot), 'knowledge-backups')
    const latest = fs.existsSync(root) ? fs.readdirSync(root).sort().pop() : null
    if (!latest) throw new Error('No knowledge backup is available for this bot.')
    copyKnowledgeExact(path.join(root, latest), path.join(resolvedBotFolder(bot), 'knowledge'))
    settings.mergeHistory.push({ at: localStamp(), action: 'restored', bots: [bot.name], backup: latest })
    saveSettings()
    response.json({ ok: true, bot: bot.name, backup: latest })
  } catch (err) { next(err) }
})

app.post('/api/knowledge/copy', async (request, response, next) => {
  try {
    const source = findBot(String(request.body?.sourceBotId || ''))
    const target = findBot(String(request.body?.targetBotId || ''))
    if (source.id === target.id) throw new Error('Choose two different bots.')
    if ((await botStatus(target)).running) throw new Error(`Stop ${target.name} before replacing its knowledge.`)
    const sourceKnowledge = path.join(resolvedBotFolder(source), 'knowledge')
    const targetKnowledge = path.join(resolvedBotFolder(target), 'knowledge')
    if (!fs.existsSync(sourceKnowledge) || !fs.statSync(sourceKnowledge).isDirectory()) throw new Error(`${source.name} has no knowledge folder.`)
    const backup = path.join(resolvedBotFolder(target), 'knowledge-backups', `copy-${localStampFile()}`)
    if (fs.existsSync(targetKnowledge)) copyKnowledgeExact(targetKnowledge, backup)
    copyKnowledgeExact(sourceKnowledge, targetKnowledge)
    settings.mergeHistory.push({ at: localStamp(), action: 'knowledge copied', bots: [source.name, target.name], backup })
    saveSettings()
    response.json({ ok: true, source: source.name, target: target.name, backup })
  } catch (err) { next(err) }
})

app.post('/api/folder-picker', async (_request, response, next) => {
  try { response.json({ folder: await chooseFolder() }) } catch (err) { next(err) }
})

app.post('/api/bots/import-folder', (request, response, next) => {
  try {
    const existing = new Set(settings.bots.map(bot => resolvedBotFolder(bot).toLowerCase()))
    const folders = findBotFolders(request.body?.folder)
    const added = []
    for (const folder of folders) {
      if (existing.has(folder.toLowerCase())) continue
      const bot = botFromFolder(folder, settings.bots)
      settings.bots.push(bot)
      existing.add(folder.toLowerCase())
      added.push(bot)
    }
    saveSettings()
    response.json({ ok: true, added, found: folders.length })
  } catch (err) { next(err) }
})

app.post('/api/bots/:id/clone', async (request, response, next) => {
  try {
    const bot = await cloneBot(findBot(request.params.id), request.body?.name)
    response.json({ ok: true, bot })
  } catch (err) { next(err) }
})

app.post('/api/bots/bulk-settings', async (request, response, next) => {
  try {
    const server = normalizeHostAndPort(request.body?.host, request.body?.port)
    const version = normalizeMinecraftVersion(request.body?.version, '1.21.4')
    if (!server.host) throw new Error('Enter a server host.')
    const updated = []
    const skipped = []
    for (const bot of settings.bots) {
      if ((await botStatus(bot)).running) {
        skipped.push(bot.name)
        continue
      }
      bot.host = server.host
      bot.port = server.port
      bot.version = version
      updated.push(bot.name)
    }
    saveSettings()
    response.json({ ok: true, updated, skipped, host: server.host, port: server.port, version })
  } catch (err) { next(err) }
})

app.post('/api/viewers/action', (request, response, next) => {
  try {
    const action = String(request.body?.action || '')
    if (!['on', 'off'].includes(action)) throw new Error('Viewer action must be on or off.')
    response.json({ ok: true, ...setViewers(request.body?.botIds, action === 'on') })
  } catch (err) { next(err) }
})

app.post('/api/bots', (request, response, next) => {
  try {
    const folder = validateBotFolder(request.body?.folder)
    if (settings.bots.some(bot => resolvedBotFolder(bot).toLowerCase() === folder.toLowerCase())) throw new Error('This bot folder is already registered.')
    const bot = botFromFolder(folder, settings.bots)
    settings.bots.push(bot)
    saveSettings()
    response.json({ ok: true, bot })
  } catch (err) { next(err) }
})

app.patch('/api/bots/:id', (request, response, next) => {
  try {
    const bot = findBot(request.params.id)
    if (runningBots.has(bot.id)) throw new Error('Stop the bot before changing its launch settings.')
    const server = normalizeHostAndPort(request.body?.host ?? bot.host, request.body?.port ?? bot.port)
    Object.assign(bot, normalizeBot({
      ...bot,
      name: request.body?.name ?? bot.name,
      host: server.host,
      port: server.port,
      version: normalizeMinecraftVersion(request.body?.version ?? bot.version, bot.version),
      hudPort: request.body?.hudPort ?? bot.hudPort,
      viewerPort: request.body?.viewerPort ?? bot.viewerPort
    }))
    bot.group = String(request.body?.group ?? bot.group).trim().slice(0, 60) || 'Ungrouped'
    bot.autoRestart = request.body?.autoRestart !== false
    if (bot.hudPort === bot.viewerPort) throw new Error('HUD and viewer ports must be different.')
    saveSettings()
    response.json({ ok: true, bot })
  } catch (err) { next(err) }
})

app.delete('/api/bots/:id', async (request, response, next) => {
  try {
    const bot = findBot(request.params.id)
    if ((await botStatus(bot)).running) throw new Error('Stop the bot before removing it from the Hub.')
    telemetrySockets.get(bot.id)?.socket.close()
    telemetrySockets.delete(bot.id)
    settings.bots = settings.bots.filter(item => item.id !== bot.id)
    saveSettings()
    response.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/bots/:id/start', async (request, response, next) => {
  try {
    const runtime = await startBot(findBot(request.params.id))
    response.json({ ok: true, pid: runtime.pid })
  } catch (err) { next(err) }
})

app.post('/api/bots/:id/stop', async (request, response, next) => {
  try {
    await stopBot(findBot(request.params.id))
    response.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/merge', async (request, response, next) => {
  try {
    const ids = [...new Set(Array.isArray(request.body?.botIds) ? request.body.botIds.map(String) : [])]
    if (ids.length < 2 || ids.length > 5) throw new Error('Select between 2 and 5 bots.')
    const bots = ids.map(findBot)
    for (const bot of bots) {
      if ((await botStatus(bot)).running) throw new Error(`Stop ${bot.name} before merging its knowledge.`)
      validateBotFolder(resolvedBotFolder(bot))
    }
    const stamp = localStampFile()
    const output = path.join(mergedRoot, stamp)
    const results = mergeKnowledgeFoldersMany(bots.map(bot => path.join(resolvedBotFolder(bot), 'knowledge')), output)
    settings.mergeHistory.push({ at: localStamp(), action: 'created', mergeId: stamp, bots: bots.map(bot => bot.name) })
    saveSettings()
    response.json({ ok: true, output, files: results.map(result => result.name), bots: bots.map(bot => bot.name) })
  } catch (err) { next(err) }
})

app.post('/api/merge/apply', async (request, response, next) => {
  try {
    const mergeId = String(request.body?.mergeId || '')
    const merge = mergedKnowledgeList().find(entry => entry.id === mergeId)
    if (!merge) throw new Error('Select an existing merged knowledge folder.')
    const ids = [...new Set(Array.isArray(request.body?.botIds) ? request.body.botIds.map(String) : [])]
    if (ids.length < 1 || ids.length > 5) throw new Error('Choose between 1 and 5 target bots.')
    const bots = ids.map(findBot)
    for (const bot of bots) {
      if ((await botStatus(bot)).running) throw new Error(`Stop ${bot.name} before replacing its knowledge.`)
      validateBotFolder(resolvedBotFolder(bot))
    }

    const stamp = localStampFile()
    const applied = []
    for (const bot of bots) {
      const target = path.join(resolvedBotFolder(bot), 'knowledge')
      const backup = path.join(resolvedBotFolder(bot), 'knowledge-backups', stamp)
      if (fs.existsSync(target)) copyKnowledgeExact(target, backup)
      copyKnowledgeExact(merge.folder, target)
      applied.push({ bot: bot.name, target, backup })
    }
    settings.mergeHistory.push({ at: localStamp(), action: 'applied', mergeId, bots: bots.map(bot => bot.name) })
    saveSettings()
    response.json({ ok: true, bots: bots.map(bot => bot.name), mergeId, applied })
  } catch (err) { next(err) }
})

app.post('/api/open-folder', (request, response, next) => {
  try {
    const folder = path.resolve(String(request.body?.folder || ''))
    const allowed = folder === mergedRoot || folder.startsWith(`${mergedRoot}${path.sep}`) ||
      settings.bots.some(bot => folder === resolvedBotFolder(bot))
    if (!allowed || !fs.existsSync(folder)) throw new Error('Folder is not available.')
    spawn('explorer.exe', [folder], { detached: true, windowsHide: false, stdio: 'ignore' }).unref()
    response.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/shutdown', async (_request, response) => {
  response.json({ ok: true })
  for (const [id, runtime] of runningBots) {
    runtime.stopping = true
    try { runtime.child.kill() } catch {}
    runningBots.delete(id)
  }
  setTimeout(() => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }, 100).unref()
})

app.post('/api/restart-hub', (_request, response, next) => {
  try {
    response.json({ ok: true })
    const script = [
      'Start-Sleep -Milliseconds 1300',
      `Start-Process -WindowStyle Hidden -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(__filename)} -WorkingDirectory ${psQuote(__dirname)}`
    ].join('; ')
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.unref()
    setTimeout(() => {
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 1500).unref()
    }, 100).unref()
  } catch (err) { next(err) }
})

app.use((err, _request, response, _next) => {
  response.status(400).json({ ok: false, error: err.message || 'Hub request failed.' })
})

let lastScheduleMinute = ''
setInterval(async () => {
  const now = new Date()
  const minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (minute === lastScheduleMinute) return
  lastScheduleMinute = minute
  const time = minute.slice(-5)
  for (const schedule of settings.schedules.filter(item => item.enabled !== false && item.time === time)) {
    const bots = schedule.group ? settings.bots.filter(bot => bot.group === schedule.group) : settings.bots.filter(bot => (schedule.botIds || []).includes(bot.id))
    for (const bot of bots) {
      try {
        if (schedule.action === 'start' && !(await botStatus(bot)).running) await startBot(bot)
        else if (schedule.action === 'stop' && runningBots.has(bot.id)) await stopBot(bot)
        else if (schedule.action === 'command') sendToBots([bot.id], schedule.command)
      } catch {}
    }
  }
}, 15000)

const server = http.createServer(app).listen(HUB_PORT, HUB_HOST, () => {
  console.log(`Minecraft AI Bot Hub open: http://localhost:${HUB_PORT}`)
})
