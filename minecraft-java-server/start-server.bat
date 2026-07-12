@echo off
cd /d "%~dp0"

set "JAVA_EXE=C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot\bin\java.exe"

"%JAVA_EXE%" -Xms1G -Xmx4G -jar server.jar nogui
pause
