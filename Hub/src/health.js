async function systemHealth(deps) {
  const {
    settings,
    HUB_PORT,
    portableRoot,
    hubRoot,
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
  } = deps

  const botPorts = settings.bots.flatMap(bot => [bot.hudPort, bot.viewerPort])
  const portChecks = await Promise.all([...new Set([HUB_PORT, ...botPorts])].map(async port => ({
    port,
    listening: await portListening(port)
  })))
  return {
    checkedAt: new Date().toISOString(),
    paths: [
      { name: 'Portable Node', ok: fs.existsSync(path.join(portableRoot, 'Node', 'node.exe')), path: path.join(portableRoot, 'Node', 'node.exe') },
      { name: 'Hub node_modules', ok: fs.existsSync(path.join(hubRoot, 'node_modules')), path: path.join(hubRoot, 'node_modules') },
      { name: 'Bots node_modules', ok: fs.existsSync(path.join(botsRoot, 'node_modules')), path: path.join(botsRoot, 'node_modules') },
      { name: 'Settings', ok: fs.existsSync(settingsFile), path: settingsFile },
      { name: 'Ports', ok: fs.existsSync(portsFile), path: portsFile }
    ],
    ports: portChecks,
    latestBackup: latestDirectory(startupBackupsRoot),
    startupBackupCount: fs.existsSync(startupBackupsRoot) ? fs.readdirSync(startupBackupsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length : 0,
    configBackups: configBackupList().slice(0, 10),
    hubLogCount: fileCount(logsRoot, '.log'),
    discord: discordBridgeStatus(),
    disk: await diskInfo(),
    bots: await Promise.all(settings.bots.map(async bot => ({
      id: bot.id,
      name: bot.name,
      folder: resolvedBotFolder(bot),
      folderOk: fs.existsSync(resolvedBotFolder(bot)),
      status: await botStatus(bot),
      stats: displayedStats(bot)
    })))
  }
}

module.exports = { systemHealth }
