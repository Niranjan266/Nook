# Nook — every key and token you need

> **Never paste a secret into a chat, a commit, or a screenshot.**
> Every value below goes straight into a provider's dashboard. If one ever leaks, rotate it — all of these can be regenerated in a couple of clicks.

---

## The short version

You need accounts with **two** services to run Nook at all:

1. **Turso** — the database
2. **Render** — the API host (Vercel can't run it; see below)

Everything else is optional and degrades gracefully. You can be live on a free tier with just those two.

---

## Why two hosts

Vercel functions are serverless — they start per request and stop. Socket.IO needs a connection held open for as long as the app is on screen. There is no Vercel setting that changes this.

```
  Browser ──── https ────►  Vercel        (the app: static files, CDN)
     │
     └─────── wss/https ──►  Render        (the API: Node + Socket.IO)
                                │
                                ├──────►  Turso        (database)
                                ├──────►  Cloudinary   (media, optional)
                                └──────►  Brevo        (email, optional)
```

---

## 1. Turso — database (required)

**Free tier:** 500 databases, 9 GB storage, 1 billion row reads/month. Comfortably free for this.

1. Sign up at [turso.tech](https://turso.tech).
2. Install the CLI and create a database:
   ```bash
   # macOS / Linux
   curl -sSfL https://get.tur.so/install.sh | bash
   # Windows: use WSL, or create the DB in the web dashboard instead

   turso auth login
   turso db create nook
   turso db show nook --url          # → libsql://nook-you.turso.io
   turso db tokens create nook       # → a long eyJ... token
   ```
   Or do all of it in the dashboard: **Databases → Create Database**, then **Edit → Generate Token**.

| Variable | Looks like | Notes |
|---|---|---|
| `TURSO_DATABASE_URL` | `libsql://nook-you.turso.io` | Not `https://` — the `libsql://` scheme |
| `TURSO_AUTH_TOKEN` | `eyJhbGciOi...` (very long) | Treat as a password. Full read/write. |

**Local development needs neither.** Leave both empty and the server writes to `server/data/nook.db`, a plain SQLite file. Real data that survives restarts, no signup, no network.

---

## 2. Render — API host (required)

**Free tier works, with two real caveats** (below). No key to create — you connect GitHub.

Render generates these two for you. Don't change them; changing either signs everyone out.

| Variable | Source |
|---|---|
| `JWT_ACCESS_SECRET` | Render generates |
| `JWT_REFRESH_SECRET` | Render generates |

If you host somewhere else, generate them yourself:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run it twice. They must be different.

**Free plan caveats, plainly:**
- Sleeps after 15 minutes idle. Sleeping drops every open socket, so real-time messaging stops until someone opens the app (~30s cold start).
- No persistent disk, so locally-stored media is wiped on each deploy. Use Cloudinary, or upgrade.

$7/month removes both. It's the only upgrade I'd make before showing Nook to anyone.

---

## 3. The four URLs

Not secrets, but nothing works without them.

| Variable | Where | Value | If it's wrong |
|---|---|---|---|
| `CLIENT_ORIGIN` | Render | `https://app.yoursite.com` | Every API call blocked by CORS |
| `PUBLIC_URL` | Render | `https://api.yoursite.com` | Uploaded photos 404 |
| `COOKIE_DOMAIN` | Render | `.yoursite.com` ← **leading dot** | Signed out on every reload in Safari |
| `VITE_API_URL` | Vercel | `https://api.yoursite.com` | App can't reach the API at all |

`VITE_API_URL` is compiled into the JavaScript at build time, so changing it needs a **redeploy**, not just a save.

### Why `COOKIE_DOMAIN` matters more than it looks

Nook keeps you signed in with a refresh cookie. On unrelated domains (`nook.vercel.app` + `nook-api.onrender.com`) that cookie is *third-party* — Safari blocks those today, Chrome is phasing them out. People would be silently signed out on every reload.

Put both on subdomains of one domain and set `COOKIE_DOMAIN=.yoursite.com`, and the cookie is first-party. Verified: it's issued as `SameSite=Lax; Secure; Domain=.yoursite.com`.

---

## 4. Optional keys

Each of these is genuinely optional — the feature degrades, nothing crashes.

### Cloudinary — media

**On Render's free plan, treat this as required.** There's no persistent disk, so photos are deleted on every deploy without it.

Sign up at [cloudinary.com](https://cloudinary.com) → **Dashboard → Account Details**.

| Variable | Notes |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Public, appears in URLs |
| `CLOUDINARY_API_KEY` | Public-ish |
| `CLOUDINARY_API_SECRET` | **Secret.** Never in a `VITE_` variable. |

Without it: media goes to `server/uploads` on local disk. Fine on a VPS or Docker with a volume; fatal on Render free.

### VAPID — push notifications

No account needed. Generate once and keep:
```bash
npx web-push generate-vapid-keys
```

| Variable | Notes |
|---|---|
| `VAPID_PUBLIC_KEY` | Sent to browsers |
| `VAPID_PRIVATE_KEY` | **Secret** |
| `VAPID_SUBJECT` | `mailto:you@yoursite.com` |

Without them: push still works, but the server generates a fresh keypair on every restart, which invalidates every existing subscription. People quietly stop getting notifications. Worth the two minutes.

### Brevo — email

Only used for password recovery. Nook accounts are username + password, so email is genuinely optional.

[brevo.com](https://www.brevo.com) → **SMTP & API → API Keys**.

| Variable | Notes |
|---|---|
| `BREVO_API_KEY` | Starts `xkeysib-`. **Secret.** |
| `BREVO_SENDER_EMAIL` | Must be a **verified sender** in Brevo or delivery silently fails |
| `BREVO_SENDER_NAME` | e.g. `Nook` |

Without it: recovery codes print to the server log. Fine in development, not much use in production.

### TURN — calls behind strict networks

Free: [Metered Open Relay](https://www.metered.ca/tools/openrelay/). Paid: Twilio, Cloudflare Calls.

| Variable | Example |
|---|---|
| `TURN_URL` | `turn:standard.relay.metered.ca:80` |
| `TURN_USERNAME` | from the provider |
| `TURN_CREDENTIAL` | **Secret** |

Without it: STUN alone connects roughly 80% of calls. The other 20% — anyone behind a symmetric NAT, which includes a lot of mobile networks — will ring and never connect.

### Redis — only for multiple instances

| Variable | When |
|---|---|
| `REDIS_URL` | Only if you run more than one API instance. Without it, two instances can't see each other's sockets. |

### Preview builds

| Variable | Value |
|---|---|
| `ALLOW_VERCEL_PREVIEWS` | `1` while testing Vercel preview URLs, `0` in production |

---

## 5. Complete checklist

**Render** (Environment tab):

```
TURSO_DATABASE_URL      libsql://nook-you.turso.io      ← required
TURSO_AUTH_TOKEN        eyJhbGciOi...                   ← required
CLIENT_ORIGIN           https://app.yoursite.com        ← required
PUBLIC_URL              https://api.yoursite.com        ← required
COOKIE_DOMAIN           .yoursite.com                   ← required
NODE_ENV                production
JWT_ACCESS_SECRET       (Render generates)
JWT_REFRESH_SECRET      (Render generates)

CLOUDINARY_CLOUD_NAME   (optional — required on Render free)
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
VAPID_PUBLIC_KEY        (optional, recommended)
VAPID_PRIVATE_KEY
VAPID_SUBJECT           mailto:you@yoursite.com
BREVO_API_KEY           (optional)
BREVO_SENDER_EMAIL
TURN_URL                (optional, recommended)
TURN_USERNAME
TURN_CREDENTIAL
ALLOW_VERCEL_PREVIEWS   0
```

**Vercel** (Settings → Environment Variables):

```
VITE_API_URL            https://api.yoursite.com        ← required
```

That's it. One variable.

---

## 6. Deploying to Vercel, step by step

### Before you start
Push the repo to GitHub. Vercel deploys from a repository, not from your hard drive.

### The steps

1. **vercel.com → Add New → Project** → import the repo.

2. **Root Directory: `client`**
   The single most common mistake. Click **Edit** next to Root Directory and set it to `client`. Vercel otherwise looks at the repo root, finds no app, and fails.

3. **Framework Preset:** Vite (auto-detected). Leave build settings alone — `client/vercel.json` sets them.

4. **Environment Variables:** add `VITE_API_URL` = your Render URL, no trailing slash.
   You may not know it yet — that's fine. Deploy the API first, or come back and redeploy.

5. **Deploy.** ~1 minute.

6. **Add your domain:** Project → Settings → Domains → `app.yoursite.com`. Vercel shows the CNAME to add at your registrar.

7. **Point the API at it:** on Render, set `CLIENT_ORIGIN=https://app.yoursite.com`, and add `api.yoursite.com` as a custom domain there too.

8. **Redeploy the frontend** so `VITE_API_URL` is baked in. Deployments → ⋯ → Redeploy.

### Then check these five things

1. `https://api.yoursite.com/api/health` returns `{"ok":true,...}`
2. Sign up, send yourself a message
3. **Reload the page** — still signed in? Cookies are right. Thrown out? `COOKIE_DOMAIN` or `CLIENT_ORIGIN` is wrong.
4. Second browser, incognito, another account, message between them. Instant? Sockets are fine. Needs a refresh? CORS — check the console for the blocked origin.
5. Send a photo, hard-reload. 404? `PUBLIC_URL` is missing.

---

## 7. When it goes wrong

| Symptom | Cause |
|---|---|
| Vercel build fails immediately | Root Directory isn't `client` |
| Blank page, console CORS error | `CLIENT_ORIGIN` doesn't match your Vercel URL exactly, scheme included |
| Signed out on every reload | Cookie is cross-site — set `COOKIE_DOMAIN`, use subdomains |
| Messages need a refresh | Socket blocked, or the free instance is asleep |
| Photos 404 after deploy | `PUBLIC_URL` missing, or Render free wiped the disk — use Cloudinary |
| First load takes 30 seconds | Free instance cold start. Expected. |
| Calls ring, never connect | Add TURN |
| `SQLITE_UNKNOWN: unauthorized` | `TURSO_AUTH_TOKEN` is wrong or expired — regenerate it |
| Notifications stopped working | VAPID keys weren't set, so they rotated on restart |

---

## 8. What it costs

| | Free | Recommended |
|---|---|---|
| Vercel | Hobby — fine | Hobby |
| Render | Free (sleeps, no disk) | Starter $7/mo |
| Turso | Free — genuinely generous | Free |
| Cloudinary | Free 25 GB | Free |
| TURN | Open Relay free | Free |
| **Total** | **₹0** | **~₹600/month** |
