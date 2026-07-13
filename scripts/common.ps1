Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:FMProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:FMLogFile = $null
$script:FMScriptVersion = '1'

function Get-FMProjectRoot { return $script:FMProjectRoot }

function Get-FMAppVersion {
  $packageFile = Join-Path $script:FMProjectRoot 'Bots\package.json'
  if (Test-Path -LiteralPath $packageFile) {
    try { return [string](Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version } catch {}
  }
  return '0.0.0'
}

function Initialize-FMLog {
  param([Parameter(Mandatory=$true)][string]$Name)
  $logRoot = Join-Path $script:FMProjectRoot 'Logs'
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $script:FMLogFile = Join-Path $logRoot "$Name.log"
  Write-FMLog "--- $Name started; script=$script:FMScriptVersion app=$(Get-FMAppVersion) root=$script:FMProjectRoot ---"
  return $script:FMLogFile
}

function Protect-FMLogText {
  param([AllowNull()][object]$Value)
  $text = [string]$Value
  $text = $text -replace '(?i)(token|password|secret|authorization|device[_ -]?code)\s*[:=]\s*[^\s;]+', '$1=[REDACTED]'
  return $text
}

function Write-FMLog {
  param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$Message, [ValidateSet('INFO','WARN','ERROR')][string]$Level='INFO')
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $(Protect-FMLogText $Message)"
  Write-Host $line
  if ($script:FMLogFile) { Add-Content -LiteralPath $script:FMLogFile -Value $line -Encoding UTF8 }
}

function Assert-FMProject {
  $required = @('Hub\hub.js','Bots\package.json','Bots\official-bot\bot.js','Config')
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $script:FMProjectRoot $relative))) {
      throw "Ongeldige F-Mineflayer-installatie: $relative ontbreekt."
    }
  }
}

function Test-FMAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-FMNodeCommand {
  $portable = Join-Path $script:FMProjectRoot 'Node\node.exe'
  if (Test-Path -LiteralPath $portable) { return $portable }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Get-FMNpmCommand {
  $portable = Join-Path $script:FMProjectRoot 'Node\npm.cmd'
  if (Test-Path -LiteralPath $portable) { return $portable }
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Get-FMRequiredNodeMajor {
  $nvmrc = Join-Path $script:FMProjectRoot '.nvmrc'
  if (Test-Path -LiteralPath $nvmrc) {
    $match = [regex]::Match((Get-Content -LiteralPath $nvmrc -Raw), '\d+')
    if ($match.Success) { return [int]$match.Value }
  }
  $portable = Join-Path $script:FMProjectRoot 'Node\node.exe'
  if (Test-Path -LiteralPath $portable) {
    $match = [regex]::Match((& $portable --version), '\d+')
    if ($match.Success) { return [int]$match.Value }
  }
  return 18
}

function Install-FMNode {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "Node.js ontbreekt. Installeer Node.js LTS vanaf https://nodejs.org/ en voer setup opnieuw uit."
  }
  Write-FMLog 'Node.js ontbreekt; winget-installatie wordt gestart.' 'WARN'
  & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget kon Node.js LTS niet installeren (exit $LASTEXITCODE)." }
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
  if (-not (Get-FMNodeCommand)) { throw 'Node.js is geinstalleerd maar nog niet beschikbaar. Open een nieuwe terminal en voer setup opnieuw uit.' }
}

function Read-FMJson {
  param([Parameter(Mandatory=$true)][string]$Path)
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-FMJsonAtomic {
  param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][object]$Value)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $temp -Encoding UTF8
    Get-Content -LiteralPath $temp -Raw | ConvertFrom-Json | Out-Null
    Move-Item -LiteralPath $temp -Destination $Path -Force
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function New-FMDataBackup {
  param([string]$Reason='setup')
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $target = Join-Path $script:FMProjectRoot "backups\config-$stamp-$Reason"
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  foreach ($relative in @('Config\settings.json','Config\ports.json','Bots\official-bot\bot-settings.json')) {
    $source = Join-Path $script:FMProjectRoot $relative
    if (Test-Path -LiteralPath $source) {
      $destination = Join-Path $target $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination -Force
    }
  }
  Write-FMLog "Backup gemaakt: $target"
  return $target
}

function Test-FMPortListening {
  param([Parameter(Mandatory=$true)][int]$Port, [string]$HostName='127.0.0.1', [int]$TimeoutMs=300)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName,$Port,$null,$null)
    if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch { return $false } finally { $client.Dispose() }
}

