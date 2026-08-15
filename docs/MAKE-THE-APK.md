# Making the APK — step by step

Follow this top to bottom the first time. After that, only **Part 2** matters.

Times are honest: the first build is slow because Gradle downloads roughly
200 MB of tooling. Later builds take a minute or two.

| Part | What it gets you | Time |
| --- | --- | --- |
| [1. Check the tools](#part-1--check-the-tools) | Confirm you can build at all | 2 min |
| [2. Build the APK](#part-2--build-the-apk) | `nook.apk` on your disk | 10–20 min first time |
| [3. Put it on your phone](#part-3--put-it-on-your-phone) | Nook installed, working | 3 min |
| [4. Publish it](#part-4--publish-it) | The download page serves it | 5 min |
| [5. Turn on notifications](#part-5--turn-on-notifications-firebase) | Alerts on a locked phone | 20 min |
| [6. Sign it properly](#part-6--sign-it-properly-before-real-users) | Updatable, not a debug build | 10 min |

---

## Part 1 — Check the tools

You need two things: a **JDK** (to run Gradle) and the **Android SDK** (to
compile). Android Studio installs both, which is why it is the recommended
route even though you will never open it.

**On your machine both are already there.** I checked:

```
Android Studio JDK : FOUND    (C:\Program Files\Android\Android Studio\jbr)
Android SDK        : FOUND    (%LOCALAPPDATA%\Android\Sdk)
GitHub CLI (gh)    : not installed   ← only needed for Part 4
```

So you can skip to Part 2.

<details>
<summary>If you are setting this up on a different machine</summary>

1. Install [Android Studio](https://developer.android.com/studio) — the
   default options are fine.
2. **Open it once** and let it finish "Downloading Components". This is the
   step that installs the SDK; skipping it is the most common reason the build
   fails later with `SDK location not found`.
3. Close it. You will not need it again.

You do **not** need to set `JAVA_HOME` — `Build-Android.bat` finds the JDK
inside Android Studio on its own.

</details>

---

## Part 2 — Build the APK

**Double-click `Build-Android.bat`** in the project folder.

That is the whole step. It runs four things and tells you which one it is on:

```
[1/4] Installing dependencies...
[2/4] Building the web app...
[3/4] Syncing it into the Android project...
[4/4] Building the APK...   (the first run downloads Gradle - be patient)
```

**Step 4 will look frozen for several minutes on the first run.** It is
downloading Gradle and the Android build tools. Leave it. On later runs it
takes about a minute.

When it finishes you get:

```
------------------------------------------
  Built: C:\Users\niran\Documents\Niranjan\chat app\nook.apk
------------------------------------------
```

### If it fails

| What you see | What it means | Fix |
| --- | --- | --- |
| `SDK location not found` | Android Studio was installed but never opened | Open Android Studio once, let it download components, close it, retry |
| `Failed to install the following SDK components` / licence errors | SDK licences were never accepted | Run `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat --licenses` and press `y` to each |
| Hangs at "Downloading Gradle" | Slow or blocked connection | It really is ~200 MB. If it fails, run it again — it resumes |
| `Unsupported class file major version` | Gradle picked up an old Java | Close the window, check `java -version` is 17+, or unset `JAVA_HOME` so the script uses Android Studio's |
| `npm ERR!` in step 1 or 2 | Dependency problem, unrelated to Android | Delete `client\node_modules` and run again |

---

## Part 3 — Put it on your phone

The quickest way, without publishing anything:

1. Copy `nook.apk` to your phone — USB cable, Google Drive, or email it to
   yourself.
2. Tap the file on the phone.
3. Android says it **cannot install from this source**. Tap **Settings**,
   turn on the permission for whichever app you used (Files, Drive, Chrome),
   then press back.
4. Tap **Install**, then **Open**.
5. Sign in as normal.

You should get Nook full-screen with no address bar, an icon on your home
screen, and a back button that closes sheets rather than the app.

> **`INSTALL_FAILED_UPDATE_INCOMPATIBLE`**
> You already have a Nook built with a different signing key — a debug build
> when you now have a release one, or vice versa. Uninstall the old one first.
> Android refuses to replace an app with one signed differently, deliberately:
> it is what stops someone shipping a fake update.

At this point notifications only appear **while the app is open**. Part 5 is
what fixes that.

---

## Part 4 — Publish it

The download page at <https://nook.niranjand.in/download> reads the newest
GitHub release. Until one exists it honestly says *"Not published yet"* rather
than offering a button that 404s.

### The easy way

Install the [GitHub CLI](https://cli.github.com), then once:

```powershell
gh auth login
```

After that, `Build-Android.bat` publishes automatically every time it builds —
it creates the release, tags it from the version in `client/package.json`, and
replaces the APK if that release already exists.

### By hand

1. Go to <https://github.com/Niranjan266/Nook/releases/new>
2. **Tag**: `v1.0.0` (click "Create new tag on publish")
3. **Title**: `Nook v1.0.0`
4. Drag `nook.apk` into the attachments box.
   **The filename must be exactly `nook.apk`.**
5. Click **Publish release**.

Refresh the download page. The button turns live and shows the real size,
version and date — **no redeploy needed**, it reads GitHub directly.

---

## Part 5 — Turn on notifications (Firebase)

**Nothing else in the app needs this, and everything else already works.**
Skip it if you just want to try the app.

### Why it is needed at all

Web Push does not exist inside an Android WebView. The browser's notification
subscription cannot be used by the app, so Android apps use Firebase Cloud
Messaging — and FCM needs a project only you can create.

Until this is done: the APK notifies while open, and **the installed PWA in
Chrome keeps notifying normally**. Nobody loses anything by waiting.

### 5a — Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Create a project**.
2. Name it anything. **Turn Google Analytics off** — it is not used.
3. On the project overview, click the **Android** icon.
4. **Android package name** — this must be character-for-character:

   ```
   in.niranjand.nook
   ```

   Getting this wrong is the number one reason push silently never arrives.
   Leave the nickname and SHA-1 fields empty.
5. Click **Register app**, then **Download `google-services.json`**.
6. Put that file at exactly:

   ```
   client\android\app\google-services.json
   ```

   Not in `client\android\`. Not in the project root. In `app`.
7. Skip the remaining "add the SDK" steps — Capacitor already does all of it.

The file is gitignored. The build detects it and switches push on; with no
file the build still succeeds and simply has no push.

### 5b — Let the server send

1. Firebase console → **⚙ Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**. A `.json` file
   downloads.
3. Open it in Notepad and copy **everything**, braces included.
4. Go to your Render dashboard → the Nook service → **Environment**.
5. Add:

   | Key | Value |
   | --- | --- |
   | `FCM_SERVICE_ACCOUNT` | the entire JSON, pasted as one value |

   Paste it exactly. The private key inside contains `\n` sequences — leave
   them alone, do not turn them into real line breaks.
6. **Save**. Render redeploys on its own.

Check it worked — open this in a browser:

```
https://nook-api.niranjand.in/api/push/capabilities
```

You want:

```json
{ "web": true, "native": true }
```

If `native` is still `false`, the variable did not parse. The server logs one
line saying so.

### 5c — Rebuild and test

Run `Build-Android.bat` again, reinstall, sign in, then **close the app
completely** and have someone message you.

You should get a notification with the Nook sound, not the Android default.

> Never commit either Firebase file. The service account can send a
> notification to every user of your app.

---

## Part 6 — Sign it properly (before real users)

Everything above produces a **debug** APK. It installs and runs, but:

- Android marks it as a debug build;
- you cannot later update it with a release build without uninstalling.

Do this once, before anyone else installs Nook.

### Create a key

**Double-click `Make-Signing-Key.bat`.**

It finds `keytool` inside Android Studio, asks you to choose a password, and
writes both the key and the config the build needs.

You will be asked for the password **three times**: twice by keytool (to
confirm it) and once more so the build can use the key without prompting on
every run. It is never shown on screen and never stored anywhere but
`keystore.properties`, which is gitignored.

keytool also asks for a name, city and organisation. None of it is shown to
anyone — press Enter to skip any of them.

**Write the password down before you start.** There is no way to recover it,
and without it the key is useless.

If a keystore already exists the script refuses to replace it unless you type
`REPLACE`, because overwriting one you have already published with is the
mistake that cannot be undone.

<details>
<summary>Doing it by hand instead</summary>

```powershell
& "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe" `
  -genkeypair -v -keystore nook-release.keystore -alias nook `
  -keyalg RSA -keysize 2048 -validity 10000
```

Then create `client\android\keystore.properties`:

```properties
storeFile=../../nook-release.keystore
storePassword=the password you chose
keyAlias=nook
keyPassword=the same password
```

The path is read relative to `client\android\`, which is why `../../` lands
on the project root where the key was just created.

</details>

> Without `keystore.properties` the script builds a **debug** APK on purpose.
> A release build with no signing config produces an *unsigned* APK: it builds
> happily, reports success, and then Android refuses to install it with a
> message that never mentions signing — at the end of a long build, on a
> different machine from the mistake.

> ### Back up `nook-release.keystore`
>
> Lose it and you can **never** update an installed Nook — every user would
> have to uninstall and reinstall. Leak it and someone else can publish
> updates that look like they came from you.
>
> Keep a copy somewhere that is not this computer. It is gitignored, so it is
> not in your repository.

---

## Updating the app later

Most changes need no APK at all. The app loads the live site, so **a normal
deploy reaches every phone immediately** — new features, fixes, styling, all
of it.

You only need a new APK when you change something native:

- the notification sound or channels
- app permissions or the icon
- the Capacitor config
- a Capacitor plugin

When you do:

1. Bump `version` in `client/package.json` (e.g. `1.0.0` → `1.0.1`).
2. Bump **both** in `client/android/app/build.gradle`:

   ```gradle
   versionCode 2          // must increase every release
   versionName "1.0.1"    // what people see
   ```

   Android refuses to install an APK whose `versionCode` is not higher than
   the installed one, so forgetting this looks like the update "not working".
3. Run `Build-Android.bat`.

### Changing the notification sound

Android freezes a channel's settings when it is created — deliberately, so an
app cannot make itself louder after you have turned it down. Replacing the
`.wav` alone does nothing on a phone that has already run Nook.

To actually change it you must also change the **channel id**, in both places:

- `client/src/lib/native.ts` — `id: 'messages'` → `id: 'messages_v2'`
- `server/src/services/fcm.js` — the `channel_id` in the payload

Then rebuild. The old channel lingers in Android's settings until reinstall,
which is harmless.

---

## Quick reference

```
Make the signing key    Make-Signing-Key.bat   (once, before real users)
Build it                Build-Android.bat
Result                  nook.apk  (project root)
Package name            in.niranjand.nook
Minimum Android         5.1  (API 22)
Download page           https://nook.niranjand.in/download
Release must be named   nook.apk
Firebase file           client\android\app\google-services.json
Server variable         FCM_SERVICE_ACCOUNT   (on Render)
Check push is on        https://nook-api.niranjand.in/api/push/capabilities
```

Architecture and the reasoning behind it: [`ANDROID.md`](ANDROID.md).
