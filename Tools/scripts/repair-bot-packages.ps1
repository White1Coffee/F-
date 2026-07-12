param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

$botsRoot = Join-Path $Root 'Bots'
$node = Join-Path $Root 'Node\node.exe'
$npm = Join-Path $Root 'Node\npm.cmd'
$packageJson = Join-Path $botsRoot 'package.json'
$nodeModules = Join-Path $botsRoot 'node_modules'
$cache = Join-Path $Root 'Updates\npm-cache'
$stamp = Get-Date -Format 'HHmmss-ddMMyyyy'

if (-not (Test-Path -LiteralPath $node)) { throw "Node not found: $node" }
if (-not (Test-Path -LiteralPath $npm)) { throw "npm not found: $npm" }
if (-not (Test-Path -LiteralPath $packageJson)) { throw "Bots package.json not found: $packageJson" }

New-Item -ItemType Directory -Force -Path $cache | Out-Null

if (Test-Path -LiteralPath $nodeModules) {
  $backup = Join-Path $botsRoot "node_modules-broken-$stamp"
  Write-Host "Moving current node_modules to $backup"
  Move-Item -LiteralPath $nodeModules -Destination $backup
}

Push-Location $botsRoot
try {
  & $npm install --no-audit --no-fund --cache $cache
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$required = @(
  'mineflayer',
  'minecraft-protocol',
  'express',
  'socket.io',
  'canvas',
  'prismarine-viewer'
)

foreach ($name in $required) {
  $packageFile = Join-Path $nodeModules "$name\package.json"
  if (-not (Test-Path -LiteralPath $packageFile)) {
    throw "Package did not install correctly: $name"
  }
}

Write-Host 'Bot packages repaired successfully.'
