param(
  [int]$HubPort = 3100,
  [int]$ServerManagerPort = 3101,
  [int]$MinecraftServerPort = 25565,
  [int]$BotPortStart = 3110,
  [int]$BotPortEnd = 3199
)

$ErrorActionPreference = 'Stop'

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host "Run this script as Administrator to add Windows Firewall rules." -ForegroundColor Yellow
  Write-Host "Hub listens on $HubPort, server manager on $ServerManagerPort, Minecraft server on $MinecraftServerPort."
  Write-Host "Bot HUD/viewer ports are usually $BotPortStart-$BotPortEnd."
  exit 1
}

$rules = @(
  @{ Name = 'Minecraft AI Bot Hub LAN'; Ports = "$HubPort" },
  @{ Name = 'Minecraft Server Manager LAN'; Ports = "$ServerManagerPort" },
  @{ Name = 'Minecraft Java Server LAN'; Ports = "$MinecraftServerPort" },
  @{ Name = 'Minecraft AI Bot HUD Viewer LAN'; Ports = "$BotPortStart-$BotPortEnd" }
)

foreach ($rule in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $rule.Name -Enabled True -Profile Private
    Set-NetFirewallPortFilter -AssociatedNetFirewallRule $existing -Protocol TCP -LocalPort $rule.Ports
  } else {
    New-NetFirewallRule `
      -DisplayName $rule.Name `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $rule.Ports `
      -Profile Private | Out-Null
  }
  Write-Host "Allowed TCP port(s): $($rule.Ports) - $($rule.Name)" -ForegroundColor Green
}

Write-Host ""
Write-Host "LAN access is enabled for Private networks."
