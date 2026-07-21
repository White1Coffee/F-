@echo off
setlocal EnableExtensions
title F-Mineflayer installatie
set "BOOTSTRAP=%TEMP%\F-Mineflayer-bootstrap-%RANDOM%.ps1"
if exist "%~dp0..\scripts\bootstrap.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\bootstrap.ps1" %*
) else (
  echo Downloaden van vaste bootstrap via HTTPS...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$u='https://raw.githubusercontent.com/White1Coffee/F-/main/scripts/bootstrap.ps1'; Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile '%BOOTSTRAP%'; $c=Get-Content -LiteralPath '%BOOTSTRAP%' -Raw; if($c -notmatch 'White1Coffee/F-' -or $c -notmatch 'scripts.setup.ps1'){throw 'Bootstrapvalidatie mislukt.'}"
  if errorlevel 1 exit /b 2
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"
del /q "%BOOTSTRAP%" >nul 2>nul
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
