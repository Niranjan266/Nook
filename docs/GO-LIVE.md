# Go live — the checklist

Tick these in order. About 30 minutes, ₹0 to start.

`DEPLOY.md` explains the *why* behind each step. This is the *do*.

---

## Where each piece goes

```
  nook.niranjand.in      →  Vercel     the web app (static files)
  nook-api.niranjand.in  →  Render     the API (Node + Socket.IO)
                         →  Turso      the database
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

## 1 · Turso — 5 min

- [ ] Sign up at [turso.tech](https://turso.tech)
- [ ] **Databases → Create Database**, name it `nook`, pick the region closest to your users (`aws-ap-south-1` for India)
- [ ] Copy the **URL** — starts `libsql://`
- [ ] **Edit → Generate Token**, copy it

Keep both in a password manager. Nothing to design or migrate — the schema builds itself on first boot.

---

## 2 · Render (the API) — 10 min

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

**Two things about the free plan, plainly:**
1. It **sleeps after 15 minutes idle.** Sleeping drops every socket, so live messaging stops until someone opens the app (~30s wake).
2. **No persistent disk** — uploaded photos are deleted on every deploy. So on free, do step 3.

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
| CNAME | `nook-api` | `nook-api.onrender.com` |

Both hosts show you the exact value to use — copy theirs rather than mine if they differ.

**If you use Cloudflare DNS:** set both records to **DNS only** (grey cloud), not proxied. Cloudflare's proxy in front of Render can interfere with WebSocket upgrades, and you'd spend an evening debugging "messages only appear after a refresh".

Give DNS 5–30 minutes. Then check:

```
https://nook-api.niranjand.in/api/health   → {"ok":true,…}
https://nook.niranjand.in                  → the sign-in screen
```

---

## 7 · Staying on free — what it actually means

Free works. Here is exactly what you're accepting, and what to do about each.

### The sleeping problem — the one that matters for chat

Render free spins the instance down after **15 minutes with no traffic**. When it sleeps:

- every open WebSocket drops, so **live messaging stops**
- the next request takes **~30 seconds** to wake it
- push notifications for that period never fire, because nothing is running to send them

For a chat app this is the real cost. Someone messages you at 11pm, the server is asleep, and you get nothing until you open the app yourself.

**The workaround:** ping it. A free uptime monitor hitting `https://nook-api.niranjand.in/api/health` every 10 minutes keeps it awake.

- [ ] [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org), both free — 10-minute interval, HTTP GET on `/api/health`

**The honest catch:** Render's free tier allows **750 instance-hours per month** across your whole account. A month is 720–744 hours, so one always-awake free service *just* fits — with nothing spare. Add a second free service and you'll run out and everything stops until the month rolls over.

So: one free service, one pinger, and it behaves like a real app. That's a legitimate setup, not a hack — just know the ceiling you're sitting under.

### Cloudinary is not optional for you

Render free has **no persistent disk**. Without Cloudinary, every uploaded photo and voice note is deleted on each deploy *and* each wake from sleep. Step 3 isn't a nice-to-have on this plan.

### Also worth 10 minutes

- [ ] **VAPID keys** — `npx web-push generate-vapid-keys`, put the pair in Render. Without them the server generates new keys on every restart — and on free it restarts constantly — so notifications silently stop working for everyone.
- [ ] **TURN** — free at [Metered Open Relay](https://www.metered.ca/tools/openrelay/). Without it calls fail for roughly 20% of people, mostly on mobile data.
- [ ] **Brevo** — only for password-recovery emails. Accounts are username + password, so genuinely optional.

### When to actually pay

$7/month is worth it the moment someone other than you relies on the app. It removes the sleeping, gives you a real disk, and you stop thinking about instance-hours. Until then, free plus a pinger is fine.

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

| | Your setup (free) | If you upgrade later |
|---|---|---|
| Vercel Hobby | ₹0 | ₹0 |
| Render | ₹0 — sleeps, no disk, 750 hrs/mo | Starter **$7/mo** |
| Turso | ₹0 — genuinely generous | ₹0 |
| Cloudinary | ₹0 — 25 GB | ₹0 |
| TURN (Open Relay) | ₹0 | ₹0 |
| Custom domain on Render | ₹0 — 2 included | ₹0 |
| `niranjand.in` | already yours | already yours |
| **Total** | **₹0** | **~₹600/month** |
