@echo off
setlocal
cd /d "%~dp0"

if exist "..\Node\node.exe" (
  set "NODE_EXE=..\Node\node.exe"
) else (
  set "NODE_EXE=node"
)

"%NODE_EXE%" index.js
endlocal
