[CmdletBinding()]
param([switch]$SkipTests,[switch]$StageOnly,[string]$IsccPath='')
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'build-installer'|Out-Null
try{
  Assert-FMProject;$root=Get-FMProjectRoot;$version=Get-FMAppVersion
  if(-not $SkipTests){foreach($project in @('Hub','Bots\official-bot')){Push-Location(Join-Path $root $project);try{& (Get-FMNodeCommand) --test;if($LASTEXITCODE -ne 0){throw "Tests mislukten in $project"}}finally{Pop-Location}}}
  $stage=Join-Path $root 'installer\staging';$dist=Join-Path $root 'dist'
  if(Test-Path $stage){Remove-Item $stage -Recurse -Force};New-Item -ItemType Directory -Path $stage -Force|Out-Null;New-Item -ItemType Directory -Path $dist -Force|Out-Null
  $excludeDirs=@('node_modules','Logs','logs','backups','runtime','microsoft-auth','prismarine-auth','worlds','knowledge','knowledge-backups','.npm-cache','staging')
  $excludeFiles=@('.env','.npmrc','bot-settings.json','hub-settings.json','ai-memory.json','ai-recipes.json','settings.json','ports.json','*.tmp','*.pid','*token*','*secret*','*credentials*','bot-output.log','bot-error.log')
  function Copy-ReleaseTree([string]$Relative){
    $source=Join-Path $root $Relative;if(-not(Test-Path $source)){return}
    $destination=Join-Path $stage $Relative;New-Item -ItemType Directory -Path $destination -Force|Out-Null
    $copyArgs=@($source,$destination,'/E','/NFL','/NDL','/NJH','/NJS','/NP','/R:1','/W:1','/XD')+$excludeDirs+@('/XF')+$excludeFiles
    & robocopy.exe @copyArgs|Out-Null;$copyCode=$LASTEXITCODE;if($copyCode -ge 8){throw "Staging kopieren van $Relative mislukte (robocopy $copyCode)."}
  }
  foreach($relative in @('Hub','Bots\official-bot','scripts','Tools\scripts','minecraft-discord-bot','installer')){Copy-ReleaseTree $relative}
  New-Item -ItemType Directory -Path (Join-Path $stage 'Config') -Force|Out-Null
  foreach($file in @('Bots\package.json','Bots\package-lock.json','.gitignore','.nvmrc','README.md','install.bat','setup.bat','start.bat','stop.bat','doctor.bat','update.bat','uninstall.bat','build-installer.bat','Start.cmd','Stop.cmd','StartDiscord.cmd','StopDiscord.cmd')){
    $source=Join-Path $root $file;if(Test-Path $source){$destination=Join-Path $stage $file;New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null;Copy-Item -LiteralPath $source -Destination $destination -Force}
  }
  foreach($required in @('Hub\hub.js','Bots\official-bot\bot.js','minecraft-discord-bot\index.js','minecraft-discord-bot\package.json','scripts\setup.ps1','scripts\dashboard-update.ps1','setup.bat')){if(-not(Test-Path(Join-Path $stage $required))){throw "Staging mist $required"}}
  $forbidden=Get-ChildItem $stage -Recurse -Force|Where-Object{$_.Name -match '(?i)(\.env|token|secret|credentials|microsoft-auth|node_modules|\.npm-cache)' }
  if($forbidden){throw "Gevoelige/runtimebestanden in staging: $($forbidden[0].FullName)"}
  $unexpectedBots=Get-ChildItem (Join-Path $stage 'Bots') -Directory|Where-Object{$_.Name -ne 'official-bot'}
  if($unexpectedBots){throw "Onverwachte botmap in staging: $($unexpectedBots[0].Name)"}
  if($StageOnly){Write-FMLog "Veilige staging gecontroleerd: $stage";exit 0}
  if(-not $IsccPath){$candidates=@("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe","${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe","$env:ProgramFiles\Inno Setup 6\ISCC.exe");$IsccPath=$candidates|Where-Object{Test-Path $_}|Select-Object -First 1}
  if(-not $IsccPath){throw 'Inno Setup 6 Compiler niet gevonden. Installeer Inno Setup of geef -IsccPath op.'}
  & $IsccPath "/DAppVersion=$version" "/DSourceRoot=$stage" "/DOutputRoot=$dist" (Join-Path $root 'installer\F-Mineflayer.iss')
  if($LASTEXITCODE -ne 0){throw "Inno Setup compile mislukte (exit $LASTEXITCODE)."}
  $exe=Join-Path $dist "F-Mineflayer-Setup-$version.exe";if(-not(Test-Path $exe)){throw 'Installeroutput ontbreekt.'}
  if($env:SIGNTOOL_PATH -and $env:SIGN_CERT_THUMBPRINT){$timestamp=if($env:SIGN_TIMESTAMP_URL){$env:SIGN_TIMESTAMP_URL}else{'http://timestamp.digicert.com'};& $env:SIGNTOOL_PATH sign /sha1 $env:SIGN_CERT_THUMBPRINT /tr $timestamp /td sha256 /fd sha256 $exe;if($LASTEXITCODE -ne 0){throw 'Code signing mislukte.'};Write-FMLog 'Installer digitaal ondertekend.'}else{Write-FMLog 'Unsigned installer gebouwd (geen signingvariabelen ingesteld).' 'WARN'}
  $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant();Set-Content -LiteralPath "$exe.sha256" -Value "$hash  $(Split-Path $exe -Leaf)" -Encoding ASCII
  Write-FMLog "Installer: $exe";exit 0
}catch{Write-FMLog $_.Exception.Message 'ERROR';exit 2}
