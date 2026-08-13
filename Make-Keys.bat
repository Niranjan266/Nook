@echo off
setlocal
title Nook - generate keys
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Nook - generate your secrets
echo   ==========================================
echo.
echo   These are created ON THIS COMPUTER by Node's crypto
echo   library. They are never sent anywhere, and the file
echo   this writes is git-ignored so it cannot be committed.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js is not installed. Get it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "server\node_modules\web-push" (
  echo   [..] Installing server dependencies first - needed for the push keys
  pushd server
  call npm install --no-audit --no-fund
  popd
  echo.
)

echo   [..] Generating...
echo.

cd /d "%~dp0server"
REM Plain ASCII only in the output file: box-drawing characters render as "?"
REM in Notepad depending on the console code page, which looks broken.
node -e "const c=require('crypto');const w=require('web-push');const v=w.generateVAPIDKeys();const out=[];const p=s=>{out.push(s);console.log(s)};const bar='# '+'-'.repeat(62);p(bar);p('# Nook secrets - generated ' + new Date().toISOString());p('#');p('# Paste these into your HOST DASHBOARD (Northflank / Render).');p('# Never commit them, never paste them into a chat or an issue.');p('# If one leaks, run this again and replace it.');p(bar);p('');p('# Signs your login tokens. Changing either signs EVERYONE out.');p('JWT_ACCESS_SECRET=' + c.randomBytes(32).toString('hex'));p('JWT_REFRESH_SECRET=' + c.randomBytes(32).toString('hex'));p('');p('# Push notifications. Without fixed keys the server makes new ones on');p('# every restart, which silently breaks push for everybody.');p('VAPID_PUBLIC_KEY=' + v.publicKey);p('VAPID_PRIVATE_KEY=' + v.privateKey);p('VAPID_SUBJECT=mailto:you@niranjand.in');p('');p(bar);p('# You still have to collect these yourself');p(bar);p('# Turso        https://turso.tech  ->  create db, generate token');p('TURSO_DATABASE_URL=');p('TURSO_AUTH_TOKEN=');p('');p('# Cloudinary   https://cloudinary.com  ->  Dashboard, Account Details');p('CLOUDINARY_CLOUD_NAME=');p('CLOUDINARY_API_KEY=');p('CLOUDINARY_API_SECRET=');p('');p('# TURN, so calls connect for everyone (free):');p('# https://www.metered.ca/tools/openrelay/');p('TURN_URL=');p('TURN_USERNAME=');p('TURN_CREDENTIAL=');p('');p(bar);p('# Your domains - these are not secret');p(bar);p('NODE_ENV=production');p('PORT=4000');p('CLIENT_ORIGIN=https://nook.niranjand.in');p('PUBLIC_URL=https://nook-api.niranjand.in');p('COOKIE_DOMAIN=.niranjand.in');p('');p('# And on VERCEL, one variable only:');p('# VITE_API_URL=https://nook-api.niranjand.in');require('fs').writeFileSync('../MY-KEYS.txt', out.join('\r\n')+'\r\n');"

if errorlevel 1 (
  echo.
  echo   [X] Generation failed. Scroll up for the reason.
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0"
echo.
echo   ==========================================
echo     Saved to MY-KEYS.txt
echo.
echo     That file is git-ignored, so it will not
echo     be committed or pushed.
echo.
echo     Next: open it, fill in the blanks from
echo     Turso and Cloudinary, then paste each
echo     value into your host's dashboard.
echo.
echo     Delete it once they are in the dashboard.
echo   ==========================================
echo.

start "" notepad "MY-KEYS.txt"
pause
