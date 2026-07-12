const fs = require('fs')
const path = require('path')

const envFile = path.join(__dirname, '.env')
const env = loadEnv(envFile)
const token = env.DISCORD_TOKEN || process.env.DISCORD_TOKEN
const prefix = env.DISCORD_PREFIX || process.env.DISCORD_PREFIX || '!mc'
const hubUrl = trimSlash(env.HUB_URL || process.env.HUB_URL || 'http://localhost:3100')
const javaServerUrl = trimSlash(env.JAVA_SERVER_URL || process.env.JAVA_SERVER_URL || 'http://localhost:3101')
const bridgeChannelId = env.DISCORD_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID || ''
const botChannelMap = parseBotChannelMap(env.DISCORD_BOT_CHANNELS || process.env.DISCORD_BOT_CHANNELS || '')
const serverChatChannelMap = parseBotChannelMap(env.DISCORD_SERVER_CHAT_CHANNELS || process.env.DISCORD_SERVER_CHAT_CHANNELS || '')
const javaServerChatChannels = new Set(csv(env.DISCORD_JAVA_SERVER_CHAT_CHANNELS || process.env.DISCORD_JAVA_SERVER_CHAT_CHANNELS || ''))
const javaServerOpChannels = new Set(csv(env.DISCORD_JAVA_SERVER_OP_CHANNELS || process.env.DISCORD_JAVA_SERVER_OP_CHANNELS || ''))
const allowedRoleIds = csv(env.DISCORD_ALLOWED_ROLE_IDS || process.env.DISCORD_ALLOWED_ROLE_IDS || '')
const allowedUserIds = csv(env.DISCORD_ALLOWED_USER_IDS || process.env.DISCORD_ALLOWED_USER_IDS || '')
const mcChatToDiscord = bool(env.MC_CHAT_TO_DISCORD ?? process.env.MC_CHAT_TO_DISCORD ?? '1')
const discordToMcChat = bool(env.DISCORD_TO_MC_CHAT ?? process.env.DISCORD_TO_MC_CHAT ?? '1')
const intents = 1 | 512 | 32768
const pidFile = path.join(__dirname, 'discord-bridge.pid')

try {
  fs.writeFileSync(pidFile, String(process.pid), 'utf8')
} catch {}

function cleanupPidFile() {
  try {
    if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile)
  } catch {}
}

process.once('exit', cleanupPidFile)
process.once('SIGINT', () => {
  cleanupPidFile()
  process.exit(0)
})
process.once('SIGTERM', () => {
  cleanupPidFile()
  process.exit(0)
})

if (!token) {
  console.error('DISCORD_TOKEN ontbreekt. Vul F:\\minecraft-discord-bot\\.env in.')
  process.exit(1)
}

let gateway = null
let heartbeatTimer = null
let sequence = null
let sessionId = null
let resumeGatewayUrl = null
let reconnecting = false
let botUserId = ''
let botUsername = ''
let lastBridgeKeys = new Set()
let lastJavaServerKeys = new Set()
let chatSyncTimer = null

connectGateway().catch(fatal)

async function connectGateway(resume = false) {
  const gatewayUrl = resume && resumeGatewayUrl ? resumeGatewayUrl : await getGatewayUrl()
  gateway = new WebSocket(`${gatewayUrl}?v=10&encoding=json`)

  gateway.addEventListener('open', () => console.log(`Discord gateway connected (${resume ? 'resume' : 'identify'})`))
  gateway.addEventListener('message', event => handleGatewayMessage(event.data).catch(err => console.log('Gateway message failed:', err.message)))
  gateway.addEventListener('close', event => {
    clearHeartbeat()
    console.log(`Discord gateway closed: ${event.code} ${event.reason || ''}`.trim())
    scheduleReconnect(event.code === 1000 ? false : Boolean(sessionId))
  })
  gateway.addEventListener('error', () => {
    console.log('Discord gateway websocket error.')
    try { gateway.close() } catch {}
  })
}

async function handleGatewayMessage(raw) {
  const packet = JSON.parse(raw)
  if (packet.s !== null && packet.s !== undefined) sequence = packet.s

  if (packet.op === 10) {
    startHeartbeat(packet.d.heartbeat_interval)
    if (sessionId && resumeGatewayUrl) sendGateway(6, { token, session_id: sessionId, seq: sequence })
    else identify()
    return
  }
  if (packet.op === 1) {
    heartbeat()
    return
  }
  if (packet.op === 7) {
    try { gateway.close(4000, 'reconnect requested') } catch {}
    return
  }
  if (packet.op === 9) {
    sessionId = null
    identify()
    return
  }
  if (packet.t === 'READY') {
    sessionId = packet.d.session_id
    resumeGatewayUrl = packet.d.resume_gateway_url
    botUserId = packet.d.user?.id || ''
    botUsername = packet.d.user?.username || 'Discord bridge'
    console.log(`Discord bridge online as ${botUsername}`)
    console.log(`Hub: ${hubUrl}`)
    console.log(`Java server manager: ${javaServerUrl}`)
    console.log(`Prefix: ${prefix}`)
    console.log(`Bot channels: ${botChannelMap.size || (bridgeChannelId ? 'shared' : 0)}`)
    console.log(`Server chat channels: ${serverChatChannelMap.size}`)
    console.log(`Java server chat channels: ${javaServerChatChannels.size}`)
    console.log(`Java server operator channels: ${javaServerOpChannels.size}`)
    ensureChatSync()
    return
  }
  if (packet.t === 'MESSAGE_CREATE') await handleDiscordMessage(packet.d)
}

async function handleDiscordMessage(message) {
  if (message.author?.bot || message.author?.id === botUserId) return
  if (!isAllowed(message)) return

  const content = String(message.content || '').trim()
  if (isAiCommand(content)) {
    try {
      await sendDirectAiCommand(message, content)
    } catch (err) {
      console.log('AI command failed:', err)
      await reply(message, `Fout: ${err.message || err}`)
    }
    return
  }

  const bridgeChat = discordToMcChat && isDiscordToMinecraftChatChannel(message.channel_id) && !content.startsWith(prefix)
  if (bridgeChat) {
    await sendDiscordChatToMinecraft(message)
    return
  }

  const javaServerChat = discordToMcChat && isJavaServerChannel(message.channel_id) && !content.startsWith(prefix)
  if (javaServerChat) {
    await sendDiscordChatToJavaServer(message)
    return
  }

  if (!content.startsWith(prefix)) return
  const args = splitArgs(content.slice(prefix.length).trim())
  const command = String(args.shift() || 'help').toLowerCase()

  try {
    if (command === 'help') return replyHelp(message)
    if (command === 'info') return replyInfo(message)
    if (command === 'status') return replyStatus(message)
    if (command === 'chat') return replyChat(message)
    if (command === 'start') return botAction(message, 'start', args)
    if (command === 'stop') return botAction(message, 'stop', args)
    if (command === 'send') return sendCommand(message, args)
    if (command === 'preset') return applyPreset(message, args)
    if (command === 'bots') return botsCommand(message, args)
    if (command === 'discord') return discordCommand(message, args)
    if (command === 'link') return linkChannel(message, args)
    if (command === 'unlink') return unlinkChannel(message)
    if (command === 'server') return serverChatCommand(message, args)
    if (command === 'java') return javaServerCommand(message, args)
    return reply(message, `Onbekend commando. Gebruik \`${prefix} help\`.`)
  } catch (err) {
    console.log('Command failed:', err)
    return reply(message, `Fout: ${err.message || err}`)
  }
}

