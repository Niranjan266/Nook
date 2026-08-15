@echo off
setlocal EnableDelayedExpansion
title Nook - build the Android app
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Nook - build the Android app (APK)
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

REM ---------------------------------------------------------------- Java check
REM Gradle needs a JDK. Android Studio ships one, which is the easiest source
REM if JAVA_HOME is not already set.
if "%JAVA_HOME%"=="" (
  if exist "%ProgramFiles%\Android\Android Studio\jbr" (
    set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
    echo   [i] Using the JDK that came with Android Studio.
  ) else (
    echo   [X] No JDK found.
    echo.
    echo       Easiest fix: install Android Studio, which includes one.
    echo       https://developer.android.com/studio
    echo.
    echo       Then run this again - it will find it automatically.
    echo.
    pause
    exit /b 1
  )
)

REM ------------------------------------------------------------- SDK check
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  ) else (
    echo   [X] The Android SDK is not installed.
    echo       Open Android Studio once and let it install the SDK, then retry.
    echo.
    pause
    exit /b 1
  )
)

echo   [1/4] Installing dependencies...
call npm --prefix client install --include=dev --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo   [2/4] Building the web app...
call npm --prefix client run build
if errorlevel 1 goto :failed

echo.
echo   [3/4] Syncing it into the Android project...
REM This also writes capacitor.build.gradle and capacitor.settings.gradle,
REM which the Gradle build needs and which are not committed because they are
REM generated from whatever plugins are installed.
pushd client
call npx cap sync android
if errorlevel 1 (
  popd
  goto :failed
)
popd

echo.
echo   [4/4] Building the APK... (the first run downloads Gradle - be patient)
pushd client\android

if exist "keystore.properties" (
  echo         Signing key found - building a release APK.
  call gradlew.bat assembleRelease
  set "APK=app\build\outputs\apk\release\app-release.apk"
) else (
  echo         No signing key - building a debug APK.
  echo         Fine for testing. See docs\ANDROID.md to sign a real release.
  call gradlew.bat assembleDebug
  set "APK=app\build\outputs\apk\debug\app-debug.apk"
)

if errorlevel 1 (
  popd
  goto :failed
)
popd

echo.
if exist "client\android\!APK!" (
  copy /Y "client\android\!APK!" "nook.apk" >nul
  echo   ------------------------------------------
  echo     Built: %CD%\nook.apk
  echo   ------------------------------------------
  echo.

  REM ---------------------------------------------------------- publish it
  REM The download page reads the newest GitHub release, so publishing is the
  REM step that actually puts the app in front of anyone. Done here rather
  REM than left as homework, because a build nobody can download is not a
  REM finished job.
  where gh >nul 2>&1
  if errorlevel 1 (
    echo   [i] The GitHub CLI is not installed, so I cannot publish it for you.
    echo.
    echo       Either install it from https://cli.github.com and run this again,
    echo       or upload nook.apk by hand:
    echo.
    echo         1. github.com/Niranjan266/Nook/releases/new
    echo         2. Tag: v1.0.0
    echo         3. Attach nook.apk  ^(the name must be exactly nook.apk^)
    echo         4. Publish
    echo.
    echo       The download page picks it up straight away - no redeploy.
  ) else (
    echo   Publishing to GitHub Releases...
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "(Get-Content client\package.json ^| ConvertFrom-Json).version"') do set "VER=%%v"
    if "!VER!"=="" set "VER=1.0.0"

    gh release view "v!VER!" >nul 2>&1
    if errorlevel 1 (
      gh release create "v!VER!" "nook.apk" --title "Nook v!VER!" --notes "Nook for Android. Install from https://nook.niranjand.in/download"
    ) else (
      echo   Release v!VER! already exists - replacing the APK.
      gh release upload "v!VER!" "nook.apk" --clobber
    )

    if errorlevel 1 (
      echo   [i] Publishing failed. Run 'gh auth login' once, then try again.
    ) else (
      echo.
      echo   ==========================================
      echo     Live at https://nook.niranjand.in/download
      echo   ==========================================
    )
  )
) else (
  echo   [X] The build reported success but no APK was produced.
  echo       Look in client\android\app\build\outputs\apk\
)

echo.
pause
exit /b 0

:failed
echo.
echo   [X] That step failed. The message above says why.
echo.
echo       Most common causes:
echo         - Android SDK not installed (open Android Studio once)
echo         - No internet on the first run (Gradle downloads a lot)
echo.
pause
exit /b 1
