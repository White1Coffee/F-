$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$failures=New-Object Collections.Generic.List[string]
function Check([bool]$Condition,[string]$Message){if($Condition){Write-Host "[OK] $Message" -ForegroundColor Green}else{$failures.Add($Message);Write-Host "[FAIL] $Message" -ForegroundColor Red}}

foreach($file in Get-ChildItem $PSScriptRoot -Filter '*.ps1'){
  $tokens=$null;$errors=$null
  [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)|Out-Null
  Check ($errors.Count -eq 0) "PowerShell-syntax: $($file.Name)"
  foreach($error in $errors){Write-Host "  $($error.Message) op regel $($error.Extent.StartLineNumber)"}
}

. (Join-Path $PSScriptRoot 'common.ps1')
$temp=Join-Path $env:TEMP "F-installer-test-$([guid]::NewGuid().ToString('N'))";New-Item -ItemType Directory -Path $temp -Force|Out-Null
try{
  $json=Join-Path $temp 'config met spaties.json';Write-FMJsonAtomic $json ([ordered]@{schemaVersion=1;naam='Böt';unknown=[ordered]@{keep=$true}})
  $roundtrip=Read-FMJson $json
  Check (($roundtrip.naam -eq 'Böt') -and $roundtrip.unknown.keep) 'Atomische JSON behoudt Unicode en onbekende velden'
  $ports=@();$first=Get-FMFreePort -Preferred 49170 -Reserved $ports;$ports+=$first;$second=Get-FMFreePort -Preferred $first -Reserved $ports
  Check ($first -ne $second) 'Poorttoewijzing voorkomt dubbele poorten'
  Check ((Protect-FMLogText 'token=abc password=hunter2') -notmatch 'abc|hunter2') 'Logredactie verwijdert secrets'
  Check (Test-FMSafeChildPath (Join-Path $root 'Data')) 'Padvalidatie accepteert projectdata'
  $outside = if(([IO.Path]::GetPathRoot($root)).StartsWith('F:',[StringComparison]::OrdinalIgnoreCase)){'C:\outside'}else{'F:\outside'}
  Check (-not(Test-FMSafeChildPath $outside)) 'Padvalidatie blokkeert traversal buiten project'

  # Een npm-waarschuwing op stderr is in Windows PowerShell 5.1 geen installatiefout.
  $mockRoot=Join-Path $temp 'npm-warning-fixture';$mockNpm=Join-Path $mockRoot 'npm.cmd'
  foreach($project in @('Bots','Hub')){New-Item -ItemType Directory -Path (Join-Path $mockRoot $project) -Force|Out-Null;Set-Content -LiteralPath (Join-Path $mockRoot "$project\package-lock.json") -Value '{"lockfileVersion":3}' -Encoding ASCII}
  Set-Content -LiteralPath $mockNpm -Value "@echo off`r`necho npm warn deprecated test-package 1>&2`r`necho.`r`nexit /b 0" -Encoding ASCII
  $originalRoot=$script:FMProjectRoot;$originalNpmCommand=${function:Get-FMNpmCommand};$script:FMProjectRoot=$mockRoot
  function Get-FMNpmCommand { return $mockNpm }
  try { Install-FMDependencies; $warningHandled=$true } catch { $warningHandled=$false } finally { $script:FMProjectRoot=$originalRoot;Set-Item function:Get-FMNpmCommand $originalNpmCommand }
  Check $warningHandled 'npm-waarschuwingen en lege uitvoerregels stoppen setup niet'
}finally{Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-installer.ps1') -SkipTests -StageOnly
Check ($LASTEXITCODE -eq 0) 'Installer-staging kan reproduceerbaar worden gebouwd'
$stage=Join-Path $root 'installer\staging'
Check (Test-Path (Join-Path $stage 'Hub\hub.js')) 'Staging bevat Hub'
Check (Test-Path (Join-Path $stage 'Bots\official-bot\bot.js')) 'Staging bevat official-bot'
Check (Test-Path (Join-Path $stage 'minecraft-discord-bot\index.js')) 'Staging bevat de Discord bot bridge'
Check (Test-Path (Join-Path $stage 'scripts\dashboard-update.ps1')) 'Staging bevat de dashboard updater'
Check (-not(Test-Path (Join-Path $stage 'Config\settings.json'))) 'Staging bevat geen persoonlijke settings'
Check (-not(Get-ChildItem $stage -Recurse -Force|Where-Object{$_.FullName -match '(?i)(node_modules|microsoft-auth|\\worlds\\|\\knowledge\\|\.env$)'})) 'Staging bevat geen dependencies, auth, worlds of knowledge'
$botFolders=@(Get-ChildItem (Join-Path $stage 'Bots') -Directory|Select-Object -ExpandProperty Name)
Check (($botFolders.Count -eq 1) -and ($botFolders[0] -eq 'official-bot')) 'Staging bevat uitsluitend official-bot'
Check (-not(Get-ChildItem $stage -Recurse -Force|Where-Object{$_.FullName -match '(?i)(\.npm-cache|bot-output\.log|bot-error\.log)'})) 'Staging bevat geen lokale caches of botlogs'
Check (-not(Test-Path (Join-Path $stage 'Node\node.exe'))) 'Staging bundelt geen onvolledige Node/npm-runtime'
Check (Test-Path (Join-Path $stage '.nvmrc')) 'Staging legt de vereiste Node-versie vast'

if($failures.Count){Write-Host "$($failures.Count) installer-test(s) mislukt." -ForegroundColor Red;exit 1}
Write-Host 'Alle installer-tests geslaagd.' -ForegroundColor Green;exit 0
