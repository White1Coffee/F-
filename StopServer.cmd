@echo off
title Stop Minecraft Java Server
setlocal
cd /d "%~dp0"

set "SERVER_DIR=%~dp0minecraft-java-server"
set "PID_FILE=%SERVER_DIR%\server.pid"
set "MANAGER_PID_FILE=%SERVER_DIR%\server-manager.pid"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Invoke-RestMethod -Uri 'http://127.0.0.1:3101/api/stop' -Method Post -Body '{}' -ContentType 'application/json' -TimeoutSec 12 | Out-Null; Write-Host 'Stop command sent through server manager.' } catch { Write-Host 'Server manager stop failed, using PID fallback.' }"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$serverDir='%SERVER_DIR%';" ^
  "$pidFile='%PID_FILE%';" ^
  "$stopped=$false;" ^
  "if (Test-Path -LiteralPath $pidFile) {" ^
  "  $serverPid=[int](Get-Content -LiteralPath $pidFile -Raw);" ^
  "  $process=Get-Process -Id $serverPid -ErrorAction SilentlyContinue;" ^
  "  if ($process) {" ^
  "    Write-Host 'Stopping Minecraft server PID:' $serverPid;" ^
  "    try { $process.CloseMainWindow() | Out-Null } catch {}" ^
  "    Start-Sleep -Seconds 8;" ^
  "    if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) { Stop-Process -Id $serverPid -Force }" ^
  "    $stopped=$true" ^
  "  }" ^
  "}" ^
  "if (-not $stopped) {" ^
  "  $escaped=$serverDir.Replace('\','\\');" ^
  "  $matches=Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'server\.jar' -and $_.CommandLine -match [regex]::Escape($serverDir) };" ^
  "  foreach ($match in $matches) {" ^
  "    Write-Host 'Stopping Minecraft server PID:' $match.ProcessId;" ^
  "    Stop-Process -Id $match.ProcessId -Force -ErrorAction SilentlyContinue;" ^
  "    $stopped=$true" ^
  "  }" ^
  "}" ^
  "if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }" ^
  "if ($stopped) { Write-Host 'Minecraft server stopped.' } else { Write-Host 'No running Minecraft server was found.' }"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pidFile='%MANAGER_PID_FILE%';" ^
  "if (Test-Path -LiteralPath $pidFile) {" ^
  "  $managerPid=[int](Get-Content -LiteralPath $pidFile -Raw);" ^
  "  if (Get-Process -Id $managerPid -ErrorAction SilentlyContinue) {" ^
  "    Write-Host 'Stopping Minecraft server manager PID:' $managerPid;" ^
  "    Stop-Process -Id $managerPid -Force -ErrorAction SilentlyContinue" ^
  "  }" ^
  "  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue" ^
  "} else {" ^
  "  Write-Host 'No running Minecraft server manager was found.'" ^
  "}"

endlocal
