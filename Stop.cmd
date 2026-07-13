@echo off
title Stop Minecraft AI Team Dashboard
setlocal
cd /d "%~dp0"

echo Stopping Hub, managed bots, viewers and Discord bridge...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\scripts\stop-all.ps1"
if errorlevel 1 (
  echo Stop operation completed with errors.
  exit /b 1
)
echo Minecraft AI processes stopped.
endlocal
