[CmdletBinding()]
param(
  [switch]$Repair,
  [switch]$NonInteractive,
  [switch]$ResetConfig,
  [switch]$StartAfter,
  [switch]$InstallNode,
  [string]$MinecraftHost='localhost',
  [int]$MinecraftPort=25565,
  [string]$MinecraftVersion='1.21.4',
  [ValidateSet('offline','microsoft')][string]$Auth='offline',
  [int]$BotCount=1,
  [string]$BotNamePrefix='Worker',
  [int]$HubPort=3100
)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'setup' | Out-Null

function Ask-Text([string]$Prompt,[string]$Default) {
  if ($NonInteractive) { return $Default }
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value.Trim()
}
function Ask-Yes([string]$Prompt,[bool]$Default=$true) {
  if ($NonInteractive) { return $Default }
  $suffix = if ($Default) { 'J/n' } else { 'j/N' }
  $value = (Read-Host "$Prompt [$suffix]").Trim().ToLowerInvariant()
  if (-not $value) { return $Default }
  return @('j','ja','y','yes').Contains($value)
}
function Ask-Port([string]$Prompt,[int]$Default,[int[]]$Reserved) {
  while ($true) {
    $raw = Ask-Text $Prompt ([string]$Default)
    $port = 0
    if ([int]::TryParse($raw,[ref]$port) -and $port -ge 1 -and $port -le 65535 -and -not ($Reserved -contains $port)) {
      if (Test-FMPortListening -Port $port) {
        $alternative = Get-FMFreePort -Preferred ($port + 1) -Reserved $Reserved
        if ($NonInteractive -or (Ask-Yes "Poort $port is bezet. Gebruik vrije poort $alternative?" $true)) { return $alternative }
      } else { return $port }
    } else { Write-Host 'Voer een unieke poort tussen 1 en 65535 in.' -ForegroundColor Yellow }
  }
}

