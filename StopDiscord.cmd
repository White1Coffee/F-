@echo off
setlocal
title Stop Minecraft AI Discord Bridge

set "PID_FILE=%~dp0minecraft-discord-bot\discord-bridge.pid"

if not exist "%PID_FILE%" (
  echo Discord bridge is not running.
  exit /b 0
)

set "DISCORD_PID="
for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "DISCORD_PID=%%P"

if not defined DISCORD_PID (
  echo Discord bridge PID file is empty.
  del "%PID_FILE%" >nul 2>nul
  exit /b 0
)

echo Stopping Discord bridge PID %DISCORD_PID%...
taskkill /PID %DISCORD_PID% /T /F >nul 2>nul
if errorlevel 1 (
  echo Discord bridge was not found or could not be stopped.
  del "%PID_FILE%" >nul 2>nul
  exit /b 1
) else (
  echo Discord bridge stopped.
)

del "%PID_FILE%" >nul 2>nul
endlocal