async function replyHelp(message) {
  return replyEmbed(message, {
    title: 'Minecraft AI Bot Hub',
    description: 'Gebruik deze commands om je Mineflayer bots vanuit Discord te besturen.',
    color: 0x2d7db8,
    thumbnail: { url: mcHeadUrl('Steve') },
    fields: [
      { name: `${prefix} status`, value: 'Status van alle bots.', inline: false },
      { name: `${prefix} chat`, value: 'Laatste Minecraft chatregels.', inline: false },
      { name: `${prefix} start all`, value: 'Start alle bots.', inline: true },
      { name: `${prefix} stop all`, value: 'Stop alle bots.', inline: true },
      { name: `${prefix} send all ai status`, value: 'Stuur een command naar alle bots.', inline: false },
      { name: `${prefix} send group:Ungrouped ai stop`, value: 'Stuur een command naar een groep.', inline: false },
      { name: `${prefix} preset all survival`, value: 'Pas een preset toe.', inline: false },
      { name: `${prefix} preset official-bot guard WhiteCoffee01`, value: 'Preset met spelernaam.', inline: false },
      { name: `${prefix} info`, value: 'Net overzicht van Discord commands, AI commands en bot commands.', inline: false },
      { name: `${prefix} discord setup`, value: 'Stel de Discord server compleet in met botkanalen en Java serverkanalen.', inline: false },
      { name: `${prefix} bots setup`, value: 'Maak automatisch een Discord-kanaal per bot met de in-game username als kanaalnaam.', inline: false },
      { name: `${prefix} link official-bot`, value: 'Koppel dit Discord-kanaal aan een bot.', inline: false },
      { name: `${prefix} unlink`, value: 'Verwijder de bot-koppeling voor dit kanaal.', inline: false },
      { name: `${prefix} server chat link official-bot`, value: 'Koppel dit kanaal aan de serverchat die een bot ziet.', inline: false },
      { name: `${prefix} server chat link 192.168.2.77:25565`, value: 'Koppel dit kanaal aan een server via IP/host.', inline: false },
      { name: `${prefix} server chat unlink`, value: 'Verwijder de serverchat-koppeling voor dit kanaal.', inline: false },
      { name: `${prefix} java chat link`, value: 'Koppel dit kanaal aan de chat van F:\\minecraft-java-server zonder operator access.', inline: false },
      { name: `${prefix} java op link`, value: 'Koppel dit kanaal aan de Java serverchat met operator/console access.', inline: false },
      { name: `${prefix} java setup`, value: 'Maak automatisch twee Discord-kanalen: normale chat en operator-console.', inline: false },
      { name: `${prefix} java cmd list`, value: 'Voer een consolecommand uit in een Java operator-kanaal.', inline: false }
    ]
  })
}

async function replyInfo(message) {
  const discordCommands = [
    `${prefix} info`,
    `${prefix} help`,
    `${prefix} status / ${prefix} bots status`,
    `${prefix} chat`,
    `${prefix} discord setup`,
    `${prefix} bots setup`,
    `${prefix} link <botnaam>`,
    `${prefix} unlink`,
    `${prefix} server chat link <botnaam|server-ip[:poort]>`,
    `${prefix} server chat unlink`,
    `${prefix} java setup`,
    `${prefix} java chat link/unlink`,
    `${prefix} java op link/unlink`,
    `${prefix} java cmd <command>`,
    `${prefix} start all | ${prefix} stop all`,
    `${prefix} send <all|bot|group:naam> <command>`,
    `${prefix} preset <all|bot|group:naam> <preset> [player]`
  ]
  const aiCommands = [
    'ai help',
    'ai status',
    'ai inv',
    'ai follow',
    'ai stop',
    'ai auto on/off',
    'ai auto mine/farm/combat/movement/crafting/world/progression/general',
    'ai explore',
    'ai gather <item> <amount>',
    'ai craft <item>',
    'ai recipes',
    'ai go to <x> <y> <z>',
    'ai set home / ai home',
    'ai guard <player>',
    'ai pvp',
    'ai viewer on/off'
  ]
  const botCommands = [
    'start/stop vanuit Discord of Hub',
    'preset survival/miner/explorer/pvp/guard',
    'chat via gekoppeld botkanaal',
    'serverchat via gekoppeld serverchat-kanaal',
    'inventory bekijken/drop via HUD',
    'viewer aan/uit via HUD of ai viewer',
    'settings per bot via Hub',
    'knowledge copy/merge via Hub'
  ]
  return sendMessage(message.channel_id, '', message.id, {
    embeds: [
      cleanEmbed({
        title: 'Discord Commands',
        description: commandList(discordCommands),
        color: 0x2d7db8,
        thumbnail: { url: bridgeAvatarUrl() }
      }),
      cleanEmbed({
        title: 'AI Commands',
        description: commandList(aiCommands),
        color: 0x57f2a0,
        thumbnail: { url: mcHeadUrl('Steve') }
      }),
      cleanEmbed({
        title: 'Bot Commands / Beheer',
        description: commandList(botCommands),
        color: 0xf1c75b,
        thumbnail: { url: bridgeAvatarUrl() },
        timestamp: new Date().toISOString()
      })
    ]
  })
}