try {
  Assert-FMProject
  Write-FMLog "Windows $([Environment]::OSVersion.Version); PowerShell $($PSVersionTable.PSVersion)"
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot((Get-FMProjectRoot)).TrimEnd(':\'))
  if ($null -ne $drive.Free -and $drive.Free -lt 750MB) { throw 'Minimaal 750 MB vrije schijfruimte is vereist.' }
  if ($null -eq $drive.Free) { Write-FMLog 'Vrije schijfruimte kon niet betrouwbaar worden bepaald; de schrijftest gaat door.' 'WARN' }
  $writeProbe = Join-Path (Get-FMProjectRoot) ".setup-write-$([guid]::NewGuid().ToString('N')).tmp"
  Set-Content -LiteralPath $writeProbe -Value 'ok'; Remove-Item -LiteralPath $writeProbe -Force

  if (-not (Get-FMNodeCommand)) {
    if ($InstallNode -or (-not $NonInteractive -and (Ask-Yes "Node.js ontbreekt. Installeren via winget?" $true))) { Install-FMNode }
    else { throw "Node.js $(Get-FMRequiredNodeMajor)+ ontbreekt." }
  }
  $node = Get-FMNodeCommand
  $nodeVersion = & $node --version
  $nodeMajor = [int]([regex]::Match($nodeVersion,'\d+').Value)
  if ($nodeMajor -lt (Get-FMRequiredNodeMajor)) { throw "Node.js $nodeVersion is te oud; minimaal major $(Get-FMRequiredNodeMajor) is vereist." }
  Write-FMLog "Node=$nodeVersion npm=$(& (Get-FMNpmCommand) --version)"

  foreach ($relative in @('Logs','backups','runtime','Data\knowledge','Data\team','Data\tasks','Data\events','Data\schematics','Bots\official-bot\knowledge','Bots\official-bot\worlds')) {
    New-Item -ItemType Directory -Path (Join-Path (Get-FMProjectRoot) $relative) -Force | Out-Null
  }

  $settingsFile = Join-Path (Get-FMProjectRoot) 'Config\settings.json'
  $portsFile = Join-Path (Get-FMProjectRoot) 'Config\ports.json'
  $configure = $ResetConfig -or -not (Test-Path -LiteralPath $settingsFile)
  if (-not $configure -and -not $Repair) { $configure = -not (Ask-Yes 'Bestaande configuratie behouden?' $true) }
  if ($configure) {
    if (Test-Path -LiteralPath $settingsFile) {
      if ($ResetConfig -and -not $NonInteractive -and -not (Ask-Yes 'Configuratie echt opnieuw instellen? Er wordt eerst een backup gemaakt.' $false)) { throw 'Reset geannuleerd.' }
      New-FMDataBackup -Reason 'setup' | Out-Null
    }
    $hostName = Ask-Text 'Minecraft-serveradres' $MinecraftHost
    if ($hostName -notmatch '^[A-Za-z0-9._:-]+$') { throw 'Ongeldig Minecraft-serveradres.' }
    $mcPort = Ask-Port 'Minecraft-serverpoort' $MinecraftPort @()
    $mcVersion = Ask-Text 'Minecraft-versie' $MinecraftVersion
    if ($mcVersion -notmatch '^\d+(\.\d+){1,2}$') { throw 'Ongeldige Minecraft-versie.' }
    $auth = (Ask-Text 'Authenticatie (offline/microsoft)' $Auth).ToLowerInvariant()
    if (@('offline','microsoft') -notcontains $auth) { throw 'Authenticatie moet offline of microsoft zijn.' }
    $countText = Ask-Text 'Aantal bots' ([string]$BotCount); $count = 0
    if (-not [int]::TryParse($countText,[ref]$count) -or $count -lt 1 -or $count -gt 32) { throw 'Aantal bots moet tussen 1 en 32 liggen.' }
    $hubPort = Ask-Port 'Hub/dashboardpoort' $HubPort @($mcPort)
    $dashboard = Ask-Yes 'Dashboard inschakelen?' $true
    $viewer = Ask-Yes 'Viewers inschakelen?' $true
    $team = Ask-Yes 'Teamfunctionaliteit inschakelen?' $true
    $learning = Ask-Yes 'Learning inschakelen?' $true
    $reserved = @($mcPort,$hubPort); $bots = @(); $portMap = [ordered]@{}
    $names = @{}
    for ($index=1; $index -le $count; $index++) {
      $defaultName = if ($count -eq 1 -and $BotNamePrefix -eq 'Worker') { 'official-bot' } else { "$BotNamePrefix$index" }
      $name = Ask-Text "Botnaam $index" $defaultName
      if ($name -notmatch '^[A-Za-z0-9_\-]{3,16}$') { throw "Botnaam '$name' moet 3-16 letters, cijfers, _ of - bevatten." }
      if ($names.ContainsKey($name.ToLowerInvariant())) { throw "Dubbele botnaam: $name" }
      $names[$name.ToLowerInvariant()] = $true
      $hud = Get-FMFreePort -Preferred (3110 + (($index-1)*2)) -Reserved $reserved; $reserved += $hud
      $viewPort = Get-FMFreePort -Preferred ($hud+1) -Reserved $reserved; $reserved += $viewPort
      $bots += [ordered]@{ id=[guid]::NewGuid().ToString(); name=$name; username=$name; auth=$auth; folder='@/Bots\official-bot'; host=$hostName; port=$mcPort; version=$mcVersion; hudPort=$hud; viewerPort=$viewPort; viewerEnabled=$viewer; group='Ungrouped'; autoRestart=$true; disabledUntil=$null; stats=[ordered]@{starts=0;crashes=0;totalRuntimeMs=0;lastExit=$null;lastError='';recentCrashes=@()} }
      $portMap[$name] = [ordered]@{hud=$hud;viewer=$viewPort}
    }
    $settings = [ordered]@{
      schemaVersion=1; bots=$bots; groups=@('Ungrouped'); serverProfiles=@([ordered]@{id='installed-server';name='Installed server';host=$hostName;port=$mcPort;version=$mcVersion}); schedules=@(); mergeHistory=@()
      team=[ordered]@{enabled=$team;heartbeatIntervalMs=3000;botOfflineAfterMs=12000;taskAcceptTimeoutMs=10000;taskReservationMs=30000;areaReservationMs=60000;objectReservationMs=30000;inventoryReservationMs=60000;maxTaskRetries=3;assignmentIntervalMs=2000;conflictDistance=2.5;conflictTimeoutMs=5000;yieldCooldownMs=3000;logisticsContainers=@()}
      dashboard=[ordered]@{enabled=$dashboard;realtimeEnabled=$true;positionUpdateIntervalMs=1000;statusUpdateIntervalMs=3000;eventBufferSize=500;debugMode=$false;allowControlActions=$true}
      learning=[ordered]@{enabled=$learning;curriculumEnabled=$true}
      viewerLayout=[ordered]@{columns=2;order=@();hidden=@()}
    }
    Write-FMJsonAtomic -Path $settingsFile -Value $settings
    Write-FMJsonAtomic -Path $portsFile -Value ([ordered]@{hub=$hubPort;bots=$portMap})
    Write-FMLog "Configuratie geschreven voor $count bot(s), zonder secrets."
  } else { Write-FMLog 'Bestaande configuratie behouden.' }

  # Info: iedere geregistreerde bot krijgt lokale runtime-instellingen wanneer die ontbreken.
  $currentSettings = Read-FMJson $settingsFile
  foreach ($botEntry in @($currentSettings.bots)) {
    $folderValue = [string]$botEntry.folder
    $botFolder = if ($folderValue.StartsWith('@/')) { Join-Path (Get-FMProjectRoot) $folderValue.Substring(2) } else { $folderValue }
    if (-not (Test-Path -LiteralPath $botFolder -PathType Container)) { continue }
    $botSettingsPath = Join-Path $botFolder 'bot-settings.json'
    if (-not (Test-Path -LiteralPath $botSettingsPath)) {
      $botRuntimeSettings = [ordered]@{
        host=[string]$botEntry.host;port=[int]$botEntry.port;username=[string]$botEntry.username
        auth=if(@('offline','microsoft') -contains [string]$botEntry.auth){[string]$botEntry.auth}else{'offline'}
        version=[string]$botEntry.version;worldId='default';dataProfile='default'
        ownerPlayer=[string]$botEntry.ownerPlayer;offlineSkinMode='off';offlineSkinValue='';offlineSkinVariant='classic';eliteMode=$true
        whitelistedPlayers=@($botEntry.whitelistedPlayers)
        learning=[ordered]@{enabled=$true;curriculumEnabled=$true;maxSkillRetries=3;taskTimeoutMs=120000;memoryResultLimit=5;minimumSkillSuccessRate=0.7;minimumCurriculumSuccesses=3;experienceDeduplicationWindowMs=3600000}
        safety=[ordered]@{minimumHealth=10;minimumFood=8;fleeDistance=16}
      }
      Write-FMJsonAtomic -Path $botSettingsPath -Value $botRuntimeSettings
      Write-FMLog "Ontbrekende bot-settings aangemaakt voor $($botEntry.name)."
    }
  }

  Install-FMDependencies
  $installMetadata = [ordered]@{schemaVersion=1;version=(Get-FMAppVersion);installedAt=(Get-Date).ToUniversalTime().ToString('o');model=(if(Test-Path (Join-Path (Get-FMProjectRoot) '.git')){'git'}else{'bundled'});branch='main';repository='https://github.com/White1Coffee/F-'}
  Write-FMJsonAtomic -Path (Join-Path (Get-FMProjectRoot) '.install-source.json') -Value $installMetadata
  $doctor = Invoke-FMDoctor
  if ($doctor -eq 2) { throw 'Doctor vond kritieke fouten.' }
  if ($doctor -eq 1) { Write-FMLog 'Setup voltooid met doctor-waarschuwingen.' 'WARN' } else { Write-FMLog 'Setup voltooid.' }
  if ($StartAfter -or (-not $NonInteractive -and (Ask-Yes 'Project nu starten?' $false))) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1')
  }
  exit 0
} catch {
  Write-FMLog $_.Exception.Message 'ERROR'
  Write-Host "Setup is mislukt. Zie Logs\setup.log" -ForegroundColor Red
  exit 2
}
