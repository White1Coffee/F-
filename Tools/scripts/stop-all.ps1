$ErrorActionPreference = 'SilentlyContinue'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$portsFile = Join-Path $root 'Config\ports.json'
$discordBridgePidFile = Join-Path $root 'minecraft-discord-bot\discord-bridge.pid'
$ports = New-Object System.Collections.Generic.List[int]

if (Test-Path -LiteralPath $portsFile) {
  $config = Get-Content -LiteralPath $portsFile -Raw | ConvertFrom-Json
  if ($config.hub) { $ports.Add([int]$config.hub) }
  foreach ($bot in $config.bots.PSObject.Properties) {
    if ($bot.Value.hud) { $ports.Add([int]$bot.Value.hud) }
    if ($bot.Value.viewer) { $ports.Add([int]$bot.Value.viewer) }
  }
} else {
  3100, 3000, 3001, 3130, 3131 | ForEach-Object { $ports.Add([int]$_) }
}

$pids = New-Object System.Collections.Generic.HashSet[int]

$hubPort = if ($ports.Count -gt 0) { [int]$ports[0] } else { 3100 }
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$hubPort/api/shutdown" -Method Post -TimeoutSec 2 | Out-Null
} catch {}

Start-Sleep -Milliseconds 700
$netstat = & netstat.exe -ano -p tcp
foreach ($line in $netstat) {
  $parts = ($line.Trim() -split '\s+') | Where-Object { $_ }
  if ($parts.Count -lt 5 -or $parts[0] -ne 'TCP') { continue }
  $local = $parts[1]
  $state = $parts[3]
  $pidValue = 0
  if ($state -ne 'LISTENING' -or -not [int]::TryParse($parts[4], [ref]$pidValue)) { continue }
  foreach ($port in $ports) {
    if ($local.EndsWith(":$port")) {
      [void]$pids.Add($pidValue)
    }
  }
}

foreach ($pidValue in $pids) {
  Write-Host "Stopping PID $pidValue"
  & taskkill.exe /PID $pidValue /T /F | Out-Null
}

if (Test-Path -LiteralPath $discordBridgePidFile) {
  $discordPid = 0
  $pidText = (Get-Content -LiteralPath $discordBridgePidFile -Raw).Trim()
  if ([int]::TryParse($pidText, [ref]$discordPid)) {
    Write-Host "Stopping Discord bridge PID $discordPid"
    Stop-Process -Id $discordPid -Force
  }
  Remove-Item -LiteralPath $discordBridgePidFile -Force
}

if ($pids.Count -eq 0) {
  Write-Host 'No matching Minecraft AI Bot Hub ports were running.'
}
