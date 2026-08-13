@echo off
setlocal

rem  Connects a Gmail account to Nook for sending mail.
rem  Runs entirely on this machine: the refresh token it prints is a secret and
rem  should go straight into server\.env and the Render dashboard.

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

node tools\gmail-auth.mjs

echo.
pause
