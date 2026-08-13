# Go live — the checklist

Tick these in order. About 30 minutes, ₹0 to start, nothing sleeping.

`DEPLOY.md` explains the *why* behind each step. This is the *do*.

---

## Before you start: generate your secrets

Double-click **`Make-Keys.bat`**. It creates your JWT secrets and VAPID push keys **on your own machine** using Node's crypto library, writes them to `MY-KEYS.txt`, and opens it. That file is git-ignored, so it can't be committed by accident.

You'll paste those values into the dashboards below, then delete the file. Nothing secret ever needs to travel through a chat, an email or a commit.

---

## Where each piece goes

```
  nook.niranjand.in      →  Vercel      the web app (static files)
  nook-api.niranjand.in  →  Render      the API (Node + Socket.IO) — free, no card
                         →  Turso       the database
```

**Vercel cannot host the API.** Its functions are serverless — they start per request and stop. Socket.IO needs a connection held open the whole time the app is on screen. No setting changes that, which is why there are two hosts.

**Both subdomains of `niranjand.in` is exactly right.** The session cookie is set on `.niranjand.in`, which makes it *first-party* for both — so Safari's tracking prevention and Chrome's third-party cookie removal leave it alone, and nobody gets signed out on reload. You get this for free by using two subdomains of a domain you already own.

Custom domains work on Render's **free** plan: two included, with automatic Let's Encrypt certificates. You only need one.

---

## 0 · Push to GitHub — 5 min

The repo is already initialised and committed locally (150 files, nothing sensitive). It just needs a home, because Vercel and Render both deploy *from GitHub*, not from your hard drive.

