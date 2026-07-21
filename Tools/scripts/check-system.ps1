$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$portableNode = Join-Path $root 'Node\node.exe'
$node = if (Test-Path -LiteralPath $portableNode -PathType Leaf) {
  $portableNode
} else {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($systemNode) { $systemNode.Source } else { $null }
}
$settingsFile = Join-Path $root 'Config\settings.json'
$portsFile = Join-Path $root 'Config\ports.json'
$botsModules = Join-Path $root 'Bots\node_modules'
$hubModules = Join-Path $root 'Hub\node_modules'
$requiredPackages = @(
  'canvas',
  'express',
  'mineflayer',
  'mineflayer-armor-manager',
  'mineflayer-collectblock',
  'mineflayer-pathfinder',
  'mineflayer-pvp',
  'mineflayer-tool',
  'prismarine-viewer',
  'socket.io'
)

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Pass($message) { Write-Host "[OK] $message" -ForegroundColor Green }
function Warn($message) { Write-Host "[WARN] $message" -ForegroundColor Yellow; $warnings.Add($message) }
function Fail($message) { Write-Host "[FAIL] $message" -ForegroundColor Red; $errors.Add($message) }

function Test-RequiredPath {
  param([string]$Path, [string]$Label)
  if (Test-Path -LiteralPath $Path) { Pass $Label } else { Fail "$Label ontbreekt: $Path" }
}

Write-Host "Minecraft AI Bot portable health-check" -ForegroundColor Cyan
Write-Host "Root: $root"

if ($node) { Pass "Node runtime: $node" } else { Fail 'Node.js runtime ontbreekt; installeer Node.js 22 LTS of plaats Node\node.exe.' }
Test-RequiredPath $settingsFile 'Config\settings.json'
Test-RequiredPath $portsFile 'Config\ports.json'
Test-RequiredPath $botsModules 'Bots gedeelde node_modules'
Test-RequiredPath $hubModules 'Hub node_modules'

if (Test-Path -LiteralPath $settingsFile) {
  $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
  if (-not $settings.bots -or $settings.bots.Count -lt 1) {
    Fail 'Geen bots geregistreerd in Config\settings.json'
  } else {
    foreach ($bot in $settings.bots) {
      $folderValue = [string]$bot.folder
      if ($folderValue.StartsWith('@/')) {
        $folder = Join-Path $root $folderValue.Substring(2)
      } else {
        $folder = $folderValue
      }
      $folder = [System.IO.Path]::GetFullPath($folder)
      if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        Fail "Botmap ontbreekt voor $($bot.name): $folder"
        continue
      }
      Pass "Botmap $($bot.name)"
      Test-RequiredPath (Join-Path $folder 'bot.js') "bot.js voor $($bot.name)"
      Test-RequiredPath (Join-Path $folder 'bot-settings.json') "bot-settings.json voor $($bot.name)"
      if (Test-Path -LiteralPath (Join-Path $folder 'node_modules')) {
        Warn "$($bot.name) heeft eigen node_modules; gedeeld Bots\node_modules wordt dan mogelijk niet gebruikt."
      }
    }
  }
}

if ($node -and (Test-Path -LiteralPath $node -PathType Leaf)) {
  Push-Location (Join-Path $root 'Bots')
  foreach ($package in $requiredPackages) {
    $script = "require.resolve('$package'); console.log('$package OK')"
    $output = & $node -e $script 2>&1
    if ($LASTEXITCODE -eq 0) {
      Pass "Package $package via Bots\node_modules"
    } else {
      Fail "Package $package niet laadbaar vanuit $root\Bots. Output: $output"
    }
  }
  Pop-Location
}

if (Test-Path -LiteralPath $portsFile) {
  $ports = Get-Content -LiteralPath $portsFile -Raw | ConvertFrom-Json
  $seen = @{}
  if ($ports.hub) { $seen[[int]$ports.hub] = 'hub' }
  foreach ($botEntry in $ports.bots.PSObject.Properties) {
    foreach ($kind in @('hud', 'viewer')) {
      $port = [int]$botEntry.Value.$kind
      if ($port -lt 1 -or $port -gt 65535) {
        Fail "Ongeldige poort voor $($botEntry.Name) $kind`: $port"
      } elseif ($seen.ContainsKey($port)) {
        Fail "Dubbele poort $port voor $($botEntry.Name) $kind en $($seen[$port])"
      } else {
        $seen[$port] = "$($botEntry.Name) $kind"
      }
    }
  }
  if ($errors.Count -eq 0) { Pass 'Poortconfiguratie heeft geen dubbele poorten' }
}

if ($warnings.Count) {
  Write-Host ""
  Write-Host "Warnings: $($warnings.Count)" -ForegroundColor Yellow
}

if ($errors.Count) {
  Write-Host ""
  Write-Host "Health-check mislukt met $($errors.Count) probleem/problemen." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Health-check geslaagd." -ForegroundColor Green
exit 0
