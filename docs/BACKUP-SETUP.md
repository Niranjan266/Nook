# Chat backups — setup

Backups to a **file** need nothing: they are built, sealed and saved entirely
on the device. This page is for backups to **Google Drive**, which reuse the
Google project and OAuth client you already made for
[Sign in with Google](GOOGLE-LOGIN-SETUP.md). Ten minutes.

Until the steps below are done, Settings → Backup & restore simply offers files
only — there is never a Drive button that leads nowhere.

---

## What Nook stores, and what it can see

- The backup is compressed and encrypted **on the device** (AES-256-GCM, key
  from the person's backup password via PBKDF2-SHA256, 600,000 iterations).
  The password never leaves the device. The server and Google only ever hold
  the sealed `.nookbak` file.
- Files go to Drive's hidden **app data folder** (`drive.appdata` scope). Nook
  cannot see, list or touch anything else in the person's Drive, and the
  consent screen says so. The newest five backups are kept; older ones are
  deleted automatically.
- The server stores one row per connected account in `drive_links`: the Drive
  **refresh token, encrypted** with `BACKUP_TOKEN_KEY` and bound to the user id.
  Disconnecting deletes the row and revokes the token at Google.

---

## Step 1 · Enable the Google Drive API

1. [console.cloud.google.com](https://console.cloud.google.com) → select the
   **same project** that holds the `nook-login` OAuth client
2. **APIs & Services → Library**
3. Search **Google Drive API** → open it → **Enable**

> Skipping this is the usual cause of backups failing after a successful
> connect: consent works, then every upload comes back 403 *"Google Drive API
> has not been used in project … or it is disabled"*.

## Step 2 · Add the scope to the consent screen

1. **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth
   Platform → Data access**)
2. **Add or remove scopes**
3. Paste into *Manually add scopes*:

```
https://www.googleapis.com/auth/drive.appdata
```

4. **Add to table → Update → Save**

`drive.appdata` is a **non-sensitive** scope, so — like sign-in — it needs no
Google verification. A published app keeps working for everyone; while the
screen is still in **Testing**, only listed test users can connect.

## Step 3 · Add the redirect URI to the existing client

1. **APIs & Services → Credentials** → open the existing **`nook-login`** OAuth
   client (Web application) — do not create a new one
2. **Authorised redirect URIs → Add URI**, and add:

```
https://nook-api.niranjand.in/api/backup/drive/callback
```

   plus, if you still use them:

```
https://nook-api-6djz.onrender.com/api/backup/drive/callback
http://localhost:4000/api/backup/drive/callback
```

3. **Save.** Changes can take a few minutes to apply.

> Exact match, as with sign-in: scheme, host, path, no trailing slash. A typo
> shows up as `redirect_uri_mismatch` on Google's page, never as a Nook error.

## Step 4 · Set `BACKUP_TOKEN_KEY`

**Render → `nook-api` → Environment → Add:**

| Key | Value |
|---|---|
| `BACKUP_TOKEN_KEY` | a long random string — e.g. the output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Locally, the same in `server/.env`. `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are already set from sign-in and are reused.

If it is left empty the server derives a key from `JWT_REFRESH_SECRET` (HKDF,
separate purpose label) and prints a notice at boot — it works, but a dedicated
key means rotating the session secret does not also disconnect everyone's Drive.

> **Changing `BACKUP_TOKEN_KEY` later disconnects every Drive link.** Nothing
> is lost — the backups stay in each person's Drive — but everyone has to tap
> *Connect* again. Pick it once.

## Step 5 · Check

```
https://nook-api.niranjand.in/api/health        → ok
```

Then in the app: **Settings → Backup & restore → Google Drive → Connect**. You
should see Google's consent screen asking to *"See, create, and delete its own
configuration data in your Google Drive"*, then land back in Nook with
*"Google Drive connected"*. In the Android app the consent opens in a Custom
Tab and returns via `nook://backup` — the same deep link mechanism as sign-in,
so no new Android configuration is needed.

---

## How the flow works

1. The app asks `GET /api/backup/drive/connect?json=1` (authenticated) for the
   consent URL. The `state` carries the user id, signed and valid for ten
   minutes.
2. Google redirects to `/api/backup/drive/callback`. The server checks the
   state, redeems the code (`access_type=offline`, `prompt=consent`, so a
   refresh token comes back), confirms `drive.appdata` was granted, seals the
   refresh token and stores it.
3. It redirects to `APP_URL/?drive=connected` on the web, or
   `nook://backup?drive=connected` in the Android app.
4. Uploads stream the already-encrypted blob through the server to Drive
   (`POST /api/backup/drive/upload`, 50 MB cap). Restores stream it back
   (`GET /api/backup/drive/:fileId`) and are decrypted on the device.
5. If Google reports `invalid_grant` — the person revoked access in their
   Google account, or the token expired unused — the link is deleted and the
   app asks them to connect again.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` on Google's page | Step 3 — the URI differs by a character |
| "Access blocked … has not completed verification" | Consent screen still in Testing; add yourself as a test user or publish |
| Connects, then uploads fail with *Google Drive did not accept the backup* | Step 1 — Drive API not enabled |
| *Nook needs permission for its own Drive folder* | The person unticked the Drive box on the consent screen |
| Everyone suddenly shows *Connect* again | `BACKUP_TOKEN_KEY` (or, if unset, `JWT_REFRESH_SECRET`) changed |
