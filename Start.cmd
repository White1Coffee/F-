@echo off
title Minecraft AI Bot Hub
setlocal
cd /d "%~dp0"

if exist "%~dp0Node\node.exe" (
  set "NODE_EXE=%~dp0Node\node.exe"
) else (
  set "NODE_EXE=node"
)

set "HUB_PORT=3100"
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { [int](Get-Content -LiteralPath '%~dp0Config\ports.json' -Raw | ConvertFrom-Json).hub } catch { 3100 }"`) do set "HUB_PORT=%%P"
echo Running portable health-check...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\scripts\check-system.ps1"
if errorlevel 1 (
  echo.
  echo Health-check failed. Hub wordt niet gestart.
  pause
  exit /b 1
)

echo Creating startup backup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\scripts\backup-start.ps1"
if errorlevel 1 (
  echo.
  echo Backup failed. Hub wordt niet gestart.
  pause
  exit /b 1
)

echo Cleaning old logs...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Tools\scripts\cleanup-logs.ps1" -Days 14

if not exist "%~dp0Logs" mkdir "%~dp0Logs"

echo Starting Minecraft AI Bot Hub on http://localhost:%HUB_PORT%
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%NODE_EXE%' -ArgumentList '%~dp0Hub\hub.js' -WorkingDirectory '%~dp0Hub'"

echo Waiting for Hub to become ready...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url='http://127.0.0.1:%HUB_PORT%/api/state'; $ready=$false; for ($i=0; $i -lt 45; $i++) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch { }; Start-Sleep -Seconds 1 }; if (-not $ready) { exit 1 }"
if errorlevel 1 (
  echo.
  echo Hub is niet op tijd online gekomen. Discord bridge wordt niet gestart.
  echo Controleer Logs\hub.err.log en Logs\hub.out.log.
  pause
  exit /b 1
)

start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process 'http://localhost:%HUB_PORT%'" >nul 2>nul

if exist "%~dp0minecraft-discord-bot\index.js" (
  echo Starting Discord bridge after Hub is ready...
  start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%NODE_EXE%' -ArgumentList 'index.js' -WorkingDirectory '%~dp0minecraft-discord-bot' -RedirectStandardOutput '%~dp0Logs\discord-bridge.out.log' -RedirectStandardError '%~dp0Logs\discord-bridge.err.log'"
)

echo.
echo Hub and Discord bridge started. Use Stop.cmd to close everything.
endlocal
