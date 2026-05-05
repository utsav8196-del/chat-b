@echo off
title StackChat Backend Server
cd /d "%~dp0"
echo Starting StackChat Backend Server...
echo.
node src/server.js
pause
