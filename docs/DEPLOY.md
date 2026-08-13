# Deploying Nook — Vercel + Render

## ⚠️ Don't send me your keys

**Do not paste any API key, secret or password into this chat.** I've built everything to read from environment variables, so you type each secret straight into the Vercel or Render dashboard yourself and it never passes through a conversation, a file, or the repository. If a key does end up somewhere it shouldn't, rotate it — every provider below lets you do that in a couple of clicks.

---

## The one thing to understand first

**Vercel cannot run the Nook API.** Vercel functions are serverless: they spin up per request and shut down. Socket.IO needs a connection that stays open for as long as the app is on screen. There's no configuration that fixes this.

So Nook deploys as two pieces:

| Piece | Host | Why |
|---|---|---|
| Frontend (`client/`) | **Vercel** | Static files on a CDN — exactly what Vercel is best at |
| API (`server/`) | **Render** | Long-lived Node process that can hold WebSockets open |

Everything below assumes that split. It's already wired — the client reads `VITE_API_URL`, the socket connects straight to the API host, and uploaded media URLs come back absolute.

---

## Step 1 — Turso (free)

1. Sign up at [turso.tech](https://turso.tech).
2. Create a database and a token — CLI or dashboard, either works:
   ```bash
   turso db create nook
   turso db show nook --url      # → libsql://nook-you.turso.io
   turso db tokens create nook   # → a long eyJ... token
   ```
   In the dashboard: **Databases → Create Database**, then **Edit → Generate Token**.
3. Note both values. The schema builds itself on first boot — there is no migration step to run.

| Variable | Looks like |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://nook-you.turso.io` — the `libsql://` scheme, not `https://` |
| `TURSO_AUTH_TOKEN` | `eyJhbGciOi...` — treat as a password, it has full read/write |

**This is the only thing genuinely required.** Everything else has a working fallback.

> Locally you need neither. Leave both empty and the server writes to `server/data/nook.db`, a plain SQLite file that survives restarts.

---

## Step 2 — the API on Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. It reads `render.yaml` at the root.
3. Render generates `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` for you. Leave them alone — changing them signs everyone out.
4. Fill in the variables marked "you fill these" (table below).
5. Deploy. When it's live, check `https://your-api.onrender.com/api/health` returns `{"ok":true,...}`.

**Free plan, honestly:** it sleeps after 15 minutes idle. Sleeping drops every open socket, so real-time messaging stops until someone loads the app and wakes it (~30s). There's also no persistent disk, so uploaded media is wiped on each deploy unless you use Cloudinary. The $7/mo Starter plan removes both problems, and it's the difference between a demo and something you'd hand to a friend.

---

## Step 3 — the frontend on Vercel

1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory: `client`** ← easy to miss, and nothing works without it.
3. Framework preset: **Vite** (auto-detected). `client/vercel.json` handles the rest.
4. Add one environment variable:
   ```
   VITE_API_URL = https://your-api.onrender.com
   ```
   No trailing slash. This is **baked in at build time**, so changing it later means redeploying, not just saving.
5. Deploy.

---

## Step 4 — domains, and why they matter more than they look

You chose the subdomain setup, which is the right call. Point:

- `app.yoursite.com` → Vercel (Project → Settings → Domains)
- `api.yoursite.com` → Render (Service → Settings → Custom Domain)

Then set `COOKIE_DOMAIN=.yoursite.com` on Render — **with the leading dot**.

Here's why this isn't cosmetic. Nook keeps you signed in with a refresh cookie. If the app and API are on unrelated domains (`nook.vercel.app` + `nook-api.onrender.com`), that cookie is *third-party*. Safari blocks those already and Chrome is phasing them out — so people would be silently signed out every time they reloaded the page. With both on subdomains of one domain, the cookie is first-party and nothing blocks it.

I verified the logic: with `COOKIE_DOMAIN` set, the cookie is issued as `SameSite=Lax; Secure; Domain=.yoursite.com`. Without it, the code falls back to `SameSite=None`, which works today but is exactly what browsers are removing.

Once your domains are live, update:
- Render: `CLIENT_ORIGIN=https://app.yoursite.com`, `PUBLIC_URL=https://api.yoursite.com`
- Vercel: `VITE_API_URL=https://api.yoursite.com`, then redeploy.

---

## The keys, exactly

### Required — Render

| Variable | Where it comes from | What breaks without it |
|---|---|---|
| `TURSO_DATABASE_URL` | Turso → your database → URL | Nothing works. This is the one hard requirement. |
| `TURSO_AUTH_TOKEN` | Turso → Edit → Generate Token | Nothing works. |
| `CLIENT_ORIGIN` | Your Vercel URL | Every API call is blocked by CORS |
| `PUBLIC_URL` | Your Render URL | Uploaded photos 404 (they'd be looked for on Vercel) |
| `COOKIE_DOMAIN` | `.yoursite.com` | People get signed out on refresh in Safari |
| `JWT_ACCESS_SECRET` | Render generates it | — |
| `JWT_REFRESH_SECRET` | Render generates it | — |

### Required — Vercel

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.yoursite.com` |

### Optional — add when you want the feature

| Variable | From | Without it |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME`<br>`CLOUDINARY_API_KEY`<br>`CLOUDINARY_API_SECRET` | cloudinary.com → Dashboard → Account Details | Media saves to local disk. **On Render's free plan that means it's deleted on every deploy** — so on free, treat this as required. |
| `BREVO_API_KEY`<br>`BREVO_SENDER_EMAIL` | brevo.com → SMTP & API → API Keys | Password-recovery codes print to the server log instead of being emailed. Everything else is unaffected — Nook only needs a username. The sender address must be a *verified sender* in Brevo or delivery silently fails. |
| `VAPID_PUBLIC_KEY`<br>`VAPID_PRIVATE_KEY`<br>`VAPID_SUBJECT` | Generate them: `npx web-push generate-vapid-keys` | Push still works, but a new keypair is made on every restart, so existing subscriptions break and people stop getting notifications. Worth setting. `VAPID_SUBJECT` is `mailto:you@yoursite.com`. |
| `TURN_URL`<br>`TURN_USERNAME`<br>`TURN_CREDENTIAL` | [Metered Open Relay](https://www.metered.ca/tools/openrelay/) (free) or Twilio | Calls fail to connect for roughly 20% of people — those behind strict NATs. STUN alone handles the rest. |
| `REDIS_URL` | Render → New → Redis | Only matters if you run more than one API instance. |
| `ALLOW_VERCEL_PREVIEWS` | `1` while testing | Vercel preview deployments get a new subdomain per commit; without this they're blocked by CORS. Set back to `0` for production. |

**Never** put a secret in a `VITE_`-prefixed variable. Vite bakes those into the JavaScript bundle, where anyone can read them in devtools.

---

## Step 5 — check it actually works

1. `https://api.yoursite.com/api/health` → `{"ok":true,"media":"cloudinary"|"local-disk",...}`
2. Open the app, create an account, send yourself a message.
3. **Reload the page.** If you're still signed in, cookies are right. If you're thrown back to the sign-in screen, `COOKIE_DOMAIN` or `CLIENT_ORIGIN` is wrong.
4. Open a second browser (incognito), sign in as someone else, and message between them. If messages only appear after a refresh, the socket isn't connecting — check the browser console for a CORS error naming your origin.
5. Send a photo, then hard-reload. If it 404s, `PUBLIC_URL` is wrong or missing.

---

## When something's wrong

| Symptom | Cause |
|---|---|
| Blank page, console shows CORS | `CLIENT_ORIGIN` doesn't exactly match your Vercel URL (scheme included) |
| Signed out on every reload | Cookie is cross-site — set `COOKIE_DOMAIN` and use subdomains |
| Messages need a refresh to appear | Socket blocked. Free instance may be asleep; otherwise check CORS |
| Photos 404 after deploying | `PUBLIC_URL` missing, or Render free plan wiped the disk — use Cloudinary |
| First request takes 30 seconds | Free instance cold start. Expected |
| Calls ring but never connect | You need TURN |
| `SQLITE_UNKNOWN: unauthorized` | `TURSO_AUTH_TOKEN` is wrong or expired — regenerate it |
| Vercel build fails on esbuild | npm 11 blocked a postinstall — Vercel usually handles this; if not, set install command to `npm install --no-audit --no-fund` |

---

## What this costs

**Free:** Vercel Hobby + Render Free + Turso free tier + Cloudinary free tier + Open Relay TURN. Real cost ₹0, with the caveat that the API sleeps.

**Roughly ₹600/month:** Render Starter ($7) removes sleeping and adds a persistent disk. That's the only upgrade I'd make before showing this to anyone.
