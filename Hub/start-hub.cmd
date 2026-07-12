@echo off
title Minecraft AI Bot Hub
cd /d "%~dp0"
if exist "%~dp0..\Node\node.exe" (
  "%~dp0..\Node\node.exe" "%~dp0hub.js"
) else (
  node "%~dp0hub.js"
)