async function replyStatus(message) {
  const state = await hubGet('/api/state')
  const embeds = state.bots.slice(0, 10).map(bot => {
    const running = bot.status?.running ? 'running' : 'stopped'
    const mc = bot.telemetry?.connected ? 'MC online' : 'MC offline'
    const hp = bot.telemetry?.health ?? '-'
    const food = bot.telemetry?.food ?? '-'
    const pos = bot.telemetry?.position
    const position = pos ? `\nPos: ${pos.x}, ${pos.y}, ${pos.z}` : ''
    const username = bot.telemetry?.username || bot.name
    return cleanEmbed({
      author: { name: bot.name, icon_url: mcHeadUrl(username) },
      description: `${running}\n${mc}\nHP: ${hp} | Food: ${food}${position}`,
      color: bot.telemetry?.connected ? 0x57f2a0 : 0xff6b8a,
      footer: { text: `HUD ${bot.hudPort} | Viewer ${bot.viewerPort}` },
      timestamp: new Date().toISOString()
    })
  })
  if (!embeds.length) return replyResult(message, 'Minecraft Bot Status', 'Er zijn geen bots gevonden.', { thumbnailUrl: bridgeAvatarUrl() })
  return sendMessage(message.channel_id, '', message.id, { embeds })
}

async function replyChat(message) {
  const state = await hubGet('/api/state')
  const channelBotIds = getMappedBotIdsForChannel(message.channel_id, state)
  const lines = []
  for (const bot of state.bots) {
    if (channelBotIds && !channelBotIds.includes(bot.id)) continue
    for (const entry of bot.telemetry?.chatHistory || []) lines.push({ bot: bot.name, ...entry })
  }
  lines.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''))
  const recent = lines.slice(-12)
  const text = recent.map(line => {
    const time = line.at ? new Date(line.at).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' }) : '--:--:--'
    return `[${time}] ${line.bot} ${line.author || line.role}: ${line.message || ''}`
  }).join('\n')
  const last = recent[recent.length - 1]
  return replyEmbed(message, {
    title: 'Minecraft Chat',
    description: text ? codeBlock(text) : 'Nog geen chat ontvangen.',
    color: 0x2d7db8,
    thumbnail: last ? { url: mcHeadUrl(last.author || last.bot) } : undefined,
    timestamp: new Date().toISOString()
  })
}

async function botAction(message, action, args) {
  const target = args.join(' ').trim()
  if (!target) throw new Error(`Gebruik: ${prefix} ${action} all of ${prefix} ${action} <botnaam>`)
  if (target.toLowerCase() === 'all') {
    const result = await hubPost('/api/bots/action', { action })
    return replyResult(message, `${action} all`, `${result.bots.length} uitgevoerd, ${result.skipped.length} overgeslagen.`, { thumbnailUrl: bridgeAvatarUrl() })
  }
  const bot = await findBot(target)
  const result = await hubPost(`/api/bots/${encodeURIComponent(bot.id)}/${action}`, {})
  return replyResult(message, `${action}: ${bot.name}`, result.ok ? 'OK' : 'Niet gelukt', { thumbnailUrl: botAvatarUrl(bot) })
}

async function sendCommand(message, args) {
  if (args.length < 2) throw new Error(`Gebruik: ${prefix} send all ai status`)
  const target = args.shift()
  const text = args.join(' ').trim()
  const botIds = await resolveTarget(target)
  const result = await hubPost('/api/command', { botIds, text })
  return replyResult(message, 'Command verstuurd', `Naar ${result.sent.length}: ${result.sent.join(', ') || '-'}${result.skipped.length ? `\nSkipped: ${result.skipped.join(', ')}` : ''}`, { thumbnailUrl: discordAvatarUrl(message) })
}

async function applyPreset(message, args) {
  if (args.length < 2) throw new Error(`Gebruik: ${prefix} preset all survival`)
  const target = args.shift()
  const presetName = args.shift()
  const player = args.join(' ').trim()
  const state = await hubGet('/api/state')
  const preset = state.presets.find(item => item.id.toLowerCase() === presetName.toLowerCase() || item.name.toLowerCase() === presetName.toLowerCase())
  if (!preset) throw new Error(`Preset niet gevonden: ${presetName}`)
  const request = { presetId: preset.id, player }
  if (target.toLowerCase() === 'all') {
    request.targetType = 'all'
  } else if (target.toLowerCase().startsWith('group:')) {
    request.targetType = 'group'
    request.group = target.slice(6)
  } else {
    request.targetType = 'bots'
    request.botIds = [findBotInState(target, state).id]
  }
  const result = await hubPost('/api/presets/apply', request)
  return replyResult(message, `Preset ${result.preset}`, `Toegepast op: ${result.sent.join(', ') || '-'}`, { thumbnailUrl: bridgeAvatarUrl() })
}

async function botsCommand(message, args) {
  const sub = String(args.shift() || '').toLowerCase()
  if (!sub || sub === 'status') return replyStatus(message)
  if (sub === 'setup') return setupBotChannels(message)
  throw new Error(`Gebruik: ${prefix} bots setup of ${prefix} bots status`)
}

async function setupBotChannels(message) {
  if (!message.guild_id) throw new Error('Dit command werkt alleen in een Discord server.')
  const channels = await listDiscordGuildChannels(message.guild_id)
  const category = await getOrCreateDiscordCategory(message.guild_id, channels, 'bots')
  const result = await setupBotChannelsForGuild(message.guild_id, category.id, channels)
  return replyResult(message, 'Botkanalen ingesteld', botSetupSummary(result), { thumbnailUrl: bridgeAvatarUrl() })
}

async function discordCommand(message, args) {
  const sub = String(args.shift() || '').toLowerCase()
  if (sub === 'setup') return setupDiscordServer(message)
  throw new Error(`Gebruik: ${prefix} discord setup`)
}

async function setupDiscordServer(message) {
  if (!message.guild_id) throw new Error('Dit command werkt alleen in een Discord server.')
  const channels = await listDiscordGuildChannels(message.guild_id)
  const javaCategory = await getOrCreateDiscordCategory(message.guild_id, channels, 'java chats')
  const botsCategory = await getOrCreateDiscordCategory(message.guild_id, channels, 'bots')
  const javaResult = await setupJavaChannelsForGuild(message.guild_id, javaCategory.id, channels)
  const serverChatResult = await setupServerChatChannelForGuild(message.guild_id, javaCategory.id, channels)
  const botResult = await setupBotChannelsForGuild(message.guild_id, botsCategory.id, channels)
  return replyResult(message, 'Discord server ingesteld', [
    `Categorie: ${javaCategory.name}`,
    `Categorie: ${botsCategory.name}`,
    botSetupSummary(botResult),
    `Java serverkanalen: ${javaResult.created.concat(javaResult.reused).join(', ') || '-'}`,
    `Serverchat-kanaal: ${serverChatResult.channel ? `#${serverChatResult.channel.name}` : 'niet gekoppeld'}`,
    'Botkanalen gebruiken de in-game username als kanaalnaam.'
  ].join('\n'), { thumbnailUrl: bridgeAvatarUrl() })
}

