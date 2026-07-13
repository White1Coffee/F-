'use strict'
class BotRegistry {
  constructor(options = {}) { this.offlineAfterMs = options.offlineAfterMs || 12000; this.now = options.now || Date.now; this.bots = new Map() }
  register(payload, channel = null) {
    if (!payload?.botId || !payload?.instanceId || !payload?.worldId) throw new Error('INVALID_BOT_REGISTRATION')
    const previous = this.bots.get(payload.botId)
    const bot = { ...payload, channel, online: true, registeredAt: this.now(), lastHeartbeatAt: this.now(), idleSince: this.now(), replacedInstanceId: previous?.instanceId !== payload.instanceId ? previous?.instanceId || null : null }
    this.bots.set(payload.botId, bot); return { bot, replaced: Boolean(previous && previous.instanceId !== payload.instanceId), previous }
  }
  heartbeat(payload) {
    const bot = this.bots.get(payload?.botId)
    if (!bot || bot.instanceId !== payload.instanceId) throw new Error('STALE_BOT_INSTANCE')
    Object.assign(bot, payload, { online: true, lastHeartbeatAt: this.now() })
    if (!payload.currentTaskId && !payload.currentTeamGoalId) bot.idleSince ||= this.now(); else bot.idleSince = null
    return bot
  }
  unregister(botId, instanceId) { const bot=this.bots.get(botId); if(!bot||bot.instanceId!==instanceId)return false;bot.online=false;bot.offlineAt=this.now();return true }
  sweep() { const offline=[];for(const bot of this.bots.values())if(bot.online&&this.now()-bot.lastHeartbeatAt>this.offlineAfterMs){bot.online=false;bot.offlineAt=this.now();offline.push(bot)}return offline }
  list() { return [...this.bots.values()].map(({ channel, ...bot }) => bot) }
  get(id) { return this.bots.get(id) || null }
}
module.exports = { BotRegistry }
