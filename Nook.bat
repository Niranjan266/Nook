@echo off
setlocal EnableDelayedExpansion
title Nook - launcher
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Nook - your corner of the internet
echo   ==========================================
echo.

REM ---------------------------------------------------------------- Node check
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js is not installed, or not on your PATH.
  echo       Get the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo   [ok] Node %NODEVER%

REM --------------------------------------------------------- Free the ports
REM A previous run may still be holding 4000 or 5173.
for %%P in (4000 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%%P "') do (
    echo   [..] Port %%P was busy - stopping the old process
    taskkill /PID %%a /F >nul 2>&1
  )
)

REM ------------------------------------------------------------- Dependencies
if not exist "server\node_modules" (
  echo   [..] Installing server dependencies - this takes a minute the first time
  pushd server
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :installfailed
  popd
  echo   [ok] Server ready
) else (
  echo   [ok] Server dependencies present
)

if not exist "client\node_modules" (
  echo   [..] Installing client dependencies
  pushd client
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :installfailed
  REM npm 11 blocks install scripts by default; Vite's esbuild needs its binary.
  call npm approve-scripts esbuild --no-allow-scripts-pin >nul 2>&1
  call npm rebuild esbuild >nul 2>&1
  popd
  echo   [ok] Client ready
) else (
  echo   [ok] Client dependencies present
)

REM Guard against a half-finished esbuild install from an earlier attempt.
if not exist "client\node_modules\@esbuild\win32-x64\esbuild.exe" (
  echo   [..] Repairing esbuild
  pushd client
  call npm approve-scripts esbuild --no-allow-scripts-pin >nul 2>&1
  call npm rebuild esbuild >nul 2>&1
  popd
)

REM ------------------------------------------------------------------ Startup
echo.
echo   [..] Starting the server
start "Nook server" cmd /k "cd /d "%~dp0server" && node src/index.js"

echo   [..] Waiting for the server to come up
set READY=0
for /l %%i in (1,1,60) do (
  if !READY!==0 (
    timeout /t 2 /nobreak >nul
    curl -s -o nul -w "%%{http_code}" http://localhost:4000/api/health 2>nul | findstr "200" >nul
    if !errorlevel!==0 (
      set READY=1
      echo   [ok] Server is up on http://localhost:4000
    )
  )
)

if !READY!==0 (
  echo.
  echo   [X] The server did not answer within two minutes.
  echo       Look at the "Nook server" window for the reason.
  echo       First run downloads a database engine, so it can be slow.
  echo.
  pause
  exit /b 1
)

echo   [..] Starting the app
start "Nook client" cmd /k "cd /d "%~dp0client" && npm run dev"

echo   [..] Waiting for the app to build
set READY=0
for /l %%i in (1,1,40) do (
  if !READY!==0 (
    timeout /t 2 /nobreak >nul
    curl -s -o nul -w "%%{http_code}" http://localhost:5173 2>nul | findstr "200" >nul
    if !errorlevel!==0 set READY=1
  )
)

echo.
echo   ==========================================
echo     Nook is running
echo.
echo     App      http://localhost:5173
echo     API      http://localhost:4000/api
echo.
echo     Demo accounts - password: nookdemo1
echo       ada  .  river  .  kofi  .  mira
echo.
echo     Sign in as "ada" here and "river" in an
echo     incognito window to see it work live.
echo   ==========================================
echo.
echo   Two windows opened behind this one. Closing
echo   them stops Nook. Or run Stop-Nook.bat.
echo.

start "" http://localhost:5173
timeout /t 4 /nobreak >nul
exit /b 0

:installfailed
popd
echo.
echo   [X] npm install failed. Scroll up for the reason.
echo       Most common cause: no internet connection.
echo.
pause
exit /b 1