async function setupBotChannelsForGuild(guildId, parentId = '', knownChannels = null) {
  if (!guildId) throw new Error('Dit command werkt alleen in een Discord server.')
  const state = await hubGet('/api/state')
  const bots = Array.isArray(state.bots) ? state.bots : []
  if (!bots.length) throw new Error('Geen bots gevonden in de Hub.')
  const existingChannels = knownChannels || await listDiscordGuildChannels(guildId)
  const created = []
  const reused = []
  for (const bot of bots) {
    const username = botInGameUsername(bot)
    const channelName = discordChannelName(username)
    const existing = existingChannels.find(channel => channel.type === 0 && channel.name === channelName)
    const channel = existing || await createDiscordTextChannel(guildId, {
      name: channelName,
      topic: `Minecraft bot chat voor ${username}. Commands zoals ai status gaan alleen naar deze bot.`,
      parentId
    })
    if (existing && parentId && existing.parent_id !== parentId) await updateDiscordChannelParent(existing.id, parentId)
    if (!existing) existingChannels.push(channel)
    existing ? reused.push(`#${channel.name}`) : created.push(`#${channel.name}`)
    botChannelMap.set(String(channel.id), bot.id)
  }
  saveChannelMap('DISCORD_BOT_CHANNELS', botChannelMap)
  ensureChatSync()
  return { created, reused, total: bots.length }
}

async function setupServerChatChannelForGuild(guildId, parentId = '', knownChannels = null) {
  const state = await hubGet('/api/state')
  const bot = bestServerChatBot(state)
  const existingChannels = knownChannels || await listDiscordGuildChannels(guildId)
  const existing = existingChannels.find(channel => channel.type === 0 && channel.name === 'server-chat')
  const channel = existing || await createDiscordTextChannel(guildId, {
    name: 'server-chat',
    topic: 'Serverchat die via een mineflayer bot wordt gezien. Gewone tekst gaat naar Minecraft chat.',
    parentId
  })
  if (existing && parentId && existing.parent_id !== parentId) await updateDiscordChannelParent(existing.id, parentId)
  if (!existing) existingChannels.push(channel)
  if (bot) {
    serverChatChannelMap.set(String(channel.id), bot.id)
    saveChannelMap('DISCORD_SERVER_CHAT_CHANNELS', serverChatChannelMap)
    ensureChatSync()
  }
  return { channel, bot, created: existing ? [] : [`#${channel.name}`], reused: existing ? [`#${channel.name}`] : [] }
}

function botSetupSummary(result) {
  return [
    result.created.length ? `Botkanalen gemaakt: ${result.created.join(', ')}` : '',
    result.reused.length ? `Botkanalen hergebruikt: ${result.reused.join(', ')}` : '',
    `Botkanalen gekoppeld: ${result.total}`
  ].filter(Boolean).join('\n')
}

async function linkChannel(message, args) {
  const target = args.join(' ').trim()
  if (!target) throw new Error(`Gebruik: ${prefix} link <botnaam>`)
  const bot = findExactBotInState(target, await hubGet('/api/state'))
  botChannelMap.set(String(message.channel_id), bot.id)
  saveChannelMap('DISCORD_BOT_CHANNELS', botChannelMap)
  ensureChatSync()
  return replyResult(message, 'Kanaal gekoppeld', `Dit Discord-kanaal is nu gekoppeld aan \`${bot.name}\`.\nCommands zoals \`ai help\` gaan alleen naar deze bot.`, { thumbnailUrl: botAvatarUrl(bot) })
}

async function unlinkChannel(message) {
  const removed = botChannelMap.delete(String(message.channel_id))
  saveChannelMap('DISCORD_BOT_CHANNELS', botChannelMap)
  return replyResult(message, 'Kanaal losgekoppeld', removed ? 'Dit Discord-kanaal heeft geen eigen bot-koppeling meer.' : 'Dit kanaal had nog geen bot-koppeling.', { thumbnailUrl: bridgeAvatarUrl() })
}

async function serverChatCommand(message, args) {
  const sub = String(args.shift() || '').toLowerCase()
  const action = String(args.shift() || '').toLowerCase()
  if (sub !== 'chat') throw new Error(`Gebruik: ${prefix} server chat link <botnaam>`)
  if (action === 'link') return linkServerChatChannel(message, args)
  if (action === 'unlink') return unlinkServerChatChannel(message)
  throw new Error(`Gebruik: ${prefix} server chat link <botnaam>`)
}

async function linkServerChatChannel(message, args) {
  const target = args.join(' ').trim()
  if (!target) throw new Error(`Gebruik: ${prefix} server chat link <botnaam of server-ip[:poort]>`)
  const bot = findBotOrServerInState(target, await hubGet('/api/state'))
  serverChatChannelMap.set(String(message.channel_id), bot.id)
  saveChannelMap('DISCORD_SERVER_CHAT_CHANNELS', serverChatChannelMap)
  ensureChatSync()
  return replyResult(message, 'Serverchat gekoppeld', `Dit Discord-kanaal toont nu de serverchat via \`${bot.name}\`.\nJe kunt hier gewone tekst typen om via deze bot in Minecraft chat te praten.`, { thumbnailUrl: botAvatarUrl(bot) })
}

async function unlinkServerChatChannel(message) {
  const removed = serverChatChannelMap.delete(String(message.channel_id))
  saveChannelMap('DISCORD_SERVER_CHAT_CHANNELS', serverChatChannelMap)
  return replyResult(message, 'Serverchat losgekoppeld', removed ? 'Dit kanaal toont geen aparte serverchat meer.' : 'Dit kanaal had nog geen serverchat-koppeling.', { thumbnailUrl: bridgeAvatarUrl() })
}

async function javaServerCommand(message, args) {
  const area = String(args.shift() || '').toLowerCase()
  const action = String(args.shift() || '').toLowerCase()
  if (area === 'setup') return setupJavaServerChannels(message)
  if (area === 'status') return replyJavaServerStatus(message)
  if (area === 'chat') {
    if (action === 'link') return linkJavaServerChannel(message, 'chat')
    if (action === 'unlink') return unlinkJavaServerChannel(message, 'chat')
    if (!action) return replyJavaServerChat(message)
  }
  if (area === 'op') {
    if (action === 'link') return linkJavaServerChannel(message, 'op')
    if (action === 'unlink') return unlinkJavaServerChannel(message, 'op')
  }
  if (area === 'cmd') return runJavaServerOperatorCommand(message, [action, ...args].filter(Boolean).join(' '))
  throw new Error(`Gebruik: ${prefix} java chat link, ${prefix} java op link, of ${prefix} java cmd list`)
}

