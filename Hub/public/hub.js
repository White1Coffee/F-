let state = { bots: [] }
    let health = null
    let discord = null
    let lastMergedFolder = ''
    let viewerRenderKey = ''
    const loadedViewers = new Set()
    const hubChatLines = []
    const mergeTargets = new Map()
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]))
    const amsterdamTime = value => new Intl.DateTimeFormat('nl-NL', {
      timeZone:'Europe/Amsterdam',
      hour:'2-digit',
      minute:'2-digit',
      second:'2-digit',
      hour12:false
    }).format(value ? new Date(value) : new Date())

    async function api(url, options = {}) {
      const response = await fetch(url, {
        headers: { 'Content-Type':'application/json', ...(options.headers || {}) },
        ...options
      })
      const text = await response.text()
      let result
      try {
        result = text ? JSON.parse(text) : {}
      } catch {
        throw new Error('Hub API returned HTML instead of JSON. Restart the Hub with Start.cmd so the new backend is active.')
      }
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Hub request failed.')
      return result
    }

    function notify(message, bad = false) {
      const status = document.getElementById('hubStatus')
      status.textContent = message
      status.parentElement.style.color = bad ? 'var(--red)' : 'var(--green)'
      clearTimeout(notify.timer)
      notify.timer = setTimeout(() => {
        status.textContent = 'Hub online'
        status.parentElement.style.color = 'var(--green)'
      }, 5000)
    }

    function localServiceUrl(port) {
      const host = location.hostname || 'localhost'
      return `http://${host}:${port}`
    }

    function renderTopStatus() {
      const onlineBots = (state.bots || []).filter(bot => bot.telemetry?.connected || bot.status?.running).length
      const botsChip = document.getElementById('botsTopStatus')
      const discordChip = document.getElementById('discordTopStatus')
      botsChip.textContent = `${onlineBots} / ${(state.bots || []).length} bots online`
      botsChip.classList.toggle('online', onlineBots > 0)
      const bridge = state.discordBridge || discord
      const discordOnline = Boolean(bridge?.running)
      discordChip.textContent = discordOnline ? `Discord online${bridge.pid ? ` (${bridge.pid})` : ''}` : 'Discord offline'
      discordChip.classList.toggle('online', discordOnline)
      discordChip.classList.toggle('bad', !discordOnline)
    }

    function botCard(bot) {
      const status = bot.status || {}
      const paused = status.pausedMs > 0
      const label = paused ? 'Paused' : (status.running ? (status.managed ? 'Running' : 'HUD online') : 'Stopped')
      const statusClass = paused ? 'external' : (status.running ? (status.managed ? 'online' : 'external') : '')
      const versionOptions = minecraftVersionOptions(bot.version)
      return `<article class="bot-card" data-id="${esc(bot.id)}">
        <div class="card-head">
          <div><h2>${esc(bot.name)}</h2><p>${esc(bot.folder)}</p></div>
          <span class="pill ${statusClass}"><i class="dot"></i>${label}</span>
        </div>
        <div class="fields">
          <label class="wide">Display name<input data-field="name" value="${esc(bot.name)}"></label>
          <label>Server host<input data-field="host" value="${esc(bot.host)}"></label>
          <label>Server port<input data-field="port" type="number" min="1" max="65535" value="${esc(bot.port)}"></label>
          <label>Minecraft version<select data-field="version">${versionOptions}</select></label>
          <label>HUD port<input data-field="hudPort" type="number" min="1" max="65535" value="${esc(bot.hudPort)}"></label>
          <label>Viewer port<input data-field="viewerPort" type="number" min="1" max="65535" value="${esc(bot.viewerPort)}"></label>
          <label>Group<select data-field="group">${[...new Set([...(state.groups || []), bot.group || 'Ungrouped'])].map(group => `<option ${group === bot.group ? 'selected' : ''}>${esc(group)}</option>`).join('')}</select></label>
          <label>Auto restart<select data-field="autoRestart"><option value="true" ${bot.autoRestart ? 'selected' : ''}>Enabled</option><option value="false" ${!bot.autoRestart ? 'selected' : ''}>Disabled</option></select></label>
        </div>
        <div class="links">
          <a href="${esc(localServiceUrl(bot.hudPort))}" target="_blank" rel="noopener">Open dashboard</a>
          <a href="${esc(localServiceUrl(bot.viewerPort))}" target="_blank" rel="noopener">Open viewer</a>
        </div>
        <div class="actions">
          <button type="button" data-action="start" ${status.running || paused ? 'disabled' : ''}>Turn on</button>
          <button type="button" data-action="stop" class="secondary" ${status.running ? '' : 'disabled'}>Stop</button>
          <button type="button" data-action="save" class="secondary" ${status.managed ? 'disabled' : ''}>Save</button>
          <button type="button" data-action="folder" class="secondary">Open folder</button>
          <button type="button" data-action="remove" class="danger" ${status.running ? 'disabled' : ''}>Remove</button>
        </div>
        <p>Starts: ${bot.stats?.starts || 0} | Crashes: ${bot.stats?.crashes || 0} | Runtime: ${Math.round((bot.stats?.totalRuntimeMs || 0) / 60000)} min${bot.stats?.lastError ? ` | Last error: ${esc(bot.stats.lastError)}` : ''}</p>
      </article>`
    }

    function minecraftVersionOptions(selected = '') {
      const versions = state.supportedMinecraftVersions || ['1.21.4']
      return versions.map(version => `<option value="${esc(version)}" ${version === selected ? 'selected' : ''}>${esc(version)}</option>`).join('')
    }

    function renderBots() {
      if (document.activeElement?.closest?.('.bot-card')) return
      document.getElementById('botGrid').innerHTML = state.bots.length
        ? state.bots.map(botCard).join('')
        : '<div class="empty">No bot folders registered.</div>'
    }

    function renderOverview() {
      if (document.activeElement?.closest?.('.bot-send')) return
      document.getElementById('overviewCount').textContent = `${state.bots.length} bot${state.bots.length === 1 ? '' : 's'}`
      if (!state.bots.length) {
        document.getElementById('overviewTable').innerHTML = '<div class="empty">No bot folders registered.</div>'
        return
      }
      const meter = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1).replace('.0', '')} / 20` : '-'
      const rows = state.bots.map(bot => {
        const data = bot.telemetry
        const position = data?.position ? `${data.position.x}, ${data.position.y}, ${data.position.z}` : '-'
        const connection = data ? (data.connected ? 'ONLINE' : 'OFFLINE') : (bot.status?.hudOnline ? 'HUD ONLY' : 'OFFLINE')
        const connectionClass = data?.connected ? 'value-good' : 'value-bad'
        return `<tr>
          <td><strong>${esc(bot.name)}</strong><br><a href="${esc(localServiceUrl(bot.hudPort))}" target="_blank" rel="noopener">Open dashboard</a></td>
          <td>${esc(data?.username || '-')}</td>
          <td>${meter(data?.health)}</td>
          <td>${meter(data?.food)}</td>
          <td>${esc(data?.mode || '-')}</td>
          <td>${data ? (data.autonomy ? 'ON' : 'OFF') : '-'}</td>
          <td>${data ? (data.pvp ? 'ON' : 'OFF') : '-'}</td>
          <td>${data?.xp ?? '-'}</td>
          <td>${esc(position)}</td>
          <td class="${connectionClass}">${connection}</td>
          <td><form class="bot-send" data-bot-id="${esc(bot.id)}"><input placeholder="Chat or AI command" ${data?.connected ? '' : 'disabled'}><button type="submit" ${data?.connected ? '' : 'disabled'}>Send</button></form></td>
        </tr>`
      }).join('')
      document.getElementById('overviewTable').innerHTML = `<table>
        <thead><tr><th>Bot</th><th>Username</th><th>HP</th><th>Food</th><th>Mode</th><th>Autonomy</th><th>PvP</th><th>XP</th><th>Position</th><th>Connection</th><th>Message / command</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    }

    async function sendHubInput(text, botIds = []) {
      const result = await api('/api/command', {
        method:'POST',
        body:JSON.stringify({ text, botIds })
      })
      const skipped = result.skipped.length ? ` Skipped offline: ${result.skipped.join(', ')}.` : ''
      const targetNames = botIds.length
        ? state.bots.filter(bot => botIds.includes(bot.id)).map(bot => bot.name).join(', ') || 'selected bots'
        : 'All bots'
      hubChatLines.push({ at:new Date().toISOString(), botName:'Hub', role:'sent', author:targetNames, message:text })
      hubChatLines.splice(0, Math.max(0, hubChatLines.length - 80))
      renderChat()
      return `Sent to ${result.sent.length} bot${result.sent.length === 1 ? '' : 's'}.${skipped}`
    }

    function renderMerge() {
      const selected = new Set([...document.querySelectorAll('#mergeList input:checked')].map(input => input.value))
      document.getElementById('mergeList').innerHTML = state.bots.length
        ? state.bots.map(bot => `<label class="merge-row">
            <input type="checkbox" value="${esc(bot.id)}" ${selected.has(bot.id) ? 'checked' : ''} ${bot.status?.running ? 'disabled' : ''}>
            <span><strong>${esc(bot.name)}</strong><p>${esc(bot.folder)}\\knowledge</p></span>
            <span class="pill ${bot.status?.running ? 'external' : ''}">${bot.status?.running ? 'Running' : 'Ready'}</span>
          </label>`).join('')
        : '<div class="empty">Add bot folders before merging knowledge.</div>'
      updateMergeSelection()
      renderMergedKnowledge()
    }

    function botOptions(includeEmpty = true) {
      return `${includeEmpty ? '<option value="">Choose bot</option>' : ''}${state.bots.map(bot => `<option value="${esc(bot.id)}">${esc(bot.name)}</option>`).join('')}`
    }

    function renderManage() {
      const selectedTargets = new Set([...document.querySelectorAll('#updateTargets input:checked')].map(input => input.value))
      const previousLogBot = document.getElementById('logBot').value
      const previousSource = document.getElementById('updateSource').value
      const previousClone = document.getElementById('cloneSource').value
      const previousRestore = document.getElementById('restoreBot').value
      const previousKnowledgeSource = document.getElementById('knowledgeSource').value
      const previousKnowledgeTarget = document.getElementById('knowledgeTarget').value
      const previousPreset = document.getElementById('presetSelect').value
      const groups = state.groups || []
      document.getElementById('groupList').innerHTML = groups.map(group => `<div class="item"><strong>${esc(group)}</strong><span class="inline"><button class="secondary" data-group-action="start" data-group="${esc(group)}">Start</button><button class="secondary" data-group-action="stop" data-group="${esc(group)}">Stop</button>${group === 'Ungrouped' ? '' : `<button class="danger" data-group-delete="${esc(group)}">Delete</button>`}</span></div>`).join('') || '<p>No groups yet.</p>'
      document.getElementById('profileList').innerHTML = (state.serverProfiles || []).map(profile => `<div class="item"><strong>${esc(profile.name)}</strong><span>${esc(profile.host)}:${esc(profile.port)} | ${esc(profile.version || '1.21.4')} <button class="secondary" data-apply-profile="${esc(profile.id)}">Apply to selected update targets</button></span></div>`).join('') || '<p>No server profiles yet.</p>'
      document.getElementById('profileVersion').innerHTML = minecraftVersionOptions('1.21.4')
      document.getElementById('bulkVersion').innerHTML = minecraftVersionOptions('1.21.4')
      document.getElementById('presetSelect').innerHTML = (state.presets || []).map(preset => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join('')
      document.getElementById('presetList').innerHTML = (state.presets || []).map(preset => `<div class="item"><strong>${esc(preset.name)}</strong><span>${esc((preset.commands || []).join(' | '))}${preset.builtIn ? '<br>Built-in' : '<br>Custom'}</span></div>`).join('') || '<p>No presets yet.</p>'
      document.getElementById('scheduleGroup').innerHTML = groups.map(group => `<option>${esc(group)}</option>`).join('')
      document.getElementById('scheduleList').innerHTML = (state.schedules || []).map(schedule => `<div class="item"><strong>${esc(schedule.time)} ${esc(schedule.action)}</strong><span>${esc(schedule.group)}</span></div>`).join('') || '<p>No schedules yet.</p>'
      document.getElementById('updateSource').innerHTML = botOptions()
      document.getElementById('cloneSource').innerHTML = botOptions()
      document.getElementById('updateTargets').innerHTML = state.bots.map(bot => {
        const isSource = bot.id === previousSource
        return `<label class="target-bot"><input type="checkbox" value="${esc(bot.id)}" ${selectedTargets.has(bot.id) && !isSource ? 'checked' : ''} ${bot.status?.running || isSource ? 'disabled' : ''}><span>${esc(bot.name)}${isSource ? ' (source)' : ''}</span><span class="pill">${isSource ? 'Source' : (bot.status?.running ? 'Running' : 'Ready')}</span></label>`
      }).join('')
      document.getElementById('historyList').innerHTML = (state.mergeHistory || []).slice(0, 12).map(entry => `<div class="item"><strong>${esc(entry.action)}</strong><span>${esc(entry.mergeId || entry.backup || '')}<br>${esc((entry.bots || []).join(', '))}</span></div>`).join('') || '<p>No merge history yet.</p>'
      document.getElementById('restoreBot').innerHTML = botOptions()
      document.getElementById('knowledgeSource').innerHTML = botOptions()
      document.getElementById('knowledgeTarget').innerHTML = botOptions()
      document.getElementById('logBot').innerHTML = botOptions()
      document.getElementById('logBot').value = previousLogBot
      document.getElementById('updateSource').value = previousSource
      document.getElementById('cloneSource').value = previousClone
      document.getElementById('restoreBot').value = previousRestore
      document.getElementById('knowledgeSource').value = previousKnowledgeSource
      document.getElementById('knowledgeTarget').value = previousKnowledgeTarget
      document.getElementById('presetSelect').value = previousPreset || document.getElementById('presetSelect').value
      renderPresetTargets()
      updatePresetTargetUi()
    }

    function updatePresetTargetUi() {
      const preset = (state.presets || []).find(item => item.id === document.getElementById('presetSelect').value)
      document.getElementById('presetPlayer').style.display = preset?.requiresPlayer ? 'block' : 'none'
    }

    function renderPresets() {
      const previousPreset = document.getElementById('presetSelect').value
      const groups = state.groups || []
      const presets = state.presets || []
      document.getElementById('presetSelect').innerHTML = presets.map(preset => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join('')
      document.getElementById('presetSelect').value = previousPreset || document.getElementById('presetSelect').value
      document.getElementById('presetList').innerHTML = presets.map(preset => `
        <div class="item" data-preset-id="${esc(preset.id)}">
          <strong>${esc(preset.name)}</strong>
          <span>${esc((preset.commands || []).join(' | '))}<br>${preset.delayMs ? `${esc(preset.delayMs)}ms delay | ` : ''}${preset.builtIn ? 'Built-in' : 'Custom'} ${preset.builtIn ? '' : `<button type="button" class="secondary" data-preset-edit="${esc(preset.id)}">Edit</button> <button type="button" class="danger" data-preset-delete="${esc(preset.id)}">Delete</button>`}</span>
        </div>`).join('') || '<p>No presets yet.</p>'
      renderPresetTargets()
      updatePresetTargetUi()
    }

    function renderPresetTargets() {
      const target = document.getElementById('presetTargets')
      const previous = new Set([...target.querySelectorAll('input:checked')].map(input => input.value))
      const selected = previous.size ? previous : new Set(['all'])
      const groupBoxes = (state.groups || []).map(group => `<label><input type="checkbox" value="group:${esc(group)}" ${selected.has(`group:${group}`) ? 'checked' : ''}>Group: ${esc(group)}</label>`).join('')
      const botBoxes = state.bots.map(bot => `<label><input type="checkbox" value="bot:${esc(bot.id)}" ${selected.has(`bot:${bot.id}`) ? 'checked' : ''}>${esc(bot.name)}</label>`).join('')
      target.innerHTML = `<label><input type="checkbox" value="all" ${selected.has('all') ? 'checked' : ''}>All bots</label>${groupBoxes}${botBoxes}`
    }

    function selectedPresetPayload() {
      const selected = [...document.querySelectorAll('#presetTargets input:checked')].map(input => input.value)
      if (!selected.length || selected.includes('all')) return { targetType:'all', botIds:[], group:'' }
      const ids = new Set()
      for (const value of selected) {
        if (value.startsWith('bot:')) ids.add(value.slice(4))
        if (value.startsWith('group:')) {
          const group = value.slice(6)
          for (const bot of state.bots.filter(item => item.group === group)) ids.add(bot.id)
        }
      }
      return { targetType:'bot', botIds:[...ids], group:'' }
    }

    function renderChatTargets() {
      const target = document.getElementById('chatTargets')
      const previous = new Set([...target.querySelectorAll('input:checked')].map(input => input.value))
      const selected = previous.size ? previous : new Set(['all'])
      const groupBoxes = (state.groups || []).map(group => `<label><input type="checkbox" value="group:${esc(group)}" ${selected.has(`group:${group}`) ? 'checked' : ''}>Group: ${esc(group)}</label>`).join('')
      const botBoxes = state.bots.map(bot => `<label><input type="checkbox" value="bot:${esc(bot.id)}" ${selected.has(`bot:${bot.id}`) ? 'checked' : ''}>${esc(bot.name)}</label>`).join('')
      target.innerHTML = `<label><input type="checkbox" value="all" ${selected.has('all') ? 'checked' : ''}>All bots</label>${groupBoxes}${botBoxes}`
    }

    function selectedChatBotIds() {
      const selected = [...document.querySelectorAll('#chatTargets input:checked')].map(input => input.value)
      if (!selected.length || selected.includes('all')) return []
      const ids = new Set()
      for (const value of selected) {
        if (value.startsWith('bot:')) ids.add(value.slice(4))
        if (value.startsWith('group:')) {
          const group = value.slice(6)
          for (const bot of state.bots.filter(item => item.group === group)) ids.add(bot.id)
        }
      }
      return [...ids]
    }

    function renderChat() {
      renderChatTargets()
      const seen = new Set()
      const lines = []
      const addLine = line => {
        const key = [line.botName, line.at, line.role, line.author, line.message].map(value => String(value ?? '')).join('\u0001')
        if (seen.has(key)) return
        seen.add(key)
        lines.push(line)
      }
      for (const line of hubChatLines) addLine(line)
      for (const bot of state.bots) {
        for (const entry of bot.telemetry?.chatHistory || []) {
          addLine({ ...entry, botName:bot.name, sortAt:Date.parse(entry.at || '') || 0 })
        }
      }
      if (!lines.length) {
        for (const bot of state.bots) {
          addLine({
            at:new Date().toISOString(),
            botName:bot.name,
            role:bot.status?.hudOnline ? 'waiting' : 'offline',
            author:'Hub',
            message:bot.status?.hudOnline ? 'Waiting for chat from this bot.' : 'Bot is offline. Start it to receive chat.',
            sortAt:0
          })
        }
      }
      const chatSortTime = line => Number.isFinite(line.sortAt) ? line.sortAt : (Date.parse(line.at || '') || 0)
      lines.sort((left, right) => chatSortTime(left) - chatSortTime(right))
      const consoleEl = document.getElementById('chatConsole')
      const nearBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 80
      const visible = lines.slice(-220)
      consoleEl.innerHTML = visible.length ? visible.map(line => `
        <div class="chat-line">
          <span class="time">${esc(line.at ? amsterdamTime(line.at) : '--:--:--')}</span>
          <span class="bot">${esc(line.botName)}</span>
          <span class="role">${esc(line.role || 'chat')}</span>
          <span class="message">${esc(line.author ? `${line.author}: ${line.message || ''}` : line.message || '')}</span>
        </div>`).join('') : '<div class="empty">No bots yet. Add or start a bot to see chat here.</div>'
      if (nearBottom) consoleEl.scrollTop = consoleEl.scrollHeight
    }

    function bytes(value) {
      const size = Number(value || 0)
      if (!size) return '-'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let index = 0
      let next = size
      while (next >= 1024 && index < units.length - 1) {
        next /= 1024
        index++
      }
      return `${next.toFixed(index ? 1 : 0)} ${units[index]}`
    }

    function renderHealth() {
      const grid = document.getElementById('healthGrid')
      if (!health) {
        grid.innerHTML = '<div class="empty">Press Refresh health to run system checks.</div>'
        return
      }
      document.getElementById('healthChecked').textContent = `Checked ${amsterdamTime(health.checkedAt)}`
      const pathItems = health.paths.map(item => `<li><strong>${esc(item.name)}</strong><span class="${item.ok ? 'value-good' : 'value-bad'}">${item.ok ? 'OK' : 'Missing'}</span></li>`).join('')
      const portMap = new Map((health.ports || []).map(item => [Number(item.port), item.listening ? 'Listening' : 'Free']))
      const portStatus = port => portMap.get(Number(port)) || 'Free'
      const portClass = port => portStatus(port) === 'Listening' ? 'value-good' : ''
      const portItems = [
        `<li><strong>${esc(state.hubPort || 3100)}</strong><span class="${portClass(state.hubPort || 3100)}">${esc(portStatus(state.hubPort || 3100))}</span></li>`,
        ...state.bots.map(bot => `
          <li>
            <strong>${esc(bot.hudPort)} | ${esc(bot.viewerPort)}</strong>
            <span class="port-status-pair">
              <span class="${portClass(bot.hudPort)}">${esc(portStatus(bot.hudPort))}</span>
              <span class="${portClass(bot.viewerPort)}">${esc(portStatus(bot.viewerPort))}</span>
            </span>
          </li>`)
      ].join('')
      const diskUsed = health.disk?.size ? Math.round(((health.disk.size - health.disk.free) / health.disk.size) * 100) : 0
      const botItems = health.bots.map(bot => `<li><strong>${esc(bot.name)}</strong><span class="${bot.stats?.lastError ? 'value-bad' : 'value-good'}">${esc(bot.stats?.lastError || 'OK')}</span></li>`).join('')
      const discordStatus = health.discord || {}
      const discordOnline = discordStatus.running
      const configBackups = (health.configBackups || []).slice(0, 5).map(backup => `<li><strong>${esc(backup.name)}</strong><span>${esc(bytes(backup.size))}</span></li>`).join('')
      grid.innerHTML = `
        <div class="health-block"><h2>Required files</h2><ul>${pathItems}</ul></div>
        <div class="health-block"><h2>Ports</h2><ul class="compact-ports">${portItems}</ul></div>
        <div class="health-block"><h2>Backups and logs</h2><ul>
          <li><strong>Latest backup</strong><span>${esc(health.latestBackup?.name || 'None')}</span></li>
          <li><strong>Startup backups</strong><span>${esc(health.startupBackupCount)}</span></li>
          <li><strong>Config backups</strong><span>${esc((health.configBackups || []).length)}</span></li>
          <li><strong>Hub log files</strong><span>${esc(health.hubLogCount)}</span></li>
          ${configBackups}
        </ul></div>
        <div class="health-block"><h2>Discord bridge</h2><ul>
          <li><strong>Status</strong><span class="${discordOnline ? 'value-good' : 'value-bad'}">${discordOnline ? 'Online' : 'Offline'}</span></li>
          <li><strong>Bot channels</strong><span>${esc(discordStatus.botChannelCount || 0)}</span></li>
          <li><strong>Server chat channels</strong><span>${esc(discordStatus.serverChatChannelCount || 0)}</span></li>
          <li><strong>Last error</strong><span class="${discordStatus.lastError ? 'value-bad' : 'value-good'}">${esc(discordStatus.lastError || 'OK')}</span></li>
        </ul></div>
        <div class="health-block"><h2>USB drive</h2>
          <p>${esc(health.disk?.drive || 'Drive')} free: ${esc(bytes(health.disk?.free))} / ${esc(bytes(health.disk?.size))}</p>
          <div class="meter"><span style="width:${Math.min(100, Math.max(0, diskUsed))}%"></span></div>
        </div>
        <div class="health-block"><h2>Bot errors</h2><ul>${botItems || '<li><strong>No bots</strong><span>-</span></li>'}</ul></div>`
    }

    function renderDiscord() {
      const grid = document.getElementById('discordGrid')
      if (!discord) {
        grid.innerHTML = '<div class="empty">Press Refresh Discord to check the bridge.</div>'
        return
      }
      document.getElementById('discordChecked').textContent = `Checked ${amsterdamTime()}`
      renderTopStatus()
      const botChannels = (discord.botChannels || []).map(item => `<li><strong>${esc(item.botName)}</strong><span>${esc(item.channelId)}</span></li>`).join('')
      const serverChannels = (discord.serverChatChannels || []).map(item => `<li><strong>${esc(item.botName)}</strong><span>${esc(item.channelId)}</span></li>`).join('')
      const outLines = (discord.lastOutput || []).join('\n')
      const errLines = (discord.errorLines || []).join('\n')
      grid.innerHTML = `
        <div class="health-block"><h2>Bridge status</h2><ul>
          <li><strong>Installed</strong><span class="${discord.installed ? 'value-good' : 'value-bad'}">${discord.installed ? 'OK' : 'Missing'}</span></li>
          <li><strong>Status</strong><span class="${discord.running ? 'value-good' : 'value-bad'}">${discord.running ? 'Online' : 'Offline'}</span></li>
          <li><strong>PID</strong><span>${esc(discord.pid || '-')}</span></li>
          <li><strong>Prefix</strong><span>${esc(discord.prefix || '!mc')}</span></li>
          <li><strong>Hub URL</strong><span>${esc(discord.hubUrl || '-')}</span></li>
          <li><strong>Last error</strong><span class="${discord.lastError ? 'value-bad' : 'value-good'}">${esc(discord.lastError || 'OK')}</span></li>
        </ul></div>
        <div class="health-block"><h2>Linked bot channels</h2><ul>${botChannels || '<li><strong>No bot channels</strong><span>Use !mc link &lt;bot&gt;</span></li>'}</ul></div>
        <div class="health-block"><h2>Linked server chat</h2><ul>${serverChannels || '<li><strong>No server chat channels</strong><span>Use !mc server chat link &lt;bot&gt;</span></li>'}</ul></div>
        <div class="health-block"><h2>Bridge output</h2><div class="log-snippet">${esc(outLines || 'No output yet.')}</div></div>
        <div class="health-block"><h2>Bridge errors</h2><div class="log-snippet">${esc(errLines || 'No errors.')}</div></div>`
    }

    async function refreshDiscord() {
      try {
        const result = await api('/api/discord/status')
        discord = result.discord
        renderDiscord()
      } catch (err) {
        notify(err.message, true)
      }
    }

    function orderedViewerBots() {
      const order = state.viewerLayout?.order || []
      return [...state.bots].sort((a, b) => {
        const ai = order.indexOf(a.id)
        const bi = order.indexOf(b.id)
        return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi)
      })
    }

    function renderViewers(force = false) {
      const hidden = new Set(state.viewerLayout?.hidden || [])
      const bots = orderedViewerBots()
      const columns = state.viewerLayout?.columns || 2
      const key = JSON.stringify({ columns, hidden:[...hidden], bots:bots.map(bot => [bot.id, bot.status?.viewerOnline, bot.telemetry?.username]) })
      document.getElementById('viewerColumns').value = String(columns)
      document.getElementById('viewerGrid').style.setProperty('--viewer-columns', columns)
      if (!force && key === viewerRenderKey) return
      viewerRenderKey = key
      const visible = bots.filter(bot => !hidden.has(bot.id))
      for (const bot of bots) {
        if (!bot.status?.viewerOnline) loadedViewers.delete(bot.id)
      }
      document.getElementById('viewerGrid').innerHTML = visible.length ? visible.map((bot, index) => `
        <article class="viewer-card" data-viewer-id="${esc(bot.id)}" draggable="true">
          <div class="camera-label"><span class="camera-number">${String(index + 1).padStart(2, '0')}</span><span>${esc(bot.name)}</span></div>
          <div class="viewer-actions">
            <button class="secondary" data-viewer-toggle="${bot.status?.viewerOnline ? 'off' : 'on'}">${bot.status?.viewerOnline ? 'Off' : 'On'}</button>
            <button class="secondary" data-viewer-hide>Hide</button>
          </div>
          <div class="camera-username">${esc(bot.telemetry?.username || 'Username not available')}</div>
          <div class="viewer-frame">${bot.status?.viewerOnline
            ? (loadedViewers.has(bot.id)
              ? `<iframe src="${esc(localServiceUrl(bot.viewerPort))}" title="${esc(bot.name)} viewer" loading="lazy"></iframe>`
              : `<div class="viewer-placeholder"><div><strong>${esc(bot.name)}</strong><span>Viewer is online but not loaded.</span><button type="button" data-viewer-load>Load viewer</button><br><a href="${esc(localServiceUrl(bot.viewerPort))}" target="_blank" rel="noopener">Open in own tab</a></div></div>`)
            : '<div class="viewer-offline">Not available</div>'}</div>
        </article>`).join('') : '<div class="empty">All camera fields are hidden.</div>'
      document.getElementById('hiddenCameras').innerHTML = bots.filter(bot => hidden.has(bot.id)).map(bot => `<button class="secondary" data-viewer-show="${esc(bot.id)}">Show ${esc(bot.name)}</button>`).join('')
    }

    async function saveViewerLayout(layout) {
      await api('/api/config', { method:'POST', body:JSON.stringify({ viewerLayout:layout }) })
      state.viewerLayout = layout
      viewerRenderKey = ''
      await refresh()
    }

    function renderMergedKnowledge() {
      const merges = state.mergedKnowledge || []
      document.getElementById('mergedCount').textContent = `${merges.length} merge${merges.length === 1 ? '' : 's'}`
      document.getElementById('mergedList').innerHTML = merges.length
        ? merges.map(merge => `<div class="merged-entry">
            <div class="merge-entry-head">
              <div><strong>${esc(merge.id)}</strong><p>${merge.fileCount} JSON files<br>${esc(merge.folder)}</p></div>
              <button type="button" class="secondary" data-open-merge="${esc(merge.folder)}">Open folder</button>
            </div>
            <div class="target-bots">
              ${state.bots.map(bot => {
                const selected = mergeTargets.get(merge.id)?.has(bot.id)
                return `<label class="target-bot">
                  <input type="checkbox" data-merge-target="${esc(merge.id)}" value="${esc(bot.id)}" ${selected ? 'checked' : ''} ${bot.status?.running ? 'disabled' : ''}>
                  <span><strong>${esc(bot.name)}</strong><small>${esc(bot.folder)}\\knowledge</small></span>
                  <span class="pill ${bot.status?.running ? 'external' : ''}">${bot.status?.running ? 'Running' : 'Ready'}</span>
                </label>`
              }).join('')}
            </div>
            <div class="apply-controls">
              <span class="pill" data-target-count="${esc(merge.id)}">${mergeTargets.get(merge.id)?.size || 0} / 5 selected</span>
              <button type="button" data-apply-merge="${esc(merge.id)}" ${(mergeTargets.get(merge.id)?.size || 0) ? '' : 'disabled'}>Apply to selected bots</button>
            </div>
          </div>`).join('')
        : '<div class="empty">No merged knowledge folders yet.</div>'
      for (const merge of merges) updateMergeTargets(merge.id)
    }

    function updateMergeTargets(mergeId) {
      const boxes = [...document.querySelectorAll(`[data-merge-target="${CSS.escape(mergeId)}"]`)]
      const selected = boxes.filter(box => box.checked).map(box => box.value)
      mergeTargets.set(mergeId, new Set(selected))
      for (const box of boxes) {
        const bot = state.bots.find(item => item.id === box.value)
        box.disabled = Boolean(bot?.status?.running) || (!box.checked && selected.length >= 5)
      }
      const count = document.querySelector(`[data-target-count="${CSS.escape(mergeId)}"]`)
      const apply = document.querySelector(`[data-apply-merge="${CSS.escape(mergeId)}"]`)
      if (count) count.textContent = `${selected.length} / 5 selected`
      if (apply) apply.disabled = selected.length < 1 || selected.length > 5
    }

    async function refresh() {
      try {
        state = await api('/api/state')
        renderTopStatus()
        renderOverview()
        renderBots()
        renderMerge()
        renderManage()
        renderPresets()
        renderChat()
        renderViewers()
        if (document.getElementById('health').classList.contains('active')) await refreshHealth()
        if (document.getElementById('discordHealth').classList.contains('active')) await refreshDiscord()
      } catch (err) {
        notify(err.message, true)
      }
    }

    async function refreshHealth() {
      try {
        const result = await api('/api/health')
        health = result.health
        discord = result.health.discord || discord
        renderTopStatus()
        renderHealth()
      } catch (err) {
        notify(err.message, true)
      }
    }

    function cardData(card) {
      const value = field => card.querySelector(`[data-field="${field}"]`).value.trim()
      return {
        name: value('name'),
        host: value('host'),
        port: Number(value('port')),
        version: value('version'),
        hudPort: Number(value('hudPort')),
        viewerPort: Number(value('viewerPort'))
        ,group: value('group')
        ,autoRestart: value('autoRestart') === 'true'
      }
    }

    async function saveCard(card) {
      await api(`/api/bots/${encodeURIComponent(card.dataset.id)}`, {
        method:'PATCH',
        body:JSON.stringify(cardData(card))
      })
    }

    function activateTab(tabName, updateHash = true) {
      const button = document.querySelector(`nav button[data-tab="${CSS.escape(tabName)}"]`)
      if (!button) return
      document.querySelectorAll('nav button').forEach(item => item.classList.toggle('active', item === button))
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.id === button.dataset.tab))
      document.getElementById('title').textContent = button.textContent
      if (updateHash) history.replaceState(null, '', `#${button.dataset.tab}`)
      if (button.dataset.tab === 'health' && !health) refreshHealth()
      if (button.dataset.tab === 'discordHealth' && !discord) refreshDiscord()
    }

    document.querySelector('nav').addEventListener('click', event => {
      const button = event.target.closest('button[data-tab]')
      if (!button) return
      activateTab(button.dataset.tab)
    })

    window.addEventListener('hashchange', () => activateTab(location.hash.slice(1) || 'overview', false))

    document.getElementById('browseFolder').addEventListener('click', async () => {
      const button = document.getElementById('browseFolder')
      button.disabled = true
      try {
        notify('Waiting for folder selection...')
        const selection = await api('/api/folder-picker', { method:'POST', body:'{}' })
        if (!selection.folder) {
          notify('Folder selection cancelled')
          return
        }
        document.getElementById('folderPath').value = selection.folder
        notify('Folder selected')
      } catch (err) {
        notify(err.message, true)
      } finally {
        button.disabled = false
      }
    })

    document.getElementById('addFolder').addEventListener('click', async () => {
      const button = document.getElementById('addFolder')
      button.disabled = true
      try {
        const folder = document.getElementById('folderPath').value.trim()
        if (!folder) throw new Error('Choose a bot folder or enter its path first.')
        await api('/api/bots', { method:'POST', body:JSON.stringify({ folder }) })
        document.getElementById('folderPath').value = ''
        notify('Bot folder added')
        await refresh()
      } catch (err) {
        notify(err.message, true)
      } finally {
        button.disabled = false
      }
    })

    document.getElementById('addAllFolders').addEventListener('click', async () => {
      const button = document.getElementById('addAllFolders')
      button.disabled = true
      try {
        const folder = document.getElementById('folderPath').value.trim()
        if (!folder) throw new Error('Choose a parent folder or enter its path first.')
        const result = await api('/api/bots/import-folder', { method:'POST', body:JSON.stringify({ folder }) })
        notify(`Found ${result.found} bot folders; added ${result.added.length}.`)
        await refresh()
      } catch (err) { notify(err.message, true) } finally { button.disabled = false }
    })

    document.getElementById('bulkSettingsForm').addEventListener('submit', async event => {
      event.preventDefault()
      const status = document.getElementById('bulkSettingsStatus')
      try {
        const result = await api('/api/bots/bulk-settings', {
          method:'POST',
          body:JSON.stringify({ host:document.getElementById('bulkHost').value.trim(), port:Number(document.getElementById('bulkPort').value), version:document.getElementById('bulkVersion').value })
        })
        const skipped = result.skipped.length ? ` Skipped running bots: ${result.skipped.join(', ')}.` : ''
        status.textContent = `Applied ${result.host}:${result.port} (${result.version}) to ${result.updated.length} bot${result.updated.length === 1 ? '' : 's'}.${skipped}`
        notify(`Updated launch settings for ${result.updated.length} bots.`)
        await refresh()
      } catch (err) {
        status.textContent = err.message
        notify(err.message, true)
      }
    })

    document.getElementById('botGrid').addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]')
      const card = button?.closest('.bot-card')
      if (!button || !card) return
      button.disabled = true
      try {
        const id = encodeURIComponent(card.dataset.id)
        if (button.dataset.action === 'save') {
          await saveCard(card)
          notify('Launch settings saved')
        } else if (button.dataset.action === 'start') {
          await saveCard(card)
          await api(`/api/bots/${id}/start`, { method:'POST', body:'{}' })
          notify('Bot terminal opened')
        } else if (button.dataset.action === 'stop') {
          await api(`/api/bots/${id}/stop`, { method:'POST', body:'{}' })
          notify('Bot stopped')
        } else if (button.dataset.action === 'folder') {
          const bot = state.bots.find(item => item.id === card.dataset.id)
          await api('/api/open-folder', { method:'POST', body:JSON.stringify({ folder:bot.folder }) })
        } else if (button.dataset.action === 'remove') {
          if (!confirm('Remove this bot from the Hub? Its folder will stay on disk.')) return
          await api(`/api/bots/${id}`, { method:'DELETE' })
          notify('Bot removed from Hub')
        }
        await refresh()
      } catch (err) {
        notify(err.message, true)
        button.disabled = false
      }
    })

    document.getElementById('broadcastForm').addEventListener('submit', async event => {
      event.preventDefault()
      const input = document.getElementById('broadcastInput')
      const status = document.getElementById('broadcastStatus')
      try {
        status.textContent = await sendHubInput(input.value)
        input.value = ''
      } catch (err) {
        status.textContent = err.message
      }
    })

    async function runAllBotsAction(action) {
      const startButton = document.getElementById('startAllBots')
      const stopButton = document.getElementById('stopAllBots')
      startButton.disabled = true
      stopButton.disabled = true
      try {
        const result = await api('/api/bots/action', {
          method:'POST',
          body:JSON.stringify({ action })
        })
        const skipped = result.skipped?.length ? ` Skipped: ${result.skipped.join(', ')}.` : ''
        const errors = result.errors?.length ? ` Errors: ${result.errors.map(item => `${item.bot}: ${item.error}`).join(' | ')}` : ''
        notify(`${action === 'start' ? 'Started' : 'Stopped'} ${result.bots.length} bot${result.bots.length === 1 ? '' : 's'}.${skipped}${errors}`, Boolean(result.errors?.length))
        await refresh()
      } catch (err) {
        notify(err.message, true)
      } finally {
        startButton.disabled = false
        stopButton.disabled = false
      }
    }

    document.getElementById('startAllBots').addEventListener('click', () => runAllBotsAction('start'))
    document.getElementById('stopAllBots').addEventListener('click', () => runAllBotsAction('stop'))

    async function applyPresetSelection(payload) {
      const result = await api('/api/presets/apply', { method:'POST', body:JSON.stringify(payload) })
      const skipped = result.skipped.length ? ` Skipped offline: ${result.skipped.join(', ')}.` : ''
      notify(`Applied ${result.preset} to ${result.sent.length} bot${result.sent.length === 1 ? '' : 's'}.${skipped}`, Boolean(result.skipped.length && !result.sent.length))
      return result
    }

    document.getElementById('overviewTable').addEventListener('submit', async event => {
      const form = event.target.closest('.bot-send')
      if (!form) return
      event.preventDefault()
      const input = form.querySelector('input')
      const button = form.querySelector('button')
      button.disabled = true
      try {
        notify(await sendHubInput(input.value, [form.dataset.botId]))
        input.value = ''
      } catch (err) {
        notify(err.message, true)
      } finally {
        button.disabled = false
      }
    })

    function updateMergeSelection() {
      const inputs = [...document.querySelectorAll('#mergeList input[type="checkbox"]')]
      const selected = inputs.filter(input => input.checked)
      document.getElementById('mergeCount').textContent = `${selected.length} selected`
      document.getElementById('mergeButton').disabled = selected.length < 2 || selected.length > 5
      for (const input of inputs) {
        const bot = state.bots.find(item => item.id === input.value)
        input.disabled = Boolean(bot?.status?.running) || (!input.checked && selected.length >= 5)
      }
    }

    document.getElementById('mergeList').addEventListener('change', updateMergeSelection)
    document.getElementById('mergeButton').addEventListener('click', async () => {
      try {
        const botIds = [...document.querySelectorAll('#mergeList input:checked')].map(input => input.value)
        const result = await api('/api/merge', { method:'POST', body:JSON.stringify({ botIds }) })
        lastMergedFolder = result.output
        document.getElementById('openMerged').disabled = false
        const panel = document.getElementById('mergeResult')
        panel.className = 'notice good'
        panel.textContent = `Merged ${result.bots.length} bots and ${result.files.length} files into ${result.output}`
      } catch (err) {
        const panel = document.getElementById('mergeResult')
        panel.className = 'notice bad'
        panel.textContent = err.message
      }
    })

    document.getElementById('openMerged').addEventListener('click', async () => {
      try {
        await api('/api/open-folder', { method:'POST', body:JSON.stringify({ folder:lastMergedFolder }) })
      } catch (err) { notify(err.message, true) }
    })

    document.getElementById('mergedList').addEventListener('click', async event => {
      const openButton = event.target.closest('[data-open-merge]')
      if (openButton) {
        try {
          await api('/api/open-folder', { method:'POST', body:JSON.stringify({ folder:openButton.dataset.openMerge }) })
        } catch (err) { notify(err.message, true) }
        return
      }
      const applyButton = event.target.closest('[data-apply-merge]')
      if (!applyButton) return
      const mergeId = applyButton.dataset.applyMerge
      const botIds = [...(mergeTargets.get(mergeId) || [])]
      const bots = state.bots.filter(item => botIds.includes(item.id))
      if (!botIds.length) return notify('Choose at least one target bot first.', true)
      if (!confirm(`Replace knowledge for ${bots.map(bot => bot.name).join(', ')} with merge ${mergeId}? A backup will be created for every bot.`)) return
      applyButton.disabled = true
      try {
        const result = await api('/api/merge/apply', { method:'POST', body:JSON.stringify({ mergeId, botIds }) })
        notify(`Merged knowledge applied to ${result.bots.length} bots.`)
        document.getElementById('mergeResult').className = 'notice good'
        document.getElementById('mergeResult').textContent = `Applied ${mergeId} to ${result.bots.join(', ')}. Backups were created for every bot.`
      } catch (err) {
        notify(err.message, true)
      } finally {
        applyButton.disabled = false
      }
    })

    document.getElementById('mergedList').addEventListener('change', event => {
      const target = event.target.closest('[data-merge-target]')
      if (target) updateMergeTargets(target.dataset.mergeTarget)
    })

    async function saveConfig(patch) {
      await api('/api/config', { method:'POST', body:JSON.stringify(patch) })
      await refresh()
    }

    document.getElementById('addGroup').addEventListener('click', async () => {
      const name = document.getElementById('groupName').value.trim()
      if (name) await saveConfig({ groups:[...(state.groups || []), name] })
    })
    document.getElementById('addProfile').addEventListener('click', async () => {
      const profile = { id:crypto.randomUUID?.() || String(Date.now()), name:profileName.value.trim(), host:profileHost.value.trim(), port:Number(profilePort.value), version:profileVersion.value }
      if (profile.name && profile.host) await saveConfig({ serverProfiles:[...(state.serverProfiles || []), profile] })
    })
    document.getElementById('addSchedule').addEventListener('click', async () => {
      const schedule = { id:String(Date.now()), time:scheduleTime.value, action:scheduleAction.value, group:scheduleGroup.value, command:scheduleCommand.value, enabled:true }
      if (schedule.time && schedule.group) await saveConfig({ schedules:[...(state.schedules || []), schedule] })
    })
    document.getElementById('presetSelect').addEventListener('change', updatePresetTargetUi)
    document.getElementById('applyPreset').addEventListener('click', async () => {
      const target = selectedPresetPayload()
      const payload = {
        presetId:presetSelect.value,
        targetType:target.targetType,
        botIds:target.botIds,
        group:target.group,
        player: presetPlayer.value.trim()
      }
      await applyPresetSelection(payload)
    })
    document.getElementById('savePreset').addEventListener('click', async () => {
      const editId = customPresetId.value.trim()
      const name = customPresetName.value.trim()
      const commands = customPresetCommands.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      if (!name || !commands.length) return notify('Enter a preset name and at least one command.', true)
      const id = editId || `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || Date.now()}`
      const custom = (state.presets || []).filter(preset => !preset.builtIn && preset.id !== id && preset.name.toLowerCase() !== name.toLowerCase())
      await saveConfig({ presets:[...custom, { id, name, commands, delayMs:Number(customPresetDelay.value), requiresPlayer:commands.some(command => command.includes('{player}')) }] })
      customPresetId.value = ''
      customPresetName.value = ''
      customPresetCommands.value = ''
      customPresetDelay.value = '0'
      notify(`Saved preset ${name}.`)
    })
    document.getElementById('clearPresetEditor').addEventListener('click', () => {
      customPresetId.value = ''
      customPresetName.value = ''
      customPresetCommands.value = ''
      customPresetDelay.value = '0'
    })
    document.getElementById('presetList').addEventListener('click', async event => {
      const edit = event.target.closest('[data-preset-edit]')
      const remove = event.target.closest('[data-preset-delete]')
      if (edit) {
        const preset = (state.presets || []).find(item => item.id === edit.dataset.presetEdit)
        if (!preset || preset.builtIn) return
        customPresetId.value = preset.id
        customPresetName.value = preset.name
        customPresetCommands.value = (preset.commands || []).join('\n')
        customPresetDelay.value = String(preset.delayMs || 0)
        return
      }
      if (remove) {
        const preset = (state.presets || []).find(item => item.id === remove.dataset.presetDelete)
        if (!preset || preset.builtIn || !confirm(`Delete preset ${preset.name}?`)) return
        await saveConfig({ presets:(state.presets || []).filter(item => !item.builtIn && item.id !== preset.id) })
        notify(`Deleted preset ${preset.name}.`)
      }
    })
    document.getElementById('presetTargets').addEventListener('change', event => {
      const changed = event.target.closest('input[type="checkbox"]')
      if (!changed) return
      if (changed.value === 'all' && changed.checked) {
        document.querySelectorAll('#presetTargets input:not([value="all"])').forEach(input => { input.checked = false })
      } else if (changed.checked) {
        const all = document.querySelector('#presetTargets input[value="all"]')
        if (all) all.checked = false
      }
    })
    document.getElementById('chatTargets').addEventListener('change', event => {
      const changed = event.target.closest('input[type="checkbox"]')
      if (!changed) return
      if (changed.value === 'all' && changed.checked) {
        document.querySelectorAll('#chatTargets input:not([value="all"])').forEach(input => { input.checked = false })
      } else if (changed.checked) {
        const all = document.querySelector('#chatTargets input[value="all"]')
        if (all) all.checked = false
      }
    })
    document.getElementById('chatForm').addEventListener('submit', async event => {
      event.preventDefault()
      const text = chatInput.value.trim()
      if (!text) return
      const botIds = selectedChatBotIds()
      try {
        notify(await sendHubInput(text, botIds))
        chatInput.value = ''
        setTimeout(refresh, 600)
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('groupList').addEventListener('click', async event => {
      const button = event.target.closest('[data-group-action]')
      const remove = event.target.closest('[data-group-delete]')
      if (remove) {
        if (!confirm(`Delete group ${remove.dataset.groupDelete}? Bots in this group will move to Ungrouped.`)) return
        await api('/api/group/delete', { method:'POST', body:JSON.stringify({ group:remove.dataset.groupDelete }) })
        notify(`Deleted group ${remove.dataset.groupDelete}.`)
        await refresh()
        return
      }
      if (!button) return
      const result = await api('/api/group/action', { method:'POST', body:JSON.stringify({ group:button.dataset.group, action:button.dataset.groupAction }) })
      notify(`${button.dataset.groupAction} requested for ${result.bots.length} bots.`)
    })
    document.getElementById('profileList').addEventListener('click', async event => {
      const button = event.target.closest('[data-apply-profile]')
      if (!button) return
      const botIds = [...document.querySelectorAll('#updateTargets input:checked')].map(input => input.value)
      await api('/api/server-profile/apply', { method:'POST', body:JSON.stringify({ profileId:button.dataset.applyProfile, botIds }) })
      notify(`Server profile applied to ${botIds.length} bots.`)
      await refresh()
    })
    document.getElementById('refreshScores').addEventListener('click', async () => {
      const result = await api('/api/knowledge-scores')
      scoreList.innerHTML = result.bots.map(bot => `<div class="item"><strong>${esc(bot.name)}</strong><span>${Object.entries(bot.scores).map(([name,score]) => `${name}: ${score}`).join(' | ')}</span></div>`).join('')
    })
    document.getElementById('updateSource').addEventListener('change', renderManage)
    document.getElementById('cloneBot').addEventListener('click', async () => {
      const sourceId = cloneSource.value
      const name = cloneName.value.trim()
      if (!sourceId) return notify('Choose a template bot first.', true)
      try {
        const result = await api(`/api/bots/${encodeURIComponent(sourceId)}/clone`, { method:'POST', body:JSON.stringify({ name }) })
        cloneName.value = ''
        notify(`Made ${result.bot.name}.`)
        await refresh()
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('refreshHealth').addEventListener('click', refreshHealth)
    document.getElementById('backupConfigNow').addEventListener('click', async () => {
      try {
        const result = await api('/api/config/backup', { method:'POST', body:'{}' })
        notify(`Config backup made: ${result.backup.name}`)
        await refreshHealth()
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('restoreConfigLatest').addEventListener('click', async () => {
      if (!confirm('Restore the newest config backup? A backup of the current config is made first.')) return
      try {
        const result = await api('/api/config/restore-latest', { method:'POST', body:'{}' })
        notify(`Restored config backup: ${result.restored.name}`)
        await refresh()
        await refreshHealth()
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('restartHub').addEventListener('click', async () => {
      if (!confirm('Restart only the Hub? Running bots will not be intentionally stopped.')) return
      try {
        await api('/api/restart-hub', { method:'POST', body:'{}' })
        notify('Hub restarting...')
        setTimeout(() => location.reload(), 3000)
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('refreshDiscord').addEventListener('click', refreshDiscord)
    document.getElementById('restartDiscord').addEventListener('click', async () => {
      if (!confirm('Restart only the Discord bridge?')) return
      try {
        const result = await api('/api/discord/restart', { method:'POST', body:'{}' })
        discord = result.discord
        renderDiscord()
        notify('Discord bridge restarting...')
        setTimeout(refreshDiscord, 2500)
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('testDiscord').addEventListener('click', async () => {
      try {
        const result = await api('/api/discord/test', { method:'POST', body:'{}' })
        notify(`Discord test sent to ${result.channelId}.`)
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('refreshLogs').addEventListener('click', async () => {
      const id = logBot.value
      if (!id) return
      const result = await api(`/api/logs/${encodeURIComponent(id)}?search=${encodeURIComponent(logSearch.value)}`)
      consoleLog.textContent = result.lines.join('\n') || 'No console output yet.'
      consoleLog.scrollTop = consoleLog.scrollHeight
    })
    document.getElementById('logSearch').addEventListener('input', () => document.getElementById('refreshLogs').click())
    document.getElementById('logBot').addEventListener('change', () => document.getElementById('refreshLogs').click())

    async function viewerAction(action, botIds = []) {
      if (action === 'off') {
        if (botIds.length) botIds.forEach(id => loadedViewers.delete(id))
        else loadedViewers.clear()
        viewerRenderKey = ''
        renderViewers(true)
      }
      const result = await api('/api/viewers/action', { method:'POST', body:JSON.stringify({ action, botIds }) })
      notify(`Viewer ${action} sent to ${result.sent.length} bot${result.sent.length === 1 ? '' : 's'}.`)
      setTimeout(refresh, 1000)
    }
    document.getElementById('allViewersOn').addEventListener('click', () => viewerAction('on'))
    document.getElementById('allViewersOff').addEventListener('click', () => viewerAction('off'))
    document.getElementById('viewerColumns').addEventListener('change', event => saveViewerLayout({ ...state.viewerLayout, columns:Number(event.target.value) }))
    document.getElementById('viewerGrid').addEventListener('click', async event => {
      const card = event.target.closest('[data-viewer-id]')
      if (!card) return
      const id = card.dataset.viewerId
      if (event.target.closest('[data-viewer-load]')) {
        loadedViewers.add(id)
        viewerRenderKey = ''
        return renderViewers(true)
      }
      if (event.target.closest('[data-viewer-toggle]')) {
        const action = event.target.closest('[data-viewer-toggle]').dataset.viewerToggle
        if (action === 'off') loadedViewers.delete(id)
        return viewerAction(action, [id])
      }
      if (event.target.closest('[data-viewer-hide]')) {
        const hidden = [...new Set([...(state.viewerLayout?.hidden || []), id])]
        return saveViewerLayout({ ...state.viewerLayout, hidden })
      }
    })
    let draggedViewerId = ''
    document.getElementById('viewerGrid').addEventListener('dragstart', event => {
      const card = event.target.closest('[data-viewer-id]')
      if (!card || event.target.closest('button')) return event.preventDefault()
      draggedViewerId = card.dataset.viewerId
      card.classList.add('dragging')
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', draggedViewerId)
    })
    document.getElementById('viewerGrid').addEventListener('dragover', event => {
      const card = event.target.closest('[data-viewer-id]')
      if (!card || card.dataset.viewerId === draggedViewerId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      document.querySelectorAll('.viewer-card.drag-over').forEach(item => item.classList.remove('drag-over'))
      card.classList.add('drag-over')
    })
    document.getElementById('viewerGrid').addEventListener('dragleave', event => {
      const card = event.target.closest('[data-viewer-id]')
      if (card && !card.contains(event.relatedTarget)) card.classList.remove('drag-over')
    })
    document.getElementById('viewerGrid').addEventListener('drop', async event => {
      const target = event.target.closest('[data-viewer-id]')
      if (!target || !draggedViewerId || target.dataset.viewerId === draggedViewerId) return
      event.preventDefault()
      const order = orderedViewerBots().map(bot => bot.id)
      const from = order.indexOf(draggedViewerId)
      let to = order.indexOf(target.dataset.viewerId)
      const targetBox = target.getBoundingClientRect()
      const after = event.clientY > targetBox.top + targetBox.height / 2 || event.clientX > targetBox.left + targetBox.width / 2
      order.splice(from, 1)
      to = order.indexOf(target.dataset.viewerId) + (after ? 1 : 0)
      order.splice(to, 0, draggedViewerId)
      draggedViewerId = ''
      await saveViewerLayout({ ...state.viewerLayout, order })
    })
    document.getElementById('viewerGrid').addEventListener('dragend', () => {
      draggedViewerId = ''
      document.querySelectorAll('.viewer-card.dragging,.viewer-card.drag-over').forEach(item => item.classList.remove('dragging', 'drag-over'))
    })
    document.getElementById('hiddenCameras').addEventListener('click', event => {
      const button = event.target.closest('[data-viewer-show]')
      if (!button) return
      saveViewerLayout({ ...state.viewerLayout, hidden:(state.viewerLayout?.hidden || []).filter(id => id !== button.dataset.viewerShow) })
    })
    document.getElementById('runUpdate').addEventListener('click', async () => {
      try {
        const targetBotIds = [...document.querySelectorAll('#updateTargets input:checked')].map(input => input.value)
        const result = await api('/api/update-code', { method:'POST', body:JSON.stringify({ sourceBotId:updateSource.value, targetBotIds }) })
        notify(`Updated ${result.results.length} bots.`)
        await refresh()
      } catch (err) {
        notify(err.message, true)
      }
    })
    document.getElementById('restoreKnowledge').addEventListener('click', async () => {
      const result = await api('/api/knowledge/restore-latest', { method:'POST', body:JSON.stringify({ botId:restoreBot.value }) })
      notify(`Restored ${result.bot}.`)
    })
    document.getElementById('copyKnowledge').addEventListener('click', async () => {
      const sourceBotId = knowledgeSource.value
      const targetBotId = knowledgeTarget.value
      const source = state.bots.find(bot => bot.id === sourceBotId)
      const target = state.bots.find(bot => bot.id === targetBotId)
      if (!source || !target) return notify('Choose a source bot and a target bot first.', true)
      if (source.id === target.id) return notify('Choose two different bots.', true)
      if (!confirm(`Copy knowledge from ${source.name} to ${target.name}? The target knowledge gets a backup first.`)) return
      try {
        const result = await api('/api/knowledge/copy', { method:'POST', body:JSON.stringify({ sourceBotId, targetBotId }) })
        notify(`Copied knowledge from ${result.source} to ${result.target}.`)
        await refresh()
      } catch (err) {
        notify(err.message, true)
      }
    })

    activateTab(location.hash.slice(1) || 'overview', false)
    refresh()
    setInterval(refresh, 3000)
    setInterval(() => {
      if (document.getElementById('logs').classList.contains('active') && document.getElementById('logBot').value) document.getElementById('refreshLogs').click()
    }, 2000)
