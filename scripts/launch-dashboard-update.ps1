[CmdletBinding()]
param([switch]$ProbeOnly)

$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logs=Join-Path $root 'Logs'
$script=Join-Path $PSScriptRoot 'dashboard-update.ps1'
$pidFile=Join-Path $logs 'dashboard-update.pid'
$launcherError=Join-Path $logs 'dashboard-update-launcher.err.log'
$outFile=Join-Path $logs 'dashboard-update.out.log'
$errFile=Join-Path $logs 'dashboard-update.err.log'

New-Item -ItemType Directory -Path $logs -Force|Out-Null
try{
  if(-not(Test-Path -LiteralPath $script)){throw "Updater ontbreekt: $script"}
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$script+'"'))
  if($ProbeOnly){$arguments+='-ProbeOnly'}
  # Info: Start-Process zorgt dat de updater blijft draaien nadat de Hub zichzelf stopt.
  $process=Start-Process -PassThru -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $root -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
  exit 0
}catch{
  $message="$(Get-Date -Format 'o') Updater-launcher mislukt: $($_.Exception.Message)"
  Set-Content -LiteralPath $launcherError -Value $message -Encoding UTF8
  [Console]::Error.WriteLine($message)
  exit 2
}