async function setupJavaServerChannels(message) {
  if (!message.guild_id) throw new Error('Dit command werkt alleen in een Discord server.')
  const channels = await listDiscordGuildChannels(message.guild_id)
  const category = await getOrCreateDiscordCategory(message.guild_id, channels, 'java chats')
  const result = await setupJavaChannelsForGuild(message.guild_id, category.id, channels)
  return replyResult(message, 'Java serverkanalen gemaakt', [
    result.created.length ? `Gemaakt: ${result.created.join(', ')}` : '',
    result.reused.length ? `Hergebruikt: ${result.reused.join(', ')}` : '',
    `Chat zonder operator access: <#${result.chat.id}>`,
    `Operator/console access: <#${result.op.id}>`,
    'Tip: zet Discord-rechten op het operator-kanaal strak, want daar werken servercommands.'
  ].filter(Boolean).join('\n'), { thumbnailUrl: bridgeAvatarUrl() })
}

async function setupJavaChannelsForGuild(guildId, parentId = '', knownChannels = null) {
  const existingChannels = knownChannels || await listDiscordGuildChannels(guildId)
  const created = []
  const reused = []
  const chatName = 'minecraft-java-chat'
  const opName = 'minecraft-java-operator'
  const existingChat = existingChannels.find(channel => channel.type === 0 && channel.name === chatName)
  const chat = existingChat || await createDiscordTextChannel(guildId, {
    name: chatName,
    topic: 'Minecraft Java serverchat zonder operator access. Gewone tekst wordt serverchat.',
    parentId
  })
  if (existingChat && parentId && existingChat.parent_id !== parentId) await updateDiscordChannelParent(existingChat.id, parentId)
  if (!existingChat) existingChannels.push(chat)
  existingChat ? reused.push(`#${chat.name}`) : created.push(`#${chat.name}`)
  const existingOp = existingChannels.find(channel => channel.type === 0 && channel.name === opName)
  const op = existingOp || await createDiscordTextChannel(guildId, {
    name: opName,
    topic: 'Minecraft Java operator-console. Berichten met / worden servercommands.',
    parentId
  })
  if (existingOp && parentId && existingOp.parent_id !== parentId) await updateDiscordChannelParent(existingOp.id, parentId)
  if (!existingOp) existingChannels.push(op)
  existingOp ? reused.push(`#${op.name}`) : created.push(`#${op.name}`)
  javaServerChatChannels.add(String(chat.id))
  javaServerOpChannels.add(String(op.id))
  saveSet('DISCORD_JAVA_SERVER_CHAT_CHANNELS', javaServerChatChannels)
  saveSet('DISCORD_JAVA_SERVER_OP_CHANNELS', javaServerOpChannels)
  ensureChatSync()
  return { chat, op, created, reused }
}

async function linkJavaServerChannel(message, mode) {
  const channelId = String(message.channel_id)
  if (mode === 'op') {
    javaServerOpChannels.add(channelId)
    javaServerChatChannels.delete(channelId)
    saveSet('DISCORD_JAVA_SERVER_OP_CHANNELS', javaServerOpChannels)
    saveSet('DISCORD_JAVA_SERVER_CHAT_CHANNELS', javaServerChatChannels)
    ensureChatSync()
    return replyResult(message, 'Java server operator gekoppeld', `Dit kanaal toont de chat/logs van \`F:\\minecraft-java-server\` en mag consolecommands sturen.\nTyp gewone tekst voor serverchat of \`/list\`, \`/time set day\`, enzovoort voor operator commands.`, { thumbnailUrl: bridgeAvatarUrl() })
  }
  javaServerChatChannels.add(channelId)
  javaServerOpChannels.delete(channelId)
  saveSet('DISCORD_JAVA_SERVER_CHAT_CHANNELS', javaServerChatChannels)
  saveSet('DISCORD_JAVA_SERVER_OP_CHANNELS', javaServerOpChannels)
  ensureChatSync()
  return replyResult(message, 'Java serverchat gekoppeld', `Dit kanaal toont de chat van \`F:\\minecraft-java-server\` zonder operator access.\nGewone tekst wordt als serverchat gestuurd. Commands met \`/\` worden hier geblokkeerd.`, { thumbnailUrl: bridgeAvatarUrl() })
}

async function unlinkJavaServerChannel(message, mode) {
  const channelId = String(message.channel_id)
  const set = mode === 'op' ? javaServerOpChannels : javaServerChatChannels
  const removed = set.delete(channelId)
  saveSet(mode === 'op' ? 'DISCORD_JAVA_SERVER_OP_CHANNELS' : 'DISCORD_JAVA_SERVER_CHAT_CHANNELS', set)
  return replyResult(message, 'Java serverkanaal losgekoppeld', removed ? 'Dit kanaal is losgekoppeld van de Java server.' : 'Dit kanaal had die Java server-koppeling nog niet.', { thumbnailUrl: bridgeAvatarUrl() })
}

async function replyJavaServerStatus(message) {
  const state = await javaGet('/api/state')
  const status = state.status || {}
  return replyEmbed(message, {
    title: 'Minecraft Java Server',
    description: [
      `Status: ${status.running ? 'online' : 'offline'}`,
      `PID: ${status.pid || '-'}`,
      `Adres: ${status.address || `localhost:${status.port || 25565}`}`,
      `Poort: ${status.port || '-'}`,
      `Listening: ${status.listening ? 'yes' : 'no'}`
    ].join('\n'),
    color: status.running ? 0x57f2a0 : 0xff6b8a,
    thumbnail: { url: bridgeAvatarUrl() },
    timestamp: new Date().toISOString()
  })
}

async function replyJavaServerChat(message) {
  const state = await javaGet('/api/state')
  const lines = (state.logs?.out || []).slice(-12).map(formatJavaServerLogLine).filter(Boolean)
  return replyEmbed(message, {
    title: 'Java Server Chat',
    description: lines.length ? codeBlock(lines.join('\n')) : 'Nog geen serverchat ontvangen.',
    color: 0x2d7db8,
    thumbnail: { url: bridgeAvatarUrl() },
    timestamp: new Date().toISOString()
  })
}

