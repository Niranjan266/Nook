# Creates the Android signing key without a human choosing the password.
#
# WHY THIS EXISTS ALONGSIDE Make-Signing-Key.bat
#
# The .bat asks you to type a password. That is the right shape when a person
# is sitting there. It is the wrong shape when the work is being done for you,
# because the obvious alternative — someone else picking a password and telling
# you what it is — produces a signing key that has to be rotated on day one.
# A key whose password has been spoken aloud is not a signing key, it is a
# formality.
#
# So the password is generated here, on this machine, by the OS random number
# generator. It is used, written to the two files that need it, and never
# printed to a console, never passed as a command-line argument (which would
# put it in the process list), and never returned to whoever started this.
# Nobody knows it, including whoever asked for it, until they open the file.
#
# 32 characters from a 62-character alphabet is about 190 bits. That is not
# guessable, and unlike a memorable password it does not need to be — the only
# thing that ever types it is Gradle, reading keystore.properties.
#
# Backslash, quote and colon are deliberately excluded from the alphabet:
# keystore.properties is a Java properties file, where a backslash starts an
# escape sequence, and a password containing one is read back wrong. The build
# then fails claiming the password is incorrect, which sends you looking
# anywhere but at the password.

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$keystore = Join-Path $root 'nook-release.keystore'
$props    = Join-Path $root 'client\android\keystore.properties'
$backup   = Join-Path $root 'NOOK-SIGNING-PASSWORD.txt'

# ---------------------------------------------------------------- keytool
$kt = $null
foreach ($c in @(
  "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\keytool.exe"
)) { if (Test-Path $c) { $kt = $c; break } }
if (-not $kt) {
  $w = Get-Command keytool -EA SilentlyContinue
  if ($w) { $kt = $w.Source }
}
if (-not $kt) { Write-Output "FAILED: no keytool found (install Android Studio)"; exit 1 }

# ------------------------------------------------------ never overwrite one
# Replacing a key that has already signed a published app means nobody can
# update the copy they have installed. Refusing outright is correct: this
# script cannot know whether the existing key is in use, and the recoverable
# mistake is "it did not run".
if (Test-Path $keystore) {
  Write-Output "REFUSED: $keystore already exists."
  Write-Output "         Delete it by hand only if you are certain nothing signed with it has been published."
  exit 2
}

# ------------------------------------------------------------- the password
$alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pw = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

$dname = "CN=Nook, OU=Nook, O=Nook, L=Chennai, ST=Tamil Nadu, C=IN"

# Piped, not passed. `-storepass` on the command line would be visible to any
# process listing for as long as keytool runs.
"$pw`r`n$pw`r`n`r`n" | & $kt -genkeypair -keystore $keystore -alias nook `
  -keyalg RSA -keysize 2048 -validity 10000 -dname $dname *>$null

if (-not (Test-Path $keystore)) { Write-Output "FAILED: keytool produced no keystore"; exit 1 }

# Prove it opens before writing anything that claims it does.
$check = ("$pw`r`n" | & $kt -list -keystore $keystore -alias nook 2>&1 | Out-String)
if ($check -notmatch 'PrivateKeyEntry') {
  Remove-Item $keystore -Force -EA SilentlyContinue
  Write-Output "FAILED: the keystore did not open with its own password; removed it"
  exit 1
}

# --------------------------------------------------------------- the files
# storeFile is resolved by build.gradle as rootProject.file(...), and
# rootProject there is client\android — so ../../ lands back at the repo root.
@"
# Written by tools\make-signing-key.ps1. Gitignored - never commit this.
# storeFile is relative to client\android\
storeFile=../../nook-release.keystore
storePassword=$pw
keyAlias=nook
keyPassword=$pw
"@ | Set-Content -Path $props -Encoding ASCII

@"
Nook - Android signing key password
===================================

    $pw

This password was generated on this computer and has never been sent
anywhere. It is not recoverable: it exists here, in
client\android\keystore.properties, and nowhere else.

WHAT IT IS FOR
    It unlocks nook-release.keystore, which signs the Android app.
    Android checks that signature on every install and every update.

WHAT TO DO NOW
    1. Copy the password into your password manager.
    2. Copy nook-release.keystore somewhere off this computer -
       an encrypted drive, or your password manager as an attachment.
    3. Then you may delete this file. The build does not read it.

IF YOU LOSE THE KEY OR THE PASSWORD
    Nobody who has installed Nook can ever update it. They would each
    have to uninstall and reinstall, losing nothing but being annoyed.
    There is no recovery and no support line. Back it up today.

IF SOMEONE ELSE GETS BOTH
    They can publish updates that Android accepts as genuinely yours.
    Treat it like the key to the front door, because it is one.
"@ | Set-Content -Path $backup -Encoding UTF8

$pw = $null
[GC]::Collect()

# Only non-secret facts come back out of this script. The certificate
# fingerprint is worth knowing and is not a secret, but reading it here would
# mean handling the password again for no reason — apksigner prints it from
# the finished APK, which is the copy that actually matters anyway.
Write-Output "OK: keystore created and verified"
Write-Output "OK: client\android\keystore.properties written"
Write-Output "OK: NOOK-SIGNING-PASSWORD.txt written (gitignored) - back it up, then delete it"
