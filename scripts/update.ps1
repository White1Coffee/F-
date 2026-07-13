[CmdletBinding()]
param([switch]$Yes,[string]$Branch='main',[string]$ReleaseTag='')
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'update'|Out-Null
function Confirm-Update([string]$Text){if($Yes){return $true};return @('j','ja','y','yes') -contains (Read-Host "$Text [j/N]").Trim().ToLowerInvariant()}
function Initialize-UpdateApplication {
  # Info: stop en backup worden pas uitgevoerd nadat een nieuwere versie werkelijk is gevonden.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop.ps1')|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Hub en bots konden niet veilig worden gestopt.'}
  $updateBackup=New-FMDataBackup -Reason 'update'
  foreach($relative in @('Data','Bots\official-bot\knowledge','Bots\official-bot\worlds')){
    $source=Join-Path (Get-FMProjectRoot) $relative
    if(Test-Path $source){$dest=Join-Path $updateBackup $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force|Out-Null;Copy-Item -LiteralPath $source -Destination $dest -Recurse -Force}
  }
  return $updateBackup
}
try{
  Assert-FMProject
  if(-not(Confirm-Update 'Naar een nieuwere versie zoeken?')){throw 'Update geannuleerd.'}
  if(Test-Path (Join-Path (Get-FMProjectRoot) '.git')){
    $git=Get-Command git.exe -ErrorAction Stop
    Push-Location (Get-FMProjectRoot)
    try{
      $changes=& $git.Source status --porcelain
      if($changes){throw 'Lokale Git-wijzigingen gevonden. Commit of stash deze eerst; er is niets overschreven.'}
      & $git.Source fetch origin $Branch;if($LASTEXITCODE -ne 0){throw 'git fetch mislukte.'}
      $behind=[int](& $git.Source rev-list --count "HEAD..origin/$Branch")
      if($behind -eq 0){Write-FMLog 'Geen update beschikbaar.';exit 0}
      Write-Host "$behind commit(s) beschikbaar."
      if(-not(Confirm-Update 'Update met fast-forward toepassen?')){throw 'Update geannuleerd.'}
      $backup=Initialize-UpdateApplication
      & $git.Source pull --ff-only origin $Branch;if($LASTEXITCODE -ne 0){throw 'git pull --ff-only mislukte.'}
    }finally{Pop-Location}
  }else{
    $archiveUri=''
    $remoteVersion=''
    if(-not $ReleaseTag){
      Write-FMLog 'Nieuwste GitHub-release bepalen.'
      try{$release=Invoke-RestMethod -UseBasicParsing -TimeoutSec 30 -Uri 'https://api.github.com/repos/White1Coffee/F-/releases/latest' -Headers @{'User-Agent'='F-Mineflayer-Updater'};$ReleaseTag=[string]$release.tag_name}catch{Write-FMLog 'Geen GitHub-release gevonden; gecontroleerde main-branch wordt gebruikt.' 'WARN'}
    }
    if($ReleaseTag){
      if($ReleaseTag -notmatch '^v?[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$'){throw 'Ongeldige release-tag.'}
      $remoteVersion=$ReleaseTag.TrimStart('v');$archiveUri="https://github.com/White1Coffee/F-/archive/refs/tags/$ReleaseTag.zip"
    }else{
      $remotePackage=Invoke-RestMethod -UseBasicParsing -TimeoutSec 30 -Uri 'https://raw.githubusercontent.com/White1Coffee/F-/main/Bots/package.json' -Headers @{'User-Agent'='F-Mineflayer-Updater'}
      $remoteVersion=[string]$remotePackage.version;$archiveUri='https://github.com/White1Coffee/F-/archive/refs/heads/main.zip'
    }
    if($remoteVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$'){throw 'Remote versie is ongeldig.'}
    $currentVersion=Get-FMAppVersion
    if(([version]($remoteVersion -split '-')[0]) -le ([version]($currentVersion -split '-')[0])){Write-FMLog "Versie $currentVersion is al up-to-date (remote: $remoteVersion).";exit 0}
    $backup=Initialize-UpdateApplication
    $programBackup=Join-Path $backup 'program-rollback';New-Item -ItemType Directory -Path $programBackup -Force|Out-Null
    foreach($relative in @('Hub','Bots\official-bot','scripts','installer','Tools','minecraft-discord-bot')){$source=Join-Path (Get-FMProjectRoot) $relative;if(Test-Path $source){$destination=Join-Path $programBackup $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null;Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force}}
    $zip=Join-Path $env:TEMP "F-update-$([guid]::NewGuid().ToString('N')).zip";$stage=Join-Path $env:TEMP "F-update-$([guid]::NewGuid().ToString('N'))"
    try{
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri $archiveUri -OutFile $zip
      Expand-Archive -LiteralPath $zip -DestinationPath $stage
      $source=Get-ChildItem $stage -Directory|Select-Object -First 1
      foreach($required in @('Hub\hub.js','Bots\official-bot\bot.js','scripts\setup.ps1')){if(-not(Test-Path(Join-Path $source.FullName $required))){throw "Releasevalidatie mislukt: $required ontbreekt."}}
      foreach($relative in @('Hub','Bots\official-bot','scripts','installer','Tools','minecraft-discord-bot')){if(Test-Path(Join-Path $source.FullName $relative)){Copy-Item -Path (Join-Path $source.FullName "$relative\*") -Destination (Join-Path (Get-FMProjectRoot) $relative) -Recurse -Force}}
      foreach($file in @('Bots\package.json','Bots\package-lock.json')){if(Test-Path(Join-Path $source.FullName $file)){Copy-Item (Join-Path $source.FullName $file) (Join-Path (Get-FMProjectRoot) $file) -Force}}
      foreach($file in @('install.bat','setup.bat','start.bat','stop.bat','doctor.bat','update.bat','uninstall.bat','build-installer.bat','README.md')){if(Test-Path(Join-Path $source.FullName $file)){Copy-Item (Join-Path $source.FullName $file) (Join-Path (Get-FMProjectRoot) $file) -Force}}
    }catch{foreach($relative in @('Hub','Bots\official-bot','scripts','installer','Tools','minecraft-discord-bot')){$source=Join-Path $programBackup $relative;if(Test-Path $source){Copy-Item -Path (Join-Path $source '*') -Destination (Join-Path (Get-FMProjectRoot) $relative) -Recurse -Force}};Write-FMLog "Update mislukt en programmabestanden zijn teruggezet; backup staat in $backup. $($_.Exception.Message)" 'ERROR';throw}finally{Remove-Item $zip -Force -ErrorAction SilentlyContinue;Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue}
  }
  Install-FMDependencies
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup.ps1') -Repair -NonInteractive
  if($LASTEXITCODE -ne 0){throw 'Repair/migratie na update mislukte.'}
  Write-FMLog 'Update voltooid.';exit 0
}catch{Write-FMLog $_.Exception.Message 'ERROR';exit 2}
