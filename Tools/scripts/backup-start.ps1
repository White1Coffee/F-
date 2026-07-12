$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$stamp = Get-Date -Format 'HHmmss-ddMMyyyy'
$backupRoot = Join-Path $root "Data\backups\startup\$stamp"
$startupRoot = Join-Path $root 'Data\backups\startup'
$keepBackups = 20
$manifest = New-Object System.Collections.Generic.List[string]

function Copy-IfExists {
  param([string]$Source, [string]$Destination)
  if (Test-Path -LiteralPath $Source) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    $manifest.Add("$Source -> $Destination")
  }
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Copy-IfExists (Join-Path $root 'Config') (Join-Path $backupRoot 'Config')
Copy-IfExists (Join-Path $root 'Data\memory') (Join-Path $backupRoot 'Data\memory')
Copy-IfExists (Join-Path $root 'Data\knowledge') (Join-Path $backupRoot 'Data\knowledge')

$settingsFile = Join-Path $root 'Config\settings.json'
if (Test-Path -LiteralPath $settingsFile) {
  $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
  foreach ($bot in $settings.bots) {
    $folderValue = [string]$bot.folder
    if ($folderValue.StartsWith('@/')) {
      $folder = Join-Path $root $folderValue.Substring(2)
    } else {
      $folder = $folderValue
    }
    $folder = [System.IO.Path]::GetFullPath($folder)
    $botBackup = Join-Path $backupRoot "Bots\$($bot.name)"
    Copy-IfExists (Join-Path $folder 'bot-settings.json') (Join-Path $botBackup 'bot-settings.json')
    Copy-IfExists (Join-Path $folder 'ai-memory.json') (Join-Path $botBackup 'ai-memory.json')
    Copy-IfExists (Join-Path $folder 'ai-recipes.json') (Join-Path $botBackup 'ai-recipes.json')
    Copy-IfExists (Join-Path $folder 'knowledge') (Join-Path $botBackup 'knowledge')
    Copy-IfExists (Join-Path $folder 'worlds') (Join-Path $botBackup 'worlds')
  }
}

$manifestPath = Join-Path $backupRoot 'manifest.txt'
@(
  "Startup backup"
  "Created: $(Get-Date -Format 'HHmmss ddMMyyyy')"
  "Root: $root"
  ""
  "Copied:"
  $manifest
) | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Startup backup gemaakt: $backupRoot" -ForegroundColor Green

Get-ChildItem -LiteralPath $startupRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $keepBackups |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
    Write-Host "Oude startup backup verwijderd: $($_.FullName)"
  }
