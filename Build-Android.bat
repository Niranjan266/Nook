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
REM Gradle needs a JDK, and it is fussy about which one.
REM
REM Android Studio's bundled JDK is preferred even when JAVA_HOME already
REM points somewhere else, which looks rude but is not. A newer JDK than the
REM Android Gradle Plugin supports does not fail politely - it dies inside
REM jlink with "Failed to transform core-for-system-modules.jar", which reads
REM like a corrupt SDK and sends you looking in the wrong place entirely.
REM This machine had JAVA_HOME on JDK 26 and lost a build to exactly that.
REM
REM The JDK that ships with Android Studio is by definition the one that
REM matches the Android tooling installed next to it, so it wins.
if exist "%ProgramFiles%\Android\Android Studio\jbr" (
  set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
  echo   [i] Using the JDK that came with Android Studio.
) else (
  if "%JAVA_HOME%"=="" (
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
  REM The APK ships with the website rather than through GitHub Releases.
  REM Release assets on a private repository return 404 to anyone not signed
  REM in, so the download button could never have worked while this repo is
  REM private - and making it public to host one file is a large change for a
  REM small reason. Copying it into client\public means publishing is a deploy.
  copy /Y "nook.apk" "client\public\nook.apk" >nul
  echo   Copied into the website at client\public\nook.apk
  echo.

  git rev-parse --is-inside-work-tree >nul 2>&1
  if errorlevel 1 (
    echo   [i] Not a git checkout, so nothing was published.
  ) else (
    git add client/public/nook.apk
    git commit -m "Publish the Android app" >nul 2>&1
    git push
    if errorlevel 1 (
      echo   [i] The push failed. Run 'git push' yourself once that is sorted.
    ) else (
      echo   ==========================================
      echo     Pushed. Vercel is deploying it now.
      echo     Live in ~2 minutes at:
      echo     https://nook.niranjand.in/download
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
