# Nook for Android

The app is the website. There is no second codebase.

`client/android/` is a Capacitor project whose only job is to open
`https://nook.niranjand.in` in a full-screen web view and add the handful of
things a browser cannot do: notifications that reach a locked phone, with
their own sound and vibration; an icon on the home screen; and a back button
that closes a sheet rather than the app.

That choice is the whole design, so it is worth being explicit about why.

## Why it loads from the server rather than from files inside the APK

Capacitor's default is to bundle `dist/` into the APK and serve it from
`capacitor://localhost`. That is right for most apps and wrong for this one,
because it makes the app a **different origin** from the API — and everything
about staying signed in depends on the origin:

- the refresh cookie is scoped to `.niranjand.in`, so a page on
  `capacitor://localhost` cannot send it, and every launch would start signed
  out;
- Google sign-in redirects back to a URL on that domain;
- CORS is an allowlist of real origins.

Each has a workaround. Together they are three new ways to be broken that the
browser version simply does not have.

Loading the live URL means cookies, sign-in and CORS behave **identically to
Chrome**, and every deploy reaches phones immediately — nobody reinstalls an
APK to get a fix. The cost is that the app needs a connection to start, which
a chat app needs anyway, and the service worker still caches the shell so a
launch on a bad connection is fast rather than blank.

## Building it

Double-click **`Build-Android.bat`**. It checks for a JDK and the Android SDK,
builds the web app, syncs it, and produces `nook.apk` in the project root.

The first run downloads Gradle and takes a while. After that it is quick.

If you have never built an Android app on this machine, install
[Android Studio](https://developer.android.com/studio) and open it once — that
installs both the JDK and the SDK, and the script finds them on its own.

## Notifications — the part that needs Firebase

**Push does not work until you do this.** Everything else does.

Web Push does not exist inside an Android WebView, so the app cannot use the
browser's notification subscription. Android apps use Firebase Cloud
Messaging, and FCM needs a project that only you can create.

Until it is set up, the app still shows notifications **while it is open** —
it is background and locked-screen notifications that are missing. The
installed PWA in Chrome keeps working normally throughout, so nobody loses
anything by waiting.

### 1. Make a Firebase project

1. Go to <https://console.firebase.google.com> and create a project. Name it
   anything; Analytics is not needed.
2. Add an **Android** app to it. The package name must be exactly:

   ```
   in.niranjand.nook
   ```

   Leave the SHA-1 field empty — it is only needed for Google sign-in *through
   Firebase*, which Nook does not use.
3. Download **`google-services.json`** and put it at:

   ```
   client/android/app/google-services.json
   ```

   It is gitignored. Capacitor detects it and enables push automatically; with
   no file, the build still succeeds and simply has no push.

### 2. Give the server permission to send

1. In the Firebase console: **Project settings → Service accounts → Generate
   new private key**. You get a JSON file.
2. On Render, add an environment variable:

   | Name | Value |
   | --- | --- |
   | `FCM_SERVICE_ACCOUNT` | the **entire contents** of that JSON file, pasted as one line |

   Paste the whole thing including the braces. The private key contains `\n`
   escapes — leave them exactly as they are.

3. Redeploy. `GET /api/push/capabilities` should then report
   `{"web":true,"native":true}`.

Do not commit either file. The service account can send notifications to every
user of your app.

### 3. Rebuild and test

Run `Build-Android.bat` again, install the APK, sign in, and have someone
message you with the app closed. You should get a notification with the Nook
sound rather than the system default.

## The notification sound

Android ties the sound to the **channel**, not the message, and channel
settings are frozen when the channel is created — deliberately, so an app
cannot make itself louder after you have turned it down.

Two channels are created on first launch (`client/src/lib/native.ts`):

| Channel | Sound | Used for |
| --- | --- | --- |
| `messages` | `nook_message.wav` | Ordinary messages |
| `calls` | `nook_call.wav` | Incoming calls |

The sounds live in `client/android/app/src/main/res/raw/` and are the same
two-note figure the web app plays, generated rather than sourced so the recipe
stays readable.

**To change a sound you must change the channel id too** — for example
`messages` to `messages_v2` — and update it in both `native.ts` and
`services/fcm.js`. Replacing the file alone does nothing on a phone that has
already created the channel, which is a confusing hour if you do not know it.

## Signing a release

The debug APK is fine for testing but Android marks it as a debug build, and
you cannot update an app signed with a different key later.

```powershell
keytool -genkey -v -keystore nook-release.keystore -alias nook `
        -keyalg RSA -keysize 2048 -validity 10000
```

Then create `client/android/keystore.properties`:

```properties
storeFile=../../nook-release.keystore
storePassword=whatever you chose
keyAlias=nook
keyPassword=whatever you chose
```

`Build-Android.bat` notices the file and builds a signed release APK.

**Keep the keystore.** Lose it and you can never update an installed app —
users would have to uninstall and reinstall, losing nothing but being annoyed.
Leak it and someone else can publish updates as you.

## Publishing the APK

The download page at `/download` links to:

```
https://github.com/Niranjan266/Nook/releases/latest/download/nook.apk
```

So: create a GitHub release, attach the file **named exactly `nook.apk`**, and
the page serves the newest one with no code change. This keeps a 5 MB binary
out of the repository on every release, which git history does not forgive.

## What is not here

**iOS.** Capacitor supports it and the same web app would run, but it needs a
Mac to build and a $99/year Apple developer account to install on any device
that is not your own. The PWA works on iOS in the meantime — Safari supports
Add to Home Screen and, since iOS 16.4, web push.

**The old Expo app** in `mobile/` predates friend requests, the chat lock, the
snap camera and the current emoji picker. It is left in place rather than
deleted, but it is not built or maintained, and it is not what `/download`
serves.
