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
  nook-api.niranjand.in  →  Northflank  the API (Node + Socket.IO) — always-on, free
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

## Can I use MongoDB instead? (Northflank has it as an addon)

**Yes, Northflank offers MongoDB** — their addons cover PostgreSQL, MySQL, MongoDB, Redis, MinIO, Memcached and RabbitMQ, with backups and TLS built in, and the free Sandbox includes **one database**.

**But Nook no longer speaks MongoDB.** You asked to move to Turso, and that migration replaced the entire data layer: the schema, four data modules, all nine route files, the socket layer, the scheduler and the seed — roughly 2,000 lines, now SQL. Going back to Mongo means undoing all of it and re-testing every feature, for no gain. Search would also get *worse*: SQLite FTS5 gives ranked prefix matching, which the Mongo version never had.

So you have two sensible choices, and MongoDB isn't one of them:

| | **Turso** (recommended) | **SQLite on a Northflank volume** |
|---|---|---|
| Setup | One signup, two env vars | No signup, no keys at all |
| Durability | Managed, replicated, backed up | Lives or dies with that one service |
| If you delete the service | Data is safe | Data is gone |
| Free tier | 9 GB, 1 billion row reads/month | Uses your Sandbox storage |

Turso for anything you'd be upset to lose. The volume is fine for a throwaway trial — leave `TURSO_DATABASE_URL` empty, attach a volume at `/app/data`, and the server writes `nook.db` there automatically.

---

## 1 · Turso — 5 min

- [ ] Sign up at [turso.tech](https://turso.tech)
- [ ] **Databases → Create Database**, name it `nook`, pick the region closest to your users (`aws-ap-south-1` for India)
- [ ] Copy the **URL** — starts `libsql://`
- [ ] **Edit → Generate Token**, copy it

Keep both in a password manager. Nothing to design or migrate — the schema builds itself on first boot.

---

## 2 · The API — Northflank — 10 min

> **Why not Render:** its free plan sleeps after 15 minutes idle, which drops every WebSocket. For a chat app that's the one thing you can't really live with. Northflank's free Sandbox is **always-on** — no cold starts, no pinger needed, no credit card. Render's config is still in the repo (`render.yaml`) if you'd rather use it; see the comparison at the bottom.

- [ ] [northflank.com](https://northflank.com) → sign up → connect GitHub
- [ ] **Create new → Service → Combined service** (build + deploy in one)
- [ ] Repository: your `Nook` repo, branch `main`
- [ ] Build type: **Dockerfile**
      - Dockerfile path: `/server/Dockerfile`
      - Build context: `/server`
- [ ] Port: **4000**, protocol **HTTP**, and tick **Publicly expose**
- [ ] Resources: the smallest plan — Nook idles at well under 200 MB

**Environment variables** (Northflank calls these *Secrets* → *Environment variables*):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `JWT_ACCESS_SECRET` | generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | run it **again** — must be different |
| `TURSO_DATABASE_URL` | your `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | your token |
| `CLIENT_ORIGIN` | `https://nook.niranjand.in` |
| `PUBLIC_URL` | `https://nook-api.niranjand.in` |
| `COOKIE_DOMAIN` | `.niranjand.in` ← **the leading dot matters** |

- [ ] Deploy, and wait for the build (~2–3 min the first time)
- [ ] **Domains** → add `nook-api.niranjand.in`, link it to port 4000
- [ ] Add the CNAME Northflank shows you at your DNS provider
- [ ] Certificate is issued automatically via Let's Encrypt
- [ ] Check `https://nook-api.niranjand.in/api/health` → `{"ok":true,…}`

**Free Sandbox gives you:** 2 services, 1 database, 2 cron jobs, always-on compute, ~2 GB storage, 500 build minutes/month. You're using one service. Nothing sleeps.

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
| CNAME | `nook-api` | whatever Northflank shows you in **Domains** |

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

| Host | Always-on free? | Verdict for a chat app |
|---|---|---|
| **Northflank** | **Yes** — Sandbox tier, no cold starts | **Use this.** 2 services, 1 database, 2 cron jobs, ~2 GB storage, no credit card. |
| **Render** | No — sleeps at 15 min | Workable with a pinger, but 750 hrs/month means one service and no margin. |
| **Fly.io** | No | The free allowance ended; it's trial credit then pay-as-you-go. |
| **Koyeb** | No | Acquired by Mistral in early 2026; free tier closed to new signups. |
| **Railway** | No | Trial credits, then paid. No standing free tier. |
| **Oracle Cloud Always Free** | Technically yes | See below — genuinely free forever, but a bad fit here. |
| **Vercel / Netlify functions** | N/A | Serverless. Cannot hold a WebSocket at all. |

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
| Northflank Sandbox | ₹0 — **always-on**, no credit card |
| Turso | ₹0 — genuinely generous |
| Cloudinary | ₹0 — 25 GB |
| TURN (Open Relay) | ₹0 |
| Custom domains + TLS | ₹0 on both hosts |
| `niranjand.in` | already yours |
| **Total** | **₹0/month, nothing sleeping** |

You only start paying when you outgrow one service or 2 GB of storage — which for a private chat app among friends is a long way off.
