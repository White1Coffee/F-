[CmdletBinding()]
param([ValidateSet(0,1,2,3,4)][int]$Mode=0,[switch]$Yes,[switch]$CreateBackup)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-FMLog 'uninstall'|Out-Null
try{
  if($Mode -eq 0){Write-Host '1. Alleen programmabestanden';Write-Host '2. Programma en logs';Write-Host '3. Alles behalve knowledge en worlds';Write-Host '4. Volledige verwijdering inclusief knowledge en worlds';$raw=Read-Host 'Keuze';if(-not[int]::TryParse($raw,[ref]$Mode)-or $Mode -lt 1 -or $Mode -gt 4){throw 'Ongeldige keuze.'}}
  if($Mode -eq 4 -and -not $Yes){$confirm=Read-Host 'Typ VERWIJDER ALLES om knowledge en worlds te verwijderen';if($confirm -cne 'VERWIJDER ALLES'){throw 'Volledige verwijdering geannuleerd.'}}
  if($CreateBackup){$destination=Join-Path ([Environment]::GetFolderPath('MyDocuments')) "F-Mineflayer-backup-$(Get-Date -Format yyyyMMdd-HHmmss)";New-Item -ItemType Directory -Path $destination -Force|Out-Null;foreach($relative in @('Config','Data','Bots\official-bot\knowledge','Bots\official-bot\worlds')){if(Test-Path(Join-Path(Get-FMProjectRoot)$relative)){Copy-Item (Join-Path(Get-FMProjectRoot)$relative) (Join-Path $destination $relative) -Recurse -Force}};Write-FMLog "Gebruikersbackup: $destination"}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop.ps1')|Out-Null
  foreach($folder in @([Environment]::GetFolderPath('Desktop'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\F-Mineflayer'))){Get-ChildItem $folder -Filter 'F-Mineflayer*' -ErrorAction SilentlyContinue|Remove-Item -Force -Recurse -ErrorAction SilentlyContinue}
  $preserve=@()
  if($Mode -lt 4){$preserve+=@('Bots\official-bot\knowledge','Bots\official-bot\worlds','Bots\official-bot\microsoft-auth','Data\knowledge')}
  if($Mode -le 2){$preserve+=@('Config','Data','backups')}
  if($Mode -eq 1){$preserve+='Logs'}
  $preserve=@($preserve|Select-Object -Unique)
  $root=Get-FMProjectRoot;$cleanup=Join-Path $env:TEMP "F-uninstall-$([guid]::NewGuid().ToString('N')).ps1"
  $preserveRoot=Join-Path $env:TEMP "F-preserve-$([guid]::NewGuid().ToString('N'))"
  $escapedRoot=$root.Replace("'","''");$escapedPreserve=$preserveRoot.Replace("'","''");$preserveLiteral=($preserve|ForEach-Object{"'"+$_.Replace("'","''")+"'"}) -join ','
  $body="Start-Sleep -Seconds 2`n`$root='$escapedRoot'`n`$stash='$escapedPreserve'`n`$preserve=@($preserveLiteral)`nNew-Item -ItemType Directory -Path `$stash -Force|Out-Null`nforeach(`$relative in `$preserve){`$source=Join-Path `$root `$relative;if(Test-Path -LiteralPath `$source){`$destination=Join-Path `$stash `$relative;New-Item -ItemType Directory -Path (Split-Path -Parent `$destination) -Force|Out-Null;Copy-Item -LiteralPath `$source -Destination `$destination -Recurse -Force}}`nif(Test-Path -LiteralPath `$root){[IO.Directory]::Delete('\\?\'+`$root,`$true)}`nif(`$preserve.Count){New-Item -ItemType Directory -Path `$root -Force|Out-Null;foreach(`$relative in `$preserve){`$source=Join-Path `$stash `$relative;if(Test-Path -LiteralPath `$source){`$destination=Join-Path `$root `$relative;New-Item -ItemType Directory -Path (Split-Path -Parent `$destination) -Force|Out-Null;Copy-Item -LiteralPath `$source -Destination `$destination -Recurse -Force}}}`nRemove-Item -LiteralPath `$stash -Recurse -Force -ErrorAction SilentlyContinue`nRemove-Item -LiteralPath `$MyInvocation.MyCommand.Path -Force"
  Set-Content -LiteralPath $cleanup -Value $body -Encoding UTF8
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$cleanup) -WindowStyle Hidden
  Write-FMLog 'Verwijdering ingepland.';exit 0
}catch{Write-FMLog $_.Exception.Message 'ERROR';exit 2}