function Get-FMFreePort {
  param([int]$Preferred, [int[]]$Reserved=@())
  for ($port=$Preferred; $port -le 65535; $port++) {
    if ($Reserved -contains $port) { continue }
    if (-not (Test-FMPortListening -Port $port)) { return $port }
  }
  throw "Geen vrije poort gevonden vanaf $Preferred."
}

function Install-FMDependencies {
  $npm = Get-FMNpmCommand
  if (-not $npm) { throw 'npm is niet beschikbaar.' }
  foreach ($relative in @('Bots','Hub')) {
    $folder = Join-Path $script:FMProjectRoot $relative
    $lock = Join-Path $folder 'package-lock.json'
    if (-not (Test-Path -LiteralPath $lock)) { throw "$relative heeft geen package-lock.json." }
    $modules = Join-Path $folder 'node_modules'
    $marker = Join-Path $modules '.f-mineflayer-lock.sha256'
    $lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $lock).Hash.ToLowerInvariant()
    if ((Test-Path -LiteralPath $modules) -and (Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $lockHash)) {
      Write-FMLog "Dependencies in $relative zijn al exact gelijk aan de lockfile; installatie overgeslagen."
      continue
    }
    Write-FMLog "Dependencies installeren in $relative via npm ci."
    Push-Location $folder
    try {
      # npm schrijft gewone waarschuwingen naar stderr. In Windows PowerShell 5.1
      # worden die met ErrorActionPreference=Stop anders onterecht fatale errors.
      $previousPreference = $ErrorActionPreference
      $nativeOutput = @()
      $nativeExitCode = 1
      try {
        $ErrorActionPreference = 'Continue'
        $nativeOutput = @(& $npm ci --no-audit --no-fund 2>&1)
        $nativeExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousPreference
      }
      foreach ($line in $nativeOutput) {
        $text = [string]$line
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $level = if ($text -match '(?i)\b(error|err!)\b') { 'ERROR' } elseif ($text -match '(?i)\bwarn(?:ing)?\b') { 'WARN' } else { 'INFO' }
        Write-FMLog $text $level
      }
      if ($nativeExitCode -ne 0) { throw "npm ci in $relative mislukte (exit $nativeExitCode)." }
      New-Item -ItemType Directory -Path $modules -Force | Out-Null
      Set-Content -LiteralPath $marker -Value $lockHash -Encoding ASCII
    } finally { Pop-Location }
  }
}

function Get-FMRuntimeRoot {
  $path = Join-Path $script:FMProjectRoot 'runtime'
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  return $path
}

function Set-FMPidFile {
  param([string]$Name,[int]$Id)
  Set-Content -LiteralPath (Join-Path (Get-FMRuntimeRoot) "$Name.pid") -Value $Id -Encoding ASCII
}

function Get-FMPidFile {
  param([string]$Name)
  $file = Join-Path (Get-FMRuntimeRoot) "$Name.pid"
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  $value = 0
  if ([int]::TryParse((Get-Content -LiteralPath $file -Raw).Trim(),[ref]$value)) { return $value }
  return $null
}

function Remove-FMPidFile {
  param([string]$Name)
  Remove-Item -LiteralPath (Join-Path (Get-FMRuntimeRoot) "$Name.pid") -Force -ErrorAction SilentlyContinue
}

function Test-FMProjectProcess {
  param([int]$Id)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $command = [string]$process.CommandLine
  return $command.IndexOf($script:FMProjectRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Invoke-FMDoctor {
  param([switch]$Quick)
  if($Quick){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'doctor.ps1') -Quick}
  else{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'doctor.ps1')}
  return $LASTEXITCODE
}

function Test-FMSafeChildPath {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  $root = $script:FMProjectRoot.TrimEnd('\') + '\'
  return $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)
}
