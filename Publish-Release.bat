@echo off
setlocal EnableDelayedExpansion
title Nook - publish a GitHub release
cd /d "%~dp0"

rem  Publishes the built APK as a GitHub release.
rem
rem  The website already serves the APK from /nook.apk, and that is the link
rem  people should be given - it needs no account, no navigation and no
rem  explanation. A GitHub release is the second home: somewhere the older
rem  versions stay reachable, and somewhere a link can point that is not tied
rem  to whatever the site is serving today.
rem
rem  Everything here is a one-liner in gh. It exists as a script because the
rem  order matters and one of the steps cannot be undone.

echo.
echo   ==========================================
echo     Nook - publish to GitHub
echo   ==========================================
echo.

rem --------------------------------------------------------------------- gh
set "GH=gh"
where gh >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\GitHub CLI\gh.exe" (
    set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
  ) else (
    echo   [X] The GitHub CLI is not installed.
    echo.
    echo       winget install --id GitHub.cli
    echo       ...or https://cli.github.com
    echo.
    pause
    exit /b 1
  )
)

rem ------------------------------------------------------------------- login
rem  This is the one step nobody can do for you. The whole point of signing in
rem  is that the credential reaches GitHub and nothing else - not a script, not
rem  a config file, not a chat log. gh stores the token in Windows Credential
rem  Manager and it never appears anywhere readable.
"!GH!" auth status >nul 2>&1
if errorlevel 1 (
  echo   You are not signed in to GitHub yet.
  echo.
  echo   Run this once, in this window, and follow the browser prompt:
  echo.
  echo       gh auth login
  echo.
  echo   Choose: GitHub.com  -  HTTPS  -  Login with a web browser.
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%u in ('"!GH!" api user --jq .login 2^>nul') do set "WHO=%%u"
echo   Signed in as !WHO!.
echo.

rem ------------------------------------------------------------------ the APK
set "APK=client\public\nook.apk"
if not exist "!APK!" (
  echo   [X] No APK at !APK!
  echo       Run Build-Android.bat first.
  echo.
  pause
  exit /b 1
)

rem  The version has to come from the APK itself rather than from build.gradle.
rem  They are supposed to match, but the file on disk is what people install,
rem  and tagging a release with a number the binary does not carry is worse
rem  than not tagging it at all.
set "AAPT="
for /f "delims=" %%a in ('dir /b /o-n "%LOCALAPPDATA%\Android\Sdk\build-tools" 2^>nul') do (
  if not defined AAPT if exist "%LOCALAPPDATA%\Android\Sdk\build-tools\%%a\aapt2.exe" (
    set "AAPT=%LOCALAPPDATA%\Android\Sdk\build-tools\%%a\aapt2.exe"
  )
)

rem  badging prints one line like:
rem    package: name='in.niranjand.nook' versionCode='2' versionName='1.0.1' ...
rem  usebackq and the doubled quotes are not decoration. A for /f command that
rem  begins with a quote makes cmd read the whole thing as a path, and it fails
rem  with "The system cannot find the path specified" while pointing at nothing
rem  in particular. Backticks with the command wrapped in its own pair of
rem  quotes is the form that survives a quoted executable AND a quoted argument.
set "VERSION="
if defined AAPT (
  for /f "usebackq delims=" %%l in (`""!AAPT!" dump badging "!APK!" 2^>nul ^| findstr /b "package:""`) do call :extract "%%l"
)

if "!VERSION!"=="" (
  echo   [!] Could not read the version out of the APK.
  set /p "VERSION=      Type it in (for example 1.0.1): "
)
if "!VERSION!"=="" (
  echo   [X] No version, no release.
  pause
  exit /b 1
)

set "TAG=v!VERSION!"
echo   APK      !APK!
echo   Version  !VERSION!  ^(tag !TAG!^)
echo.

rem -------------------------------------------------------------- visibility
rem  Release assets on a PRIVATE repository return 404 to anyone who is not
rem  signed in with access. A private release is therefore not a publication -
rem  it is a link that works for you and nobody else, which is the worst
rem  possible outcome because it looks like it worked.
for /f "delims=" %%v in ('"!GH!" repo view --json visibility --jq .visibility 2^>nul') do set "VIS=%%v"
echo   Repository is !VIS!.
echo.

if /i "!VIS!"=="private" (
  echo   ------------------------------------------------------------
  echo     A release on a private repository is not public.
  echo.
  echo     Anyone you send the link to gets a 404 unless they have
  echo     access to the repo. If you want the release to be the
  echo     download link, the repository has to be public.
  echo.
  echo     Making it public publishes the SOURCE CODE and the whole
  echo     commit history, permanently - forks and caches survive
  echo     turning it back. The history has been checked and holds
  echo     no .env, no keys and no keystore, but read that sentence
  echo     again before you type anything.
  echo.
  echo     Your site already serves the APK with no account needed:
  echo     https://nook.niranjand.in/download
  echo     Skipping this and keeping the repo private is a perfectly
  echo     good answer.
  echo   ------------------------------------------------------------
  echo.
  set /p "GOPUB=   Type PUBLIC to make the repository public, or Enter to keep it private: "
  if /i "!GOPUB!"=="PUBLIC" (
    "!GH!" repo edit --visibility public --accept-visibility-change-consequences
    if errorlevel 1 (
      echo   [X] Could not change the visibility. Nothing else was done.
      pause
      exit /b 1
    )
    echo   Repository is now public.
  ) else (
    echo.
    echo   Left private. The release will still be created, but its
    echo   download link will only work for you.
  )
  echo.
)

rem ----------------------------------------------------------------- release
rem  Notes go through a file. Batch cannot put a line break inside a quoted
rem  argument, and a single-line release note reads like a commit subject
rem  someone forgot to finish.
set "NOTES=%TEMP%\nook-release-notes.md"
> "!NOTES!" (
  echo Android app, version !VERSION!.
  echo.
  echo ### Install
  echo.
  echo Download `nook.apk`, open it, and allow installs from your browser
  echo when Android asks. Android 5.1 or newer.
  echo.
  echo ### No GitHub account needed
  echo.
  echo The same build is served straight from the site:
  echo https://nook.niranjand.in/download
)

"!GH!" release view "!TAG!" >nul 2>&1
if not errorlevel 1 (
  echo   Release !TAG! already exists - replacing its APK.
  "!GH!" release upload "!TAG!" "!APK!" --clobber
  if errorlevel 1 goto :failed
) else (
  echo   Creating release !TAG!...
  "!GH!" release create "!TAG!" "!APK!" --title "Nook !VERSION!" --notes-file "!NOTES!"
  if errorlevel 1 goto :failed
)
del /q "!NOTES!" >nul 2>&1

echo.
echo   ==========================================
echo     Published.
echo.
rem  usebackq again, and for the same reason as the aapt2 call above: this is
rem  the one gh invocation here with TWO quoted arguments, and cmd strips the
rem  outermost quote pair from a for /f command, which welds them together into
rem  nonsense. It failed silently the first time - the release published fine
rem  and the script simply printed no link.
for /f "usebackq delims=" %%r in (`""!GH!" release view "!TAG!" --json url --jq .url 2^>nul"`) do echo       %%r
echo   ==========================================
echo.
pause
exit /b 0

:extract
rem  Pull versionName='...' out of the badging line without tripping over the
rem  other quoted fields on it.
set "LINE=%~1"
for /f "tokens=2 delims='" %%v in ("!LINE:*versionName=!") do set "VERSION=%%v"
set "VERSION=!VERSION:'=!"
goto :eof

:failed
echo.
echo   [X] gh reported a problem. The message above says what.
echo.
pause
exit /b 1