async function runJavaServerOperatorCommand(message, command) {
  if (!javaServerOpChannels.has(String(message.channel_id))) throw new Error(`Dit kanaal heeft geen operator access. Gebruik eerst \`${prefix} java op link\`.`)
  const text = String(command || '').replace(/^\//, '').trim()
  if (!text) throw new Error(`Gebruik: ${prefix} java cmd list`)
  const result = await javaPost('/api/command', { command: text })
  return replyResult(message, 'Java command verstuurd', `Command: \`${escapeInlineCode(result.command || text)}\``, { thumbnailUrl: discordAvatarUrl(message) })
}

async function sendDirectAiCommand(message, text) {
  const command = String(text || '').trim().slice(0, 240)
  const state = await hubGet('/api/state')
  const botIds = getMappedBotIdsForChannel(message.channel_id, state) || []
  const result = await hubPost('/api/command', { botIds, text: command })
  const description = [
    `Command: \`${escapeInlineCode(command)}\``,
    `Naar ${result.sent.length}: ${result.sent.join(', ') || '-'}`,
    result.skipped.length ? `Skipped: ${result.skipped.join(', ')}` : ''
  ].filter(Boolean).join('\n')
  return replyResult(message, 'AI command verstuurd', description, { thumbnailUrl: discordAvatarUrl(message) })
}

async function sendDiscordChatToMinecraft(message) {
  const state = await hubGet('/api/state')
  const botIds = getServerChatBotIdsForChannel(message.channel_id, state) || []
  const name = message.member?.nick || message.author?.global_name || message.author?.username || 'Discord'
  const text = `[Discord] ${name}: ${message.content}`.slice(0, 240)
  try {
    const result = await hubPost('/api/command', { botIds, text })
    if (!result.sent.length) console.log('Discord chat skipped: no Minecraft bots received the message.')
  } catch (err) {
    console.log('Discord to Minecraft chat failed:', err.message)
  }
}

async function sendDiscordChatToJavaServer(message) {
  const channelId = String(message.channel_id)
  const content = String(message.content || '').trim()
  if (!content) return
  const isOperator = javaServerOpChannels.has(channelId)
  const name = message.member?.nick || message.author?.global_name || message.author?.username || 'Discord'
  try {
    if (content.startsWith('/')) {
      if (!isOperator) {
        await reply(message, `Dit Java serverkanaal heeft geen operator access. Gebruik gewone tekst, of maak een apart kanaal met \`${prefix} java op link\`.`)
        return
      }
      await javaPost('/api/command', { command: content.replace(/^\//, '').trim() })
      return
    }
    await javaPost('/api/chat', { source: 'discord', username: name, message: content })
  } catch (err) {
    console.log('Discord to Java server failed:', err.message)
    await reply(message, `Java server fout: ${err.message}`)
  }
}

function isAiCommand(content) {
  return /^ai(?:\s|$)/i.test(String(content || '').trim())
}

async function syncMinecraftChatToDiscord() {
  const state = await hubGet('/api/state')
  const nextKeys = new Set()
  const lines = []
  for (const bot of state.bots) {
    for (const entry of bot.telemetry?.chatHistory || []) {
      const key = [bot.id, entry.at, entry.role, entry.author, entry.message].join('\u0001')
      nextKeys.add(key)
      if (lastBridgeKeys.size && !lastBridgeKeys.has(key) && ['player', 'private', 'ai', 'server'].includes(entry.role)) {
        lines.push({ botId: bot.id, bot: bot.name, ...entry })
      }
    }
  }
  lastBridgeKeys = nextKeys
  lines.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''))
  for (const line of lines.slice(-8)) {
    const channelIds = getDiscordChannelsForLine(line, state)
    const content = formatMinecraftChatLine(line)
    for (const channelId of channelIds) {
      await sendMessage(channelId, content)
    }
  }
}

async function syncJavaServerToDiscord() {
  if (!javaServerChatChannels.size && !javaServerOpChannels.size) return
  const state = await javaGet('/api/state')
  const nextKeys = new Set()
  const lines = []
  for (const raw of state.logs?.out || []) {
    const line = String(raw || '')
    const key = line
    nextKeys.add(key)
    if (lastJavaServerKeys.size && !lastJavaServerKeys.has(key)) lines.push(line)
  }
  lastJavaServerKeys = nextKeys
  for (const line of lines.slice(-10)) {
    const formatted = formatJavaServerLogLine(line)
    const isChat = isJavaServerChatLine(line)
    if (isChat) {
      for (const channelId of javaServerChatChannels) await sendMessage(channelId, formatted)
    }
    const opFormatted = formatJavaServerLogLine(line, true)
    for (const channelId of javaServerOpChannels) await sendMessage(channelId, opFormatted)
  }
}

function formatMinecraftChatLine(line) {
  const bot = escapeDiscord(line.bot || 'bot')
  const author = escapeDiscord(line.author || line.role || 'Minecraft')
  const message = escapeDiscord(line.message || '')
  if (line.role === 'server') return `\`${bot}\` [server] ${message}`
  if (line.role === 'private') return `\`${bot}\` [private] **${author}**: ${message}`
  if (line.role === 'ai') return `\`${bot}\` **${author}**: ${message}`
  return `\`${bot}\` **${author}**: ${message}`
}

function formatJavaServerLogLine(line, operator = false) {
  const raw = String(line || '').trim()
  const parsed = raw.match(/^\[([^\]]+)\] \[[^\]]+\]:\s*(.*)$/)
  const body = parsed ? parsed[2] : raw
  const time = parsed ? parsed[1].split(' ')[0] : ''
  const clean = body
    .replace(/^\[Not Secure\]\s*/i, '')
    .replace(/^\[Server\]\s*/i, '[Server] ')
  const prefixText = operator ? 'java-console' : 'java-server'
  return time ? `\`${prefixText}\` [${escapeDiscord(time)}] ${escapeDiscord(clean)}` : `\`${prefixText}\` ${escapeDiscord(clean)}`
}

function isJavaServerChatLine(line) {
  const text = String(line || '')
  if (/\]: <[^>]+> /.test(text)) return true
  if (/\]: \[Not Secure\]\s*<[^>]+> /.test(text)) return true
  if (/\]: \[Not Secure\] \[Server\]/.test(text)) return true
  if (/\]: [A-Za-z0-9_]{1,16} (joined|left) the game/.test(text)) return true
  if (/\]: [A-Za-z0-9_]{1,16} .*(was |drowned|fell|died|burned|blew up|slain|shot|suffocated|starved|withered|hit the ground|tried to swim in lava|went up in flames|walked into fire|experienced kinetic energy)/i.test(text)) return true
  return false
}

function hasDiscordChatTargets() {
  return Boolean(bridgeChannelId || botChannelMap.size || serverChatChannelMap.size || javaServerChatChannels.size || javaServerOpChannels.size)
}

function ensureChatSync() {
  if (!mcChatToDiscord || !hasDiscordChatTargets() || chatSyncTimer) return
  chatSyncTimer = setInterval(() => {
    syncMinecraftChatToDiscord().catch(err => console.log('Chat sync failed:', err.message))
    syncJavaServerToDiscord().catch(err => console.log('Java server sync failed:', err.message))
  }, 4000)
  syncMinecraftChatToDiscord().catch(err => console.log('Initial chat sync failed:', err.message))
  syncJavaServerToDiscord().catch(err => console.log('Initial Java server sync failed:', err.message))
}

