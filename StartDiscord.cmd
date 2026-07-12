@echo off
setlocal
title Minecraft AI Discord Bridge

cd /d "%~dp0minecraft-discord-bot"

if exist "%~dp0Node\node.exe" (
  set "NODE_EXE=%~dp0Node\node.exe"
) else (
  set "NODE_EXE=node"
)

echo Starting Minecraft AI Discord Bridge...
"%NODE_EXE%" index.js

endlocal
