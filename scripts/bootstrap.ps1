[CmdletBinding()]
param([string]$Branch='main',[string]$InstallDir=(Join-Path $env:LOCALAPPDATA 'Programs\F-Mineflayer'),[switch]$NonInteractive)
$ErrorActionPreference='Stop'
$repo='https://github.com/White1Coffee/F-'
function Confirm-Step([string]$Text){if($NonInteractive){return $true};return @('j','ja','y','yes') -contains (Read-Host "$Text [j/N]").Trim().ToLowerInvariant()}
try{
  Write-Host "Repository: $repo";Write-Host "Branch: $Branch";Write-Host "Installatiemap: $InstallDir"
  if($Branch -notmatch '^[A-Za-z0-9._/-]+$'){throw 'Ongeldige branchnaam.'}
  $parent=Split-Path -Parent $InstallDir;New-Item -ItemType Directory -Path $parent -Force|Out-Null
  if(Test-Path $InstallDir){if(-not (Confirm-Step 'De map bestaat al. Setup uitvoeren zonder bestanden te verwijderen?')){throw 'Installatie geannuleerd.'}}
  else{
    $git=Get-Command git.exe -ErrorAction SilentlyContinue
    if($git){& $git.Source clone --branch $Branch --single-branch --depth 1 "$repo.git" $InstallDir;if($LASTEXITCODE -ne 0){throw 'git clone mislukte.'}}
    else{
      $zip=Join-Path $env:TEMP "F-Mineflayer-$([guid]::NewGuid().ToString('N')).zip";$stage=Join-Path $env:TEMP "F-Mineflayer-$([guid]::NewGuid().ToString('N'))"
      try{Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/White1Coffee/F-/archive/refs/heads/$Branch.zip" -OutFile $zip;Expand-Archive -LiteralPath $zip -DestinationPath $stage;New-Item -ItemType Directory -Path $InstallDir -Force|Out-Null;$source=Get-ChildItem $stage -Directory|Select-Object -First 1;if(-not $source){throw 'ZIP bevat geen repositorymap.'};Copy-Item -Path (Join-Path $source.FullName '*') -Destination $InstallDir -Recurse -Force}finally{Remove-Item $zip -Force -ErrorAction SilentlyContinue;Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue}
    }
  }
  foreach($required in @('Hub\hub.js','Bots\official-bot\bot.js','scripts\setup.ps1')){if(-not(Test-Path(Join-Path $InstallDir $required))){throw "Downloadvalidatie mislukt: $required ontbreekt."}}
  if($NonInteractive){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'scripts\setup.ps1') -NonInteractive}
  else{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'scripts\setup.ps1')}
  exit $LASTEXITCODE
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 2}
