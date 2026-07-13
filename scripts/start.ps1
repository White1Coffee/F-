[CmdletBinding()]
param([switch]$NoBrowser,[switch]$NoBots)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'start' | Out-Null
try {
  Assert-FMProject
  $doctor=Invoke-FMDoctor -Quick
  if($doctor -eq 2){throw 'Doctor vond kritieke fouten; start afgebroken.'}
  $ports=Read-FMJson (Join-Path (Get-FMProjectRoot) 'Config\ports.json');$hubPort=[int]$ports.hub
  $url="http://127.0.0.1:$hubPort"
  $running=Test-FMPortListening -Port $hubPort
  if(-not $running){
    $node=Get-FMNodeCommand;if(-not $node){throw 'Node.js ontbreekt.'}
    $logs=Join-Path (Get-FMProjectRoot) 'Logs';New-Item -ItemType Directory -Path $logs -Force|Out-Null
    $process=Start-Process -FilePath $node -ArgumentList 'hub.js' -WorkingDirectory (Join-Path (Get-FMProjectRoot) 'Hub') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'hub.out.log') -RedirectStandardError (Join-Path $logs 'hub.err.log') -PassThru
    Set-FMPidFile 'hub' $process.Id;Write-FMLog "Hub gestart (PID $($process.Id))."
    for($i=0;$i -lt 60 -and -not (Test-FMPortListening -Port $hubPort);$i++){Start-Sleep -Milliseconds 500}
    if(-not (Test-FMPortListening -Port $hubPort)){throw 'Hub werd niet binnen 30 seconden gereed.'}
  } else { Write-FMLog 'Hub draait al; geen dubbel proces gestart.' }
  if(-not $NoBots){
    try{$result=Invoke-RestMethod -Uri "$url/api/bots/action" -Method Post -ContentType 'application/json' -Body '{"action":"start"}' -TimeoutSec 30;Write-FMLog "Bots gestart: $(@($result.bots).Count); overgeslagen: $(@($result.skipped).Count); fouten: $(@($result.errors).Count)"}catch{Write-FMLog "Bots starten via Hub mislukte: $($_.Exception.Message)" 'WARN'}
  }
  Write-Host '';Write-Host 'F-Mineflayer gestart' -ForegroundColor Green;Write-Host "Hub/dashboard: $url/#overview";Write-Host "Logs: $(Join-Path (Get-FMProjectRoot) 'Logs')"
  if(-not $NoBrowser){Start-Process "$url/#overview"}
  exit 0
}catch{Write-FMLog $_.Exception.Message 'ERROR';exit 2}
