@echo off
title Nook - stop
echo.
echo   Stopping Nook...
echo.

set FOUND=0
for %%P in (4000 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%%P "') do (
    taskkill /PID %%a /F >nul 2>&1
    if not errorlevel 1 (
      echo   [ok] Released port %%P
      set FOUND=1
    )
  )
)

REM Close the launcher's console windows if they are still open.
taskkill /FI "WINDOWTITLE eq Nook server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Nook client*" /F >nul 2>&1

echo.
echo   Done. Nothing is listening on 4000 or 5173 any more.
echo.
timeout /t 3 /nobreak >nul
