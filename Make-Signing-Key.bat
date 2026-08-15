@echo off
setlocal EnableDelayedExpansion
title Nook - create the app signing key
cd /d "%~dp0"

rem  Creates the key that signs the Android app, and the properties file the
rem  build reads to find it.
rem
rem  Like Make-Keys.bat and Make-Admin.bat, this exists so the password is typed
rem  here and nowhere else. It is never shown on screen, never passed as an
rem  argument, and never leaves this machine.

echo.
echo   ==========================================
echo     Nook - app signing key
echo   ==========================================
echo.
echo   This creates the key that proves an update to Nook really
echo   came from you. Android checks it on every install.
echo.

rem ----------------------------------------------------------------- keytool
set "KEYTOOL="
if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe" (
  set "KEYTOOL=%ProgramFiles%\Android\Android Studio\jbr\bin\keytool.exe"
) else (
  where keytool >nul 2>&1
  if not errorlevel 1 set "KEYTOOL=keytool"
)

if "!KEYTOOL!"=="" (
  echo   [X] Could not find keytool.
  echo.
  echo       It comes with Java. The easiest source is Android Studio,
  echo       which you need for the build anyway:
  echo       https://developer.android.com/studio
  echo.
  pause
  exit /b 1
)

rem ------------------------------------------------------- already have one?
if exist "nook-release.keystore" (
  echo   [!] nook-release.keystore already exists.
  echo.
  echo       DO NOT replace it if you have already published Nook.
  echo       A different key means nobody can update the app they have
  echo       installed - they would each have to uninstall first.
  echo.
  set /p "REPLACE=       Type REPLACE to overwrite it, or press Enter to stop: "
  if /i not "!REPLACE!"=="REPLACE" (
    echo.
    echo   Left alone. Nothing changed.
    echo.
    pause
    exit /b 0
  )
  del /f /q "nook-release.keystore"
)

echo.
echo   ------------------------------------------------------------
echo     Choose a password. You will be asked for it twice.
echo.
echo     Write it down somewhere safe FIRST. There is no way to
echo     recover it, and without it the key is useless - which
echo     means never being able to update the app again.
echo   ------------------------------------------------------------
echo.
echo   keytool will also ask for your name, city and so on. None of
echo   it is shown to anyone; press Enter to skip any of them.
echo.
pause

"!KEYTOOL!" -genkeypair -v ^
  -keystore "nook-release.keystore" ^
  -alias nook ^
  -keyalg RSA -keysize 2048 ^
  -validity 10000

if errorlevel 1 (
  echo.
  echo   [X] The key was not created. The message above says why.
  echo       The most common cause is the two passwords not matching.
  echo.
  pause
  exit /b 1
)

if not exist "nook-release.keystore" (
  echo.
  echo   [X] keytool finished but no keystore appeared.
  echo.
  pause
  exit /b 1
)

rem ------------------------------------------------- the properties the build reads
echo.
echo   ------------------------------------------------------------
echo     Now type that same password once more, so the build can
echo     use the key without asking every time.
echo.
echo     It goes into client\android\keystore.properties, which is
echo     gitignored and stays on this machine.
echo   ------------------------------------------------------------
echo.

rem  Read it without echoing to the screen. PowerShell's SecureString prompt is
rem  the only way to do this in a .bat without the password appearing in the
rem  window, in the command history, or in a process listing.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command ^
  "$s = Read-Host -AsSecureString 'Password'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "PW=%%p"

if "!PW!"=="" (
  echo.
  echo   [X] No password given, so keystore.properties was not written.
  echo       The key itself is fine - run this again to finish.
  echo.
  pause
  exit /b 1
)

> "client\android\keystore.properties" (
  echo # Written by Make-Signing-Key.bat. Gitignored - never commit this.
  echo # storeFile is relative to client\android\
  echo storeFile=../../nook-release.keystore
  echo storePassword=!PW!
  echo keyAlias=nook
  echo keyPassword=!PW!
)

set "PW="

echo.
echo   ==========================================
echo     Done.
echo.
echo       Key      nook-release.keystore
echo       Config   client\android\keystore.properties
echo.
echo     Build-Android.bat will now produce a signed
echo     release build instead of a debug one.
echo   ==========================================
echo.
echo   BACK UP nook-release.keystore SOMEWHERE OFF THIS COMPUTER.
echo.
echo     Lose it  - you can never update an installed Nook.
echo     Leak it  - someone else can publish updates as you.
echo.
echo   It is gitignored, so it is NOT in your repository. A copy in
echo   a password manager or an encrypted drive is enough.
echo.
pause
