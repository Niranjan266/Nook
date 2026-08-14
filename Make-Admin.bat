@echo off
setlocal

rem  Generates ADMIN_USERNAME and ADMIN_PASSWORD_HASH for the /nookcontrol panel.
rem  The password never leaves this machine — only its hash does.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on your PATH.
  echo   Get it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node tools\admin-hash.mjs

echo.
pause
