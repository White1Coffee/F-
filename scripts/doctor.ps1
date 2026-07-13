[CmdletBinding()]
param([switch]$Quick)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'doctor' | Out-Null
$warnings = New-Object Collections.Generic.List[string]
$errors = New-Object Collections.Generic.List[string]
function Pass([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green; Write-FMLog $Text }
function Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow; $warnings.Add($Text); Write-FMLog $Text 'WARN' }
function Fail([string]$Text) { Write-Host "[FAIL] $Text" -ForegroundColor Red; $errors.Add($Text); Write-FMLog $Text 'ERROR' }
try {
  try { Assert-FMProject; Pass 'Projectstructuur geldig' } catch { Fail $_.Exception.Message }
  $node = Get-FMNodeCommand
  if ($node) {
    $version = & $node --version; $major=[int]([regex]::Match($version,'\d+').Value)
    if ($major -ge (Get-FMRequiredNodeMajor)) { Pass "Node.js $version" } else { Fail "Node.js $version is te oud" }
  } else { Fail 'Node.js ontbreekt' }
  if (Get-FMNpmCommand) { Pass 'npm beschikbaar (package-lock/npm gedetecteerd)' } else { Fail 'npm ontbreekt' }
  foreach ($relative in @('Hub\node_modules','Bots\node_modules')) { if (Test-Path -LiteralPath (Join-Path (Get-FMProjectRoot) $relative)) { Pass "$relative aanwezig" } else { Fail "$relative ontbreekt; voer setup uit" } }
  foreach ($relative in @('Config\settings.json','Config\ports.json')) {
    $path=Join-Path (Get-FMProjectRoot) $relative
    if (-not (Test-Path -LiteralPath $path)) { Fail "$relative ontbreekt"; continue }
    try { Read-FMJson $path | Out-Null; Pass "$relative is geldige JSON" } catch { Fail "$relative is corrupte JSON" }
  }
  foreach ($relative in @('Logs','Data\knowledge','Bots\official-bot\knowledge','Bots\official-bot\worlds')) {
    $path=Join-Path (Get-FMProjectRoot) $relative
    try { New-Item -ItemType Directory -Path $path -Force | Out-Null; $probe=Join-Path $path '.doctor.tmp'; Set-Content $probe 'ok'; Remove-Item $probe; Pass "$relative schrijfbaar" } catch { Fail "$relative niet schrijfbaar" }
  }
  $settingsFile=Join-Path (Get-FMProjectRoot) 'Config\settings.json'
  if (Test-Path $settingsFile) {
    try {
      $settings=Read-FMJson $settingsFile; $seen=@{}
      if (-not $settings.bots -or $settings.bots.Count -eq 0) { Fail 'Geen bots geconfigureerd' }
      foreach($bot in @($settings.bots)) {
        $folder=[string]$bot.folder
        if ($folder.StartsWith('@/')) { $folder=Join-Path (Get-FMProjectRoot) $folder.Substring(2) }
        if (-not (Test-Path (Join-Path $folder 'bot.js'))) { Fail "Bot-entrypoint ontbreekt voor $($bot.name)" }
        foreach($port in @([int]$bot.hudPort,[int]$bot.viewerPort)) { if($port -lt 1 -or $port -gt 65535){Fail "Ongeldige botpoort $port"}elseif($seen.ContainsKey($port)){Fail "Dubbele poort $port"}else{$seen[$port]=$bot.name} }
        $authProperty=$bot.PSObject.Properties['auth']
        if ($authProperty -and $authProperty.Value -and (@('offline','microsoft') -notcontains [string]$authProperty.Value)) { Fail "Ongeldige auth voor $($bot.name)" }
      }
      Pass 'Bot-, auth- en poortconfiguratie gecontroleerd'
      if ($settings.dashboard.enabled -eq $false) { Warn 'Dashboard is uitgeschakeld' } else { Pass 'Dashboard ingeschakeld' }
      if ($settings.team.enabled -eq $false) { Warn 'Teamfunctionaliteit is uitgeschakeld' } else { Pass 'Teamfunctionaliteit ingeschakeld' }
      if (-not $Quick -and $settings.bots.Count -gt 0) {
        $target=$settings.bots[0]; $client=New-Object Net.Sockets.TcpClient
        try { $pending=$client.BeginConnect([string]$target.host,[int]$target.port,$null,$null); if($pending.AsyncWaitHandle.WaitOne(1200)){$client.EndConnect($pending);Pass "Minecraft-server $($target.host):$($target.port) bereikbaar"}else{Warn "Minecraft-server $($target.host):$($target.port) niet bereikbaar"} } catch { Warn "Minecraft-server $($target.host):$($target.port) niet bereikbaar" } finally {$client.Dispose()}
      }
    } catch { Fail "Configuratiecontrole mislukte: $($_.Exception.Message)" }
  }
  $hubPid=Get-FMPidFile 'hub'
  if($hubPid -and (Test-FMProjectProcess $hubPid)){Pass "Hub actief (PID $hubPid)"}else{Warn 'Hub is niet actief'}
} catch { Fail $_.Exception.Message }
Write-Host "Doctor: $($errors.Count) fout(en), $($warnings.Count) waarschuwing(en)."
if($errors.Count){exit 2};if($warnings.Count){exit 1};exit 0
