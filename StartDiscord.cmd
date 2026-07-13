@echo off
setlocal
title Minecraft AI Discord Bridge

cd /d "%~dp0minecraft-discord-bot"

if not exist "%~dp0minecraft-discord-bot\index.js" (
  echo Discord bridge index.js was not found.
  pause
  exit /b 1
)

if exist "%~dp0minecraft-discord-bot\discord-bridge.pid" (
  echo Discord bridge already has an active PID file. Use StopDiscord.cmd before restarting it.
  exit /b 0
)

if exist "%~dp0Node\node.exe" (
  set "NODE_EXE=%~dp0Node\node.exe"
) else (
  set "NODE_EXE=node"
)

echo Starting Minecraft AI Discord Bridge...
"%NODE_EXE%" index.js
if errorlevel 1 (
  echo Discord bridge stopped with an error.
  pause
  exit /b 1
)

endlocal
