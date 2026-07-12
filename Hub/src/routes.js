function registerSupportRoutes(app, deps) {
  const {
    fs,
    settingsFile,
    systemHealth,
    discordBridgeStatus,
    restartDiscordBridge,
    sendDiscordTestMessage,
    configBackupList,
    backupConfigNow,
    restoreLatestConfigBackup
  } = deps

  app.get('/api/health', async (_request, response, next) => {
    try { response.json({ ok: true, health: await systemHealth() }) } catch (err) { next(err) }
  })

  app.get('/api/discord/status', (_request, response, next) => {
    try { response.json({ ok: true, discord: discordBridgeStatus() }) } catch (err) { next(err) }
  })

  app.post('/api/discord/restart', async (_request, response, next) => {
    try { response.json({ ok: true, discord: await restartDiscordBridge() }) } catch (err) { next(err) }
  })

  app.post('/api/discord/test', async (request, response, next) => {
    try { response.json({ ok: true, ...await sendDiscordTestMessage(request.body?.channelId) }) } catch (err) { next(err) }
  })

  app.get('/api/config/backups', (_request, response, next) => {
    try { response.json({ ok: true, backups: configBackupList() }) } catch (err) { next(err) }
  })

  app.post('/api/config/backup', (_request, response, next) => {
    try { response.json({ ok: true, backup: backupConfigNow('manual') }) } catch (err) { next(err) }
  })

  app.post('/api/config/restore-latest', (_request, response, next) => {
    try { response.json({ ok: true, restored: restoreLatestConfigBackup() }) } catch (err) { next(err) }
  })

  app.get('/api/config/export', (_request, response, next) => {
    try {
      if (!fs.existsSync(settingsFile)) throw new Error('settings.json does not exist.')
      response.download(settingsFile, 'settings.json')
    } catch (err) { next(err) }
  })
}

module.exports = { registerSupportRoutes }
