@echo off
setlocal EnableDelayedExpansion
title Nook - mobile
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Nook - phone app (Expo)
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

REM ------------------------------------------------- Find this machine's LAN IP
REM The single most common reason a new React Native app "can't reach the
REM server": localhost on your phone means the PHONE, not this computer.
REM
REM Picking the first IPv4 from ipconfig is not good enough - a typical dev
REM machine also has VirtualBox, WSL, Hyper-V and VPN adapters, and those
REM addresses are unreachable from your phone. So: require a default gateway
REM (a real network), exclude the virtual and VPN adapters by name, and take
REM the lowest route metric - which is the connection Windows actually prefers.
REM The logic lives in tools\lan-ip.ps1 — escaping a PowerShell pipeline inside
REM a cmd for-loop is a reliable way to lose an afternoon.
set LANIP=
for /f "usebackq delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\lan-ip.ps1"`) do set LANIP=%%a

if "%LANIP%"=="" (
  echo   [!] Could not detect a LAN IP address.
  echo       Expo will guess. If the app cannot reach the server, put your
  echo       computer's IP into mobile\.env as:
  echo         EXPO_PUBLIC_API_URL=http://YOUR-IP:4000
  echo.
) else (
  echo   [ok] This computer is %LANIP% on your network
  > "mobile\.env" echo # Written by Nook-Mobile.bat - your phone reaches the API here.
  >> "mobile\.env" echo # Delete this file to let Expo auto-detect instead.
  >> "mobile\.env" echo EXPO_PUBLIC_API_URL=http://%LANIP%:4000
)

REM ------------------------------------------------------------- Dependencies
if not exist "server\node_modules" (
  echo   [..] Installing server dependencies
  pushd server
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :installfailed
  popd
)

if not exist "mobile\node_modules" (
  echo   [..] Installing mobile dependencies - this one takes a few minutes
  pushd mobile
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :installfailed
  popd
)
echo   [ok] Dependencies ready

REM ------------------------------------------------------------ Start the API
REM The phone app is useless without it, so start it here too if it is not up.
curl -s -o nul -w "%%{http_code}" http://localhost:4000/api/health 2>nul | findstr "200" >nul
if not !errorlevel!==0 (
  echo   [..] Starting the API
  start "Nook server" cmd /k "cd /d "%~dp0server" && node src/index.js"

  set READY=0
  for /l %%i in (1,1,45) do (
    if !READY!==0 (
      timeout /t 2 /nobreak >nul
      curl -s -o nul -w "%%{http_code}" http://localhost:4000/api/health 2>nul | findstr "200" >nul
      if !errorlevel!==0 set READY=1
    )
  )
  if !READY!==0 (
    echo.
    echo   [X] The API did not start. Check the "Nook server" window.
    echo.
    pause
    exit /b 1
  )
)
echo   [ok] API up on http://localhost:4000

REM ------------------------------------------------------- Windows Firewall
REM Your phone connects to port 4000 across the network. Windows blocks that
REM by default, and the failure looks like "the app just won't load".
netsh advfirewall firewall show rule name="Nook API 4000" >nul 2>&1
if errorlevel 1 (
  echo   [..] Adding a firewall rule so your phone can reach port 4000
  netsh advfirewall firewall add rule name="Nook API 4000" dir=in action=allow protocol=TCP localport=4000 >nul 2>&1
  if errorlevel 1 (
    echo   [!] Could not add it - you are not running as administrator.
    echo       If the phone cannot connect, right-click this file and
    echo       choose "Run as administrator" once.
  ) else (
    echo   [ok] Firewall rule added
  )
) else (
  echo   [ok] Firewall rule already present
)

echo.
echo   ==========================================
echo     Starting Expo
echo.
if not "%LANIP%"=="" echo     Phone will use  http://%LANIP%:4000
echo.
echo     1. Install "Expo Go" on your phone
echo          iOS      App Store
echo          Android  Play Store
echo     2. Make sure the phone is on the SAME Wi-Fi
echo     3. Scan the QR code that appears
echo.
echo     Demo accounts - password: nookdemo1
echo       ada  .  river  .  kofi  .  mira
echo   ==========================================
echo.

cd /d "%~dp0mobile"
call npx expo start
exit /b 0

:installfailed
popd
echo.
echo   [X] npm install failed. Scroll up for the reason.
echo.
pause
exit /b 1
