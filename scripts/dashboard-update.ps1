[CmdletBinding()]
param([switch]$ProbeOnly)

$ErrorActionPreference='Stop'
try{. (Join-Path $PSScriptRoot 'common.ps1')}catch{[Console]::Error.WriteLine("Updater bootstrap mislukt: $($_.Exception.Message)");exit 2}
$root=Get-FMProjectRoot
$stateFile=Join-Path $root 'Logs\dashboard-update.json'
$pidFile=Join-Path $root 'Logs\dashboard-update.pid'
$startedAt=(Get-Date).ToUniversalTime().ToString('o')

function Set-UpdateState([string]$Status,[string]$Message,[switch]$Finished){
  $value=[ordered]@{status=$Status;message=$Message;startedAt=$startedAt;finishedAt=if($Finished){(Get-Date).ToUniversalTime().ToString('o')}else{$null}}
  Write-FMJsonAtomic -Path $stateFile -Value $value
}

New-Item -ItemType Directory -Path (Split-Path -Parent $stateFile) -Force|Out-Null
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
Write-Output "Dashboard updater gestart (PID $PID)."
if($ProbeOnly){
  Set-UpdateState 'completed' 'Updater-launchercontrole geslaagd.' -Finished
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  exit 0
}
$updateSucceeded=$false
try{
  Set-UpdateState 'checking' 'Naar updates zoeken...'
  # Info: geef de Hub tijd om het HTTP-antwoord te versturen voordat de stopprocedure begint.
  Start-Sleep -Milliseconds 1200
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update.ps1') -Yes
  if($LASTEXITCODE -ne 0){throw "Updateproces stopte met code $LASTEXITCODE. Bekijk Logs\update.log."}
  $updateSucceeded=$true
  Set-UpdateState 'restarting' 'Update verwerkt; Hub en bots worden opnieuw gestart.'
}catch{
  Set-UpdateState 'failed' $_.Exception.Message -Finished
}finally{
  # Info: Ook na een mislukte update wordt de bestaande installatie opnieuw gestart.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start.ps1') -NoBrowser
  if($updateSucceeded -and $LASTEXITCODE -eq 0){Set-UpdateState 'completed' 'Updatecontrole voltooid; het systeem is up-to-date.' -Finished}
  elseif($updateSucceeded){Set-UpdateState 'failed' 'Update lukte, maar automatisch herstarten mislukte. Start handmatig met start.bat.' -Finished}
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if($updateSucceeded){exit 0}else{exit 2}
