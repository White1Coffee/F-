[CmdletBinding()]
param([int]$TimeoutSeconds=12)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'stop' | Out-Null
try{
  $portsFile=Join-Path (Get-FMProjectRoot) 'Config\ports.json'
  if(Test-Path $portsFile){$hubPort=[int](Read-FMJson $portsFile).hub;try{Invoke-RestMethod -Uri "http://127.0.0.1:$hubPort/api/shutdown" -Method Post -TimeoutSec 4|Out-Null;Write-FMLog 'Nette Hub-shutdown aangevraagd; bots en teamdata worden afgesloten.'}catch{Write-FMLog 'Hub-shutdownroute niet bereikbaar; PID-fallback wordt gebruikt.' 'WARN'}}
  $pid=Get-FMPidFile 'hub'
  if($pid){
    $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
    while((Get-Process -Id $pid -ErrorAction SilentlyContinue)-and (Get-Date)-lt $deadline){Start-Sleep -Milliseconds 300}
    if(Get-Process -Id $pid -ErrorAction SilentlyContinue){if(Test-FMProjectProcess $pid){Stop-Process -Id $pid -Force;Write-FMLog "Project-Hub PID $pid geforceerd gestopt." 'WARN'}else{throw "PID $pid hoort niet bij deze installatie en is niet gestopt."}}
  }
  Remove-FMPidFile 'hub';Write-FMLog 'Stopprocedure voltooid.';exit 0
}catch{Write-FMLog $_.Exception.Message 'ERROR';exit 2}
