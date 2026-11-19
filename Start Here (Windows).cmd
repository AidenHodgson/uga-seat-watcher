@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Seat Watcher needs Node.js. Opening the download page now.
  echo Install the LTS version, then double-click this file again.
  start "" https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
node watcher.mjs --open
pause