function getMappedBotIdsForChannel(channelId, state) {
  const id = String(channelId || '')
  const target = botChannelMap.get(id) || serverChatChannelMap.get(id)
  if (!target) return null
  const bot = findBotInState(target, state)
  return [bot.id]
}

function getServerChatBotIdsForChannel(channelId, state) {
  const target = serverChatChannelMap.get(String(channelId || ''))
  if (!target) return null
  const bot = findBotInState(target, state)
  return [bot.id]
}

function getDiscordChannelsForLine(line, state) {
  if (!botChannelMap.size && !serverChatChannelMap.size) return bridgeChannelId ? [bridgeChannelId] : []
  const channels = []
  if (isBotOwnChatRole(line.role)) channels.push(...getChannelsForBot(line.botId, state, botChannelMap))
  if (isServerChatRole(line.role)) channels.push(...getChannelsForBot(line.botId, state, serverChatChannelMap))
  return [...new Set(channels)]
}

function getChannelsForBot(botId, state, map) {
  const channels = []
  for (const [channelId, mappedBotId] of map) {
    const bot = safeFindBotInState(mappedBotId, state)
    if (bot?.id === botId) channels.push(channelId)
  }
  return channels
}

function isBotOwnChatRole(role) {
  return ['ai', 'system'].includes(String(role || '').toLowerCase())
}

function isServerChatRole(role) {
  return ['player', 'server'].includes(String(role || '').toLowerCase())
}

function isMinecraftChatChannel(channelId) {
  const id = String(channelId || '')
  return Boolean(botChannelMap.has(id) || serverChatChannelMap.has(id) || (bridgeChannelId && id === bridgeChannelId))
}

function isDiscordToMinecraftChatChannel(channelId) {
  const id = String(channelId || '')
  return Boolean(serverChatChannelMap.has(id) || (bridgeChannelId && id === bridgeChannelId))
}

function isJavaServerChannel(channelId) {
  const id = String(channelId || '')
  return Boolean(javaServerChatChannels.has(id) || javaServerOpChannels.has(id))
}

function safeFindBotInState(name, state) {
  try {
    return findBotInState(name, state)
  } catch {
    return null
  }
}

async function resolveTarget(target) {
  if (!target || target.toLowerCase() === 'all') return []
  const state = await hubGet('/api/state')
  if (target.toLowerCase().startsWith('group:')) {
    const group = target.slice(6)
    return state.bots.filter(bot => String(bot.group).toLowerCase() === group.toLowerCase()).map(bot => bot.id)
  }
  return [findBotInState(target, state).id]
}

async function findBot(name) {
  return findBotInState(name, await hubGet('/api/state'))
}

function findBotInState(name, state) {
  const raw = String(name || '').trim()
  const needle = raw.toLowerCase()
  const bots = Array.isArray(state?.bots) ? state.bots : []
  const exact = exactBotMatch(needle, bots)
  if (exact) return exact

  const partial = bots.filter(item => String(item.name).toLowerCase().includes(needle))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new Error(`Meerdere bots gevonden voor "${raw}": ${partial.map(item => item.name).join(', ')}. Gebruik de volledige botnaam.`)
  }
  throw new Error(`Bot niet gevonden: ${raw}`)
}

function findExactBotInState(name, state) {
  const raw = String(name || '').trim()
  const needle = raw.toLowerCase()
  const bot = exactBotMatch(needle, Array.isArray(state?.bots) ? state.bots : [])
  if (!bot) throw new Error(`Bot exact niet gevonden: ${raw}. Gebruik de volledige botnaam zoals bot2.`)
  return bot
}

function findBotOrServerInState(target, state) {
  const raw = String(target || '').trim()
  const exact = exactBotMatch(raw.toLowerCase(), Array.isArray(state?.bots) ? state.bots : [])
  if (exact) return exact
  return findServerBotInState(raw, state)
}

function findServerBotInState(target, state) {
  const parsed = parseServerTarget(target)
  if (!parsed.host) throw new Error(`Bot of server niet gevonden: ${target}`)
  const bots = Array.isArray(state?.bots) ? state.bots : []
  const matches = bots.filter(bot => {
    const host = normalizeServerHost(bot.telemetry?.botSettings?.host || bot.host)
    const port = Number(bot.telemetry?.botSettings?.port || bot.port || 25565)
    return host === parsed.host && (!parsed.port || port === parsed.port)
  })
  if (!matches.length) throw new Error(`Geen bot gevonden op server ${target}. Start eerst een bot op die server.`)
  return matches.find(bot => bot.telemetry?.connected) || matches[0]
}

function exactBotMatch(needle, bots) {
  return bots.find(item => String(item.id).toLowerCase() === needle || String(item.name).toLowerCase() === needle)
}

function parseServerTarget(target) {
  const raw = String(target || '').trim()
  const ipv6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (ipv6) return { host: normalizeServerHost(ipv6[1]), port: ipv6[2] ? Number(ipv6[2]) : 0 }
  const index = raw.lastIndexOf(':')
  if (index > 0 && raw.indexOf(':') === index) {
    const maybePort = Number(raw.slice(index + 1))
    if (Number.isInteger(maybePort) && maybePort > 0) return { host: normalizeServerHost(raw.slice(0, index)), port: maybePort }
  }
  return { host: normalizeServerHost(raw), port: 0 }
}

function normalizeServerHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '')
}

async function getGatewayUrl() {
  const data = await discordRequest('GET', '/gateway/bot')
  return data.url
}

function identify() {
  sendGateway(2, {
    token,
    intents,
    properties: {
      os: 'windows',
      browser: 'minecraft-ai-hub',
      device: 'minecraft-ai-hub'
    }
  })
}

function sendGateway(op, d) {
  if (gateway?.readyState === WebSocket.OPEN) gateway.send(JSON.stringify({ op, d }))
}

function startHeartbeat(interval) {
  clearHeartbeat()
  heartbeatTimer = setInterval(heartbeat, interval)
  heartbeat()
}

function heartbeat() {
  sendGateway(1, sequence)
}

function clearHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function scheduleReconnect(canResume) {
  if (reconnecting) return
  reconnecting = true
  setTimeout(() => {
    reconnecting = false
    connectGateway(canResume).catch(fatal)
  }, 3000)
}

async function reply(message, content) {
  return sendMessage(message.channel_id, content, message.id)
}

async function replyEmbed(message, embed) {
  return sendMessage(message.channel_id, '', message.id, { embeds: [cleanEmbed(embed)] })
}

