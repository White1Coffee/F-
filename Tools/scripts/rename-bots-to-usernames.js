const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const settingsFile = path.join(ROOT, 'Config', 'settings.json')
const portsFile = path.join(ROOT, 'Config', 'ports.json')
const botsRoot = path.join(ROOT, 'Bots')

const renames = new Map([
  ['minecraft-ai-bot-1', 'bot1'],
  ['minecraft-ai-bot-2', 'bot2'],
  ['minecraft-ai-bot-20', 'WC_Tester'],
  ['official-bot', 'official-bot']
])

function stamp() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getDate())}${pad(date.getMonth() + 1)}${date.getFullYear()}`
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function backupFile(file, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(file, path.join(backupDir, path.basename(file)))
}

function replaceAllStrings(value) {
  if (typeof value === 'string') {
    let next = value
    for (const [oldName, newName] of [...renames].sort((a, b) => b[0].length - a[0].length)) {
      next = next.split(oldName).join(newName)
    }
    return next
  }
  if (Array.isArray(value)) return value.map(replaceAllStrings)
  if (value && typeof value === 'object') {
    const output = {}
    for (const [key, child] of Object.entries(value)) {
      const newKey = renames.get(key) || key
      output[newKey] = replaceAllStrings(child)
    }
    return output
  }
  return value
}

function renameFolder(oldName, newName) {
  if (oldName === newName) return { oldName, newName, changed: false, reason: 'same name' }
  const oldFolder = path.join(botsRoot, oldName)
  const newFolder = path.join(botsRoot, newName)
  if (!fs.existsSync(oldFolder)) {
    if (fs.existsSync(newFolder)) return { oldName, newName, changed: false, reason: 'already renamed' }
    throw new Error(`Missing source folder: ${oldFolder}`)
  }
  if (fs.existsSync(newFolder)) throw new Error(`Target folder already exists: ${newFolder}`)
  fs.renameSync(oldFolder, newFolder)
  return { oldName, newName, changed: true, from: oldFolder, to: newFolder }
}

function updateSettings() {
  const settings = readJson(settingsFile)
  for (const bot of settings.bots || []) {
    const newName = renames.get(bot.name)
    if (!newName) continue
    bot.name = newName
    bot.folder = `@/Bots\\${newName}`
  }
  const cleaned = replaceAllStrings(settings)
  writeJson(settingsFile, cleaned)
}

function updatePorts() {
  const ports = readJson(portsFile)
  if (ports.bots && typeof ports.bots === 'object') {
    const next = {}
    for (const [name, config] of Object.entries(ports.bots)) {
      next[renames.get(name) || name] = config
    }
    ports.bots = next
  }
  writeJson(portsFile, ports)
}

function main() {
  const runStamp = stamp()
  const backupDir = path.join(ROOT, 'Data', 'backups', 'config', `before-bot-rename-${runStamp}`)
  backupFile(settingsFile, backupDir)
  backupFile(portsFile, backupDir)

  const folderResults = []
  for (const [oldName, newName] of renames) folderResults.push(renameFolder(oldName, newName))
  updateSettings()
  updatePorts()

  const manifest = { at: runStamp, backupDir, renames: Object.fromEntries(renames), folders: folderResults }
  fs.writeFileSync(path.join(backupDir, 'rename-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`Bot rename complete. Config backup: ${backupDir}`)
  for (const result of folderResults) {
    console.log(`${result.oldName} -> ${result.newName}: ${result.changed ? 'renamed' : result.reason}`)
  }
}

main()
