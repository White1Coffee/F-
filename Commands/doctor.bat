@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\doctor.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" echo Alles is in orde.
if "%EXIT_CODE%"=="1" echo Doctor vond waarschuwingen.
if "%EXIT_CODE%"=="2" echo Doctor vond kritieke fouten.
pause
exit /b %EXIT_CODE%