- [ ] Create an **empty** repo at [github.com/new](https://github.com/new) — no README, no .gitignore, they'd conflict
- [ ] Connect and push:

```bash
cd "C:\Users\niran\Documents\Niranjan\chat app"
git remote add origin https://github.com/YOUR-USERNAME/nook.git
git push -u origin main
```

- [ ] **Private repo** unless you intend it to be public

> Already checked: `.env`, `*.db`, `node_modules/` and `uploads/` are all excluded. The database file contains real password hashes — never commit it.

---

## Why the database has to be Turso, not a file on the server

Render's free instances have an **ephemeral filesystem**. Anything written to
disk is erased on every redeploy, every restart, and every spin-down after 15
idle minutes — and Render explicitly states it may restart a free service at any
time. Persistent disks exist, but only on paid instances.

So a local `nook.db` on Render would not be a database; it would be a cache that
silently empties itself several times a day, taking every account and message
with it. `TURSO_DATABASE_URL` is not optional on this host.

Turso's free tier is 9 GB and 1 billion row reads a month, which this app will
not come close to. Nothing to design or migrate either — the schema builds
itself on first boot.

**And MongoDB is no longer an option regardless of host.** The Turso migration
replaced the entire data layer: schema, four data modules, all nine route files,
the socket layer, scheduler and seed — roughly 2,000 lines, now SQL. Going back
means undoing all of it for no gain, and search would get *worse*: SQLite FTS5
gives ranked prefix matching that the Mongo version never had.

---

## 1 · Turso — 5 min

- [ ] Sign up at [turso.tech](https://turso.tech)
- [ ] **Databases → Create Database**, name it `nook`, pick the region closest to your users (`aws-ap-south-1` for India)
- [ ] Copy the **URL** — starts `libsql://`
- [ ] **Edit → Generate Token**, copy it

Keep both in a password manager. Nothing to design or migrate — the schema builds itself on first boot.

---

## 2 · The API — Render — 10 min

No credit card. `render.yaml` at the repo root already describes the whole
service, so Render fills in the form and simply asks you for the secrets.

- [ ] [render.com](https://render.com) → sign up → connect GitHub
- [ ] **New → Blueprint** → pick the `Nook` repo → **Apply**
- [ ] Render reads `render.yaml`: Docker runtime, `/server/Dockerfile`, free instance, Singapore, health check on `/api/health`
- [ ] It prompts for each `sync: false` variable. Fill in:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | your `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | your token |
| `PUBLIC_URL` | `https://nook-api.onrender.com` — the domain Render just gave you |
| `COOKIE_DOMAIN` | **leave empty for now** (see below) |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | from Cloudinary |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | from `Make-Keys.bat` |
| `BREVO_API_KEY` | optional |
| `TURN_*` | optional |

The two JWT secrets are marked `generateValue: true`, so Render creates them
itself and you never see or handle them. That is strictly safer than pasting.

- [ ] Deploy and wait (~3–4 min the first time — it builds the image)
- [ ] Check `https://nook-api.onrender.com/api/health`

```jsonc
{ "db": "turso", "media": "cloudinary", "push": "configured" }
```

If any of those reads `sqlite-file`, `local-disk` or `ephemeral`, a variable
didn't take. Fix it before going further.

- [ ] In Vercel set `VITE_API_URL` to that same URL, redeploy, and confirm sign-up works

**Then, and only then, move to the custom domain:**

- [ ] **Settings → Custom Domains** → add `nook-api.niranjand.in`
- [ ] Create the `CNAME` Render shows you at BigRock (see §6 — fix the nameservers first)
- [ ] TLS is issued automatically via Let's Encrypt, free instance included
- [ ] Now switch `PUBLIC_URL` → `https://nook-api.niranjand.in` and set `COOKIE_DOMAIN` → `.niranjand.in`
- [ ] Update `VITE_API_URL` in Vercel and redeploy

> **Why `COOKIE_DOMAIN` stays empty until this point.** A server can only set a
> cookie for its own domain. An `onrender.com` host issuing
> `Domain=.niranjand.in` has the cookie thrown away by the browser, and nobody
> can stay signed in. Blank makes `tokens.js` fall back to
> `SameSite=None; Secure`, which is cross-site but works.

### The one thing to know about the free instance

Render spins the service down after **15 minutes with no inbound traffic**, and
the next request takes about a minute to wake it. Inbound traffic includes
WebSocket messages on open connections, so an active conversation keeps itself
alive — the wait is only paid by the first person to open the app after a quiet
spell.

You *can* keep it up permanently with a free pinger (cron-job.org, no card)
hitting `/api/health` every 10 minutes. Do the arithmetic first: Render grants
**750 free instance hours a month**, and a 31-day month is 744 hours. A
permanently-awake service therefore eats almost the whole allowance and leaves
about six hours of margin for the entire workspace — add a second free service
and everything is suspended before month end. Letting it sleep is the safer
default.

Also note: the filesystem is **ephemeral** on free instances, wiped on every
redeploy, restart and spin-down. That is why Turso and Cloudinary are not
optional here — anything written to local disk is already gone.

---

<details>
<summary><b>Using Render instead (click to expand)</b></summary>

- [ ] [render.com](https://render.com) → sign in with GitHub
- [ ] **New → Blueprint** → pick your repo. It reads `render.yaml` automatically.
- [ ] Render generates the two JWT secrets. Leave them alone — changing either signs everyone out.
- [ ] Fill in, under **Environment**:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | your `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | your token |
| `CLIENT_ORIGIN` | `https://nook.niranjand.in` |
| `PUBLIC_URL` | `https://nook-api.niranjand.in` |
| `COOKIE_DOMAIN` | `.niranjand.in` ← **the leading dot matters** |
| `ALLOW_VERCEL_PREVIEWS` | `1` while setting up, `0` after |

- [ ] **Settings → Custom Domain** → add `nook-api.niranjand.in`
- [ ] At your DNS provider, add the **CNAME** Render shows you:
      `nook-api` → `nook-api.onrender.com`
- [ ] Wait for Render to say *Certificate issued* (usually a few minutes)
- [ ] Open `https://nook-api.niranjand.in/api/health` → should return `{"ok":true,…}`

**Two things about Render's free plan, plainly:**
1. It **sleeps after 15 minutes idle** — every socket drops, live messaging stops, ~30s to wake. Add an uptime pinger ([UptimeRobot](https://uptimerobot.com), every 10 min on `/api/health`). Note the free tier gives 750 instance-hours a month and a month is 720–744, so one always-awake service *just* fits with nothing spare.
2. **No persistent disk** — uploaded photos are deleted on every deploy.

</details>

$7/month removes both. It's the one upgrade I'd make before showing this to anyone.

---

## 3 · Cloudinary — 5 min (effectively required on Render free)

- [ ] [cloudinary.com](https://cloudinary.com) → sign up → **Dashboard → Account Details**
- [ ] Add to Render: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- [ ] Redeploy. `/api/health` should now say `"media":"cloudinary"`

Skip only if you're on a paid Render plan with a disk attached.

---

## 4 · Vercel (the web app) — 5 min

- [ ] [vercel.com](https://vercel.com) → **Add New → Project** → import your repo
- [ ] **Root Directory: `client`** ← the single most common mistake. Click *Edit* next to Root Directory and set it.
- [ ] Framework preset: **Vite** (auto-detected). Don't touch the build settings — `client/vercel.json` handles them.
- [ ] Environment Variables → add:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://nook-api.niranjand.in` — no trailing slash |

- [ ] Deploy
- [ ] **Settings → Domains** → add `nook.niranjand.in`
- [ ] At your DNS provider, add the **CNAME** Vercel shows you:
      `nook` → `cname.vercel-dns.com`
- [ ] Once the domain is verified, **redeploy** so `VITE_API_URL` is baked in

`VITE_API_URL` is compiled into the JavaScript at build time, so changing it later means a redeploy — saving the variable alone does nothing.

---

## 5 · Test it — 3 min

- [ ] Open your Vercel URL, create an account, send yourself a message
- [ ] **Reload the page.** Still signed in? Cookies are fine. Kicked out? See step 6.
- [ ] Open an incognito window, make a second account, message between the two — instant, no refresh
- [ ] Send a photo, then hard-reload. Still there?

If all four pass, you're live.

---

## 6 · DNS, both records in one place

At whoever manages `niranjand.in`:

| Type | Name | Value |
|---|---|---|
| CNAME | `nook` | `cname.vercel-dns.com` |
| CNAME | `nook-api` | `nook-api.onrender.com` (Render shows the exact value) |

Copy the exact values each host displays — they differ per account and per region.

**If you use Cloudflare DNS:** set both records to **DNS only** (grey cloud), not proxied. Cloudflare's proxy in front of your API can interfere with WebSocket upgrades, and it also blocks Let's Encrypt from validating the domain — you'd get a certificate stuck "pending" and messages that only appear after a refresh.

Give DNS 5–30 minutes. Then check:

```
https://nook-api.niranjand.in/api/health   → {"ok":true,…}
https://nook.niranjand.in                  → the sign-in screen
```

---

## 7 · Where the free API hosts actually stand (August 2026)

I checked rather than going from memory — this space changes constantly and a lot of the advice online is out of date.

Checked against each provider's own documentation, not listicles — this space
changes constantly and most of the advice online is stale.

| Host | Card? | Always-on? | Verdict for a chat app |
|---|---|---|---|
| **Render** | No | No — sleeps at 15 min, ~1 min wake | **Use this.** 512 MB, WebSockets, custom domain + TLS on free. The sleep is the price; an active chat keeps itself awake. |
| **Back4app Containers** | No | Within quota | 256 MB is tight once `sharp`/libvips loads, and 600 active hours/month is ~144 short of a full month. |
| **Hugging Face Spaces** | No | Sleeps only after 48 h | Far more generous CPU/RAM, but built for ML demos, no custom domain on free, ephemeral disk. Off-label. |
| **Northflank** | Disputed | Yes | Sandbox tier is genuinely always-on, but sources now conflict on whether a card is required for verification. |
| **Fly.io** | Yes | Yes | Free allowance ended; trial credit, then pay-as-you-go. |
| **Koyeb** | — | — | Acquired by Mistral. Pricing now starts at $29/mo; no free tier. |
| **Railway** | Yes | Yes | Trial credits, then paid. No standing free tier. |
| **Oracle Always Free** | Yes | Technically | See below — free forever, but a bad fit here. |
| **Vercel / Netlify functions** | No | N/A | Serverless. Cannot hold a WebSocket at all. |

**On "open source":** none of the managed platforms above are. If that is the
priority, the honest answer is [Coolify](https://coolify.io) or
[Dokploy](https://dokploy.com) — genuinely open-source, self-hosted PaaS that
would run this Dockerfile with no vendor limits. Both need a server you rent
(roughly ₹350–500/month). Open source and free-of-charge are different things,
and no amount of searching collapses them into one.

### About Oracle Always Free

It looks like the obvious winner — a real VM, 2 OCPU / 12 GB ARM (reduced from 4/24 in June 2026), free permanently. Two reasons I'd steer you away for *this*:

1. **The idle-reclaim policy.** Oracle reclaims instances whose 95th-percentile CPU stays under 20% over 7 days. A chat app used by a handful of friends will sit far below that — you'd be running a fake workload purely to keep your server alive.
2. **You'd be managing a Linux box.** Nginx, TLS renewal, systemd, security updates, firewall rules. That's a real ongoing job, not a deploy step.

Worth it if you want several projects on one machine and enjoy sysadmin. Not worth it for one chat app.

### Still worth doing on any host

- [ ] **VAPID keys** — `npx web-push generate-vapid-keys`, set the pair. Without them the server makes new keys on every restart and everyone's notifications silently stop.
- [ ] **Cloudinary** — media survives deploys and redeploys. Free 25 GB.
- [ ] **TURN** — free at [Metered Open Relay](https://www.metered.ca/tools/openrelay/). Without it calls fail for roughly 20% of people, mostly on mobile data.
- [ ] **Brevo** — only for password-recovery emails. Accounts are username + password, so genuinely optional.

---

## 8 · The mobile app

Separate from the website — it talks to the same Render API.

```bash
cd mobile
npm install
npx expo start          # scan the QR with Expo Go
```

To ship an installable Android APK:

```bash
npm install -g eas-cli
eas login
```

Set `EXPO_PUBLIC_API_URL` to your API URL in `eas.json` (all three profiles), then:

```bash
eas build --platform android --profile preview
```

iOS needs an Apple Developer account (₹8,200/year). Android sideloading needs nothing.

---

## If something's wrong

| Symptom | Cause |
|---|---|
| Vercel build fails immediately | Root Directory isn't `client` |
| Blank page, CORS error in console | `CLIENT_ORIGIN` isn't exactly `https://nook.niranjand.in` |
| Signed out on every reload | `COOKIE_DOMAIN` missing or without the leading dot |
| Messages need a refresh to appear | Free instance asleep, or Cloudflare proxying the API — set DNS to grey cloud |
| Photos vanish after a deploy | No disk on Render free — you need Cloudinary |
| First load takes 30 seconds | Free instance cold start. Add the uptime pinger. |
| Calls ring but never connect | You need TURN |
| Notifications stopped working | VAPID keys not set, so they rotated on a restart |
| `SQLITE_UNKNOWN: unauthorized` | `TURSO_AUTH_TOKEN` wrong or expired — regenerate |
| Domain shows "certificate pending" for ages | CNAME wrong, or Cloudflare proxy is on — Render can't validate through it |

---

## What it costs

| | Your setup |
|---|---|
| Vercel Hobby | ₹0 |
| Render free instance | ₹0 — no credit card; sleeps after 15 min idle |
| Turso | ₹0 — genuinely generous |
| Cloudinary | ₹0 — 25 GB |
| TURN (Open Relay) | ₹0 |
| Custom domains + TLS | ₹0 on both hosts |
| `niranjand.in` | already yours |
| **Total** | **₹0/month, nothing sleeping** |

You only start paying when you outgrow one service or 2 GB of storage — which for a private chat app among friends is a long way off.