async function replyResult(message, title, description, options = {}) {
  const thumbnailUrl = options.thumbnailUrl || mcHeadUrl(options.username || 'WhiteCoffee01')
  return replyEmbed(message, {
    title,
    description,
    color: 0x57f2a0,
    thumbnail: { url: thumbnailUrl },
    timestamp: new Date().toISOString()
  })
}

async function sendMessage(channelId, content, replyTo = '', options = {}) {
  const body = {
    content: String(content || '').slice(0, 2000),
    allowed_mentions: { parse: [] },
    ...options
  }
  if (!body.content && !body.embeds?.length) body.content = ' '
  if (replyTo) body.message_reference = { message_id: replyTo, fail_if_not_exists: false }
  return discordRequest('POST', `/channels/${channelId}/messages`, body)
}

async function createDiscordTextChannel(guildId, options) {
  const body = {
    name: String(options.name || 'minecraft-java-chat').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 90),
    type: 0,
    topic: String(options.topic || '').slice(0, 1024)
  }
  if (options.parentId) body.parent_id = String(options.parentId)
  return discordRequest('POST', `/guilds/${guildId}/channels`, body)
}

async function createDiscordCategory(guildId, name) {
  return discordRequest('POST', `/guilds/${guildId}/channels`, {
    name: String(name || 'minecraft').slice(0, 90),
    type: 4
  })
}

async function updateDiscordChannelParent(channelId, parentId) {
  return discordRequest('PATCH', `/channels/${channelId}`, {
    parent_id: String(parentId)
  })
}

async function getOrCreateDiscordCategory(guildId, channels, name) {
  const existing = channels.find(channel => channel.type === 4 && String(channel.name || '').toLowerCase() === String(name).toLowerCase())
  if (existing) return existing
  const category = await createDiscordCategory(guildId, name)
  channels.push(category)
  return category
}

async function listDiscordGuildChannels(guildId) {
  return discordRequest('GET', `/guilds/${guildId}/channels`)
}

function cleanEmbed(embed) {
  const output = { ...embed }
  if (output.description) output.description = String(output.description).slice(0, 4096)
  if (Array.isArray(output.fields)) {
    output.fields = output.fields.slice(0, 25).map(field => ({
      name: String(field.name || '-').slice(0, 256),
      value: String(field.value || '-').slice(0, 1024),
      inline: Boolean(field.inline)
    }))
  }
  return output
}

function mcHeadUrl(username) {
  const name = String(username || 'Steve').match(/[A-Za-z0-9_]{1,16}/)?.[0] || 'Steve'
  return `https://minotar.net/helm/${encodeURIComponent(name)}/64.png`
}

function botAvatarUrl(bot) {
  return mcHeadUrl(bot?.telemetry?.username || bot?.telemetry?.botSettings?.username || bot?.name || 'WhiteCoffee01')
}

function botInGameUsername(bot) {
  return String(bot?.telemetry?.username || bot?.telemetry?.botSettings?.username || bot?.username || bot?.name || 'bot').trim()
}

function bestServerChatBot(state) {
  const bots = Array.isArray(state?.bots) ? state.bots : []
  return bots.find(bot => bot.telemetry?.connected && /192\.168\.2\.28|localhost|127\.0\.0\.1/i.test(String(bot.host || bot.telemetry?.botSettings?.host || ''))) ||
    bots.find(bot => bot.telemetry?.connected) ||
    bots[0] ||
    null
}

function discordChannelName(value) {
  const name = String(value || 'bot')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return name || 'bot'
}

function commandList(items) {
  return items.map(item => `- \`${String(item).replace(/`/g, "'")}\``).join('\n').slice(0, 4096)
}

function bridgeAvatarUrl() {
  return mcHeadUrl('WhiteCoffee01')
}

function discordAvatarUrl(message) {
  const user = message?.author || {}
  if (user.id && user.avatar) {
    const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
  }
  const discriminator = user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id || '0') >> 22n) % 6n)
  return `https://cdn.discordapp.com/embed/avatars/${Number.isFinite(discriminator) ? discriminator : 0}.png`
}

async function discordRequest(method, endpoint, body = null) {
  const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (response.status === 204) return {}
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `Discord request failed: ${response.status}`)
  return data
}

async function hubGet(pathname) {
  const response = await fetch(`${hubUrl}${pathname}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `Hub request failed: ${response.status}`)
  return data
}

async function hubPost(pathname, body) {
  const response = await fetch(`${hubUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `Hub request failed: ${response.status}`)
  return data
}

async function javaGet(pathname) {
  const response = await fetch(`${javaServerUrl}${pathname}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `Java server request failed: ${response.status}`)
  return data
}

async function javaPost(pathname, body) {
  const response = await fetch(`${javaServerUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `Java server request failed: ${response.status}`)
  return data
}

function isAllowed(message) {
  if (!allowedUserIds.length && !allowedRoleIds.length) return true
  if (allowedUserIds.includes(message.author?.id)) return true
  const roles = message.member?.roles || []
  return allowedRoleIds.some(id => roles.includes(id))
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return {}
  const output = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    output[key] = value
  }
  return output
}

function splitArgs(text) {
  return String(text || '').match(/"[^"]+"|'[^']+'|\S+/g)?.map(part => part.replace(/^["']|["']$/g, '')) || []
}

function codeBlock(text) {
  return `\`\`\`\n${String(text || '').slice(0, 1850)}\n\`\`\``
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function csv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function parseBotChannelMap(value) {
  const map = new Map()
  for (const entry of csv(value)) {
    const index = entry.includes(':') ? entry.indexOf(':') : entry.indexOf('=')
    if (index <= 0) continue
    const channelId = entry.slice(0, index).trim()
    const botId = entry.slice(index + 1).trim()
    if (/^\d{10,30}$/.test(channelId) && botId) map.set(channelId, botId)
  }
  return map
}

function saveChannelMap(key, map) {
  const serialized = [...map].map(([channelId, botId]) => `${channelId}:${botId}`).join(',')
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
  const line = `${key}=${serialized}`
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.replace(/\s*$/, '')}\r\n${line}\r\n`
  fs.writeFileSync(envFile, next, 'utf8')
}

function saveSet(key, set) {
  const serialized = [...set].join(',')
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
  const line = `${key}=${serialized}`
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.replace(/\s*$/, '')}\r\n${line}\r\n`
  fs.writeFileSync(envFile, next, 'utf8')
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bool(value) {
  return !['0', 'false', 'no', 'off'].includes(String(value || '').toLowerCase())
}

function escapeDiscord(value) {
  return String(value || '').replace(/([*_`~|])/g, '\\$1').slice(0, 500)
}

function escapeInlineCode(value) {
  return String(value || '').replace(/`/g, "'").slice(0, 240)
}

function fatal(err) {
  console.error(err.message || err)
  process.exit(1)
}
