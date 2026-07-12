param(
  [int]$Days = 14,
  [int]$BackupLimit = 5,
  [switch]$CleanBrokenNodeModules
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$logsRoot = Join-Path $root 'Logs'
$hubLogsRoot = Join-Path $logsRoot 'hub'
$botsRoot = Join-Path $root 'Bots'
$settingsFile = Join-Path $root 'Config\settings.json'
$updateBackupsRoot = Join-Path $root 'Data\backups\update-backups'
$cutoff = (Get-Date).AddDays(-[Math]::Abs($Days))
$safeBotRoot = (Resolve-Path -LiteralPath $botsRoot).Path

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $resolvedParent = (Resolve-Path -LiteralPath $Parent).Path.TrimEnd('\')
  $resolvedChild = (Resolve-Path -LiteralPath $Child).Path
  if (-not $resolvedChild.StartsWith("$resolvedParent\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Onveilige cleanup overgeslagen buiten ${resolvedParent}: $resolvedChild"
  }
}

function Remove-OldDirectories {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Keep = 5
  )

  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $items = Get-ChildItem -LiteralPath $resolved -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending

  $removed = 0
  $items | Select-Object -Skip ([Math]::Max(0, $Keep)) | ForEach-Object {
    Assert-ChildPath -Parent $root -Child $_.FullName
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
    $removed++
  }
  return $removed
}

$activeBotIds = @()
$activeBotFolders = @()
if (Test-Path -LiteralPath $settingsFile) {
  $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
  $activeBotIds = @($settings.bots | ForEach-Object { [string]$_.id })
  $activeBotFolders = @($settings.bots | ForEach-Object {
      if ($_.folder) { [string]$_.folder } else { Join-Path $botsRoot ([string]$_.name) }
    })
}

$oldLogFilesRemoved = 0
if (Test-Path -LiteralPath $logsRoot) {
  Get-ChildItem -LiteralPath $logsRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { @('.log', '.txt') -contains $_.Extension.ToLowerInvariant() -and $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      $oldLogFilesRemoved++
    }
}

$staleHubLogsRemoved = 0
if (Test-Path -LiteralPath $hubLogsRoot) {
  Get-ChildItem -LiteralPath $hubLogsRoot -File -Filter '*.log' -ErrorAction SilentlyContinue |
    Where-Object {
      $_.BaseName -match '^[0-9a-f-]{36}$' -and ($activeBotIds -notcontains $_.BaseName)
    } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      $staleHubLogsRemoved++
    }
}

$brokenNodeModulesRemoved = 0
if ($CleanBrokenNodeModules) {
  Get-ChildItem -LiteralPath $botsRoot -Directory -Filter 'node_modules-broken-*' -ErrorAction SilentlyContinue |
    ForEach-Object {
      Assert-ChildPath -Parent $safeBotRoot -Child $_.FullName
      Remove-Item -LiteralPath $_.FullName -Recurse -Force
      $brokenNodeModulesRemoved++
    }
}

$oldBackupsRemoved = 0
foreach ($botFolder in $activeBotFolders) {
  if (-not (Test-Path -LiteralPath $botFolder)) { continue }
  $oldBackupsRemoved += Remove-OldDirectories -Path (Join-Path $botFolder 'backups') -Keep $BackupLimit
  $oldBackupsRemoved += Remove-OldDirectories -Path (Join-Path $botFolder 'knowledge-backups') -Keep $BackupLimit
}

foreach ($botId in $activeBotIds) {
  $oldBackupsRemoved += Remove-OldDirectories -Path (Join-Path $updateBackupsRoot $botId) -Keep $BackupLimit
}

Write-Host "Cleanup klaar."
Write-Host "Oude logbestanden verwijderd: $oldLogFilesRemoved (ouder dan $Days dagen)"
Write-Host "Stale Hub botlogs verwijderd: $staleHubLogsRemoved"
Write-Host "Kapotte node_modules backups verwijderd: $brokenNodeModulesRemoved"
Write-Host "Oude bot-backups verwijderd: $oldBackupsRemoved (max $BackupLimit per bot/backup-map)"
