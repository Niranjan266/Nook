# Go live — the checklist

Tick these in order. About 30 minutes, ₹0 to start.

`DEPLOY.md` explains the *why* behind each step. This is the *do*.

---

## Where each piece goes

```
  app.yoursite.com  →  Vercel     the web app (static files)
  api.yoursite.com  →  Render     the API (Node + Socket.IO)
                    →  Turso      the database
```

**Vercel cannot host the API.** Its functions are serverless — they start per request and stop. Socket.IO needs a connection held open the whole time the app is on screen. No setting changes that, which is why there are two hosts.

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
| `CLIENT_ORIGIN` | `https://nook.vercel.app` — update after step 4 |
| `PUBLIC_URL` | your Render URL, e.g. `https://nook-api.onrender.com` |
| `ALLOW_VERCEL_PREVIEWS` | `1` while setting up |

- [ ] Deploy, then open `https://YOUR-API.onrender.com/api/health` → should return `{"ok":true,…}`

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
| `VITE_API_URL` | your Render URL, no trailing slash |

- [ ] Deploy
- [ ] Copy your Vercel URL back into Render's `CLIENT_ORIGIN`, then **redeploy Render**

This is baked in at build time, so any later change to `VITE_API_URL` needs a redeploy, not just a save.

---

## 5 · Test it — 3 min

- [ ] Open your Vercel URL, create an account, send yourself a message
- [ ] **Reload the page.** Still signed in? Cookies are fine. Kicked out? See step 6.
- [ ] Open an incognito window, make a second account, message between the two — instant, no refresh
- [ ] Send a photo, then hard-reload. Still there?

If all four pass, you're live.

---

## 6 · A domain — later, but do it

Everything works on `nook.vercel.app` + `nook-api.onrender.com` **except staying signed in**. On unrelated domains the session cookie is *third-party*: Safari blocks those today and Chrome is phasing them out, so people get silently signed out on reload.

One domain fixes it (~₹800/year from Namecheap, Cloudflare or GoDaddy):

- [ ] Vercel → Settings → Domains → `app.yoursite.com`, add the CNAME it shows you
- [ ] Render → Settings → Custom Domain → `api.yoursite.com`, same
- [ ] Render env: `COOKIE_DOMAIN` = `.yoursite.com` — **the leading dot matters**
- [ ] Render env: `CLIENT_ORIGIN` = `https://app.yoursite.com`, `PUBLIC_URL` = `https://api.yoursite.com`
- [ ] Vercel env: `VITE_API_URL` = `https://api.yoursite.com` → **redeploy**
- [ ] Render env: `ALLOW_VERCEL_PREVIEWS` = `0`

Now both are subdomains of one site, the cookie is first-party, and nothing blocks it.

---

## 7 · Worth doing before real people use it

- [ ] **VAPID keys** — `npx web-push generate-vapid-keys`, put the pair in Render. Without them the server makes new keys every restart, which silently kills everyone's notifications.
- [ ] **TURN** — free at [Metered Open Relay](https://www.metered.ca/tools/openrelay/). Without it, calls fail for roughly 20% of people, mostly on mobile networks.
- [ ] **Render Starter, $7/mo** — no sleeping, real disk.
- [ ] **Brevo** — only if you want password-recovery emails. Nook accounts are username + password, so this is genuinely optional.

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
| Blank page, CORS error in console | `CLIENT_ORIGIN` doesn't match your Vercel URL exactly, `https://` included |
| Signed out on every reload | Third-party cookie — do step 6 |
| Messages need a refresh to appear | Socket blocked, or the free instance is asleep |
| Photos 404 after a deploy | Render free wiped the disk — do step 3 |
| First load takes 30 seconds | Free instance cold start. Expected. |
| Calls ring but never connect | You need TURN — step 7 |
| `SQLITE_UNKNOWN: unauthorized` | `TURSO_AUTH_TOKEN` wrong or expired — regenerate |

---

## What it costs

| | Free | Recommended |
|---|---|---|
| Vercel | Hobby | Hobby |
| Render | Free — sleeps, no disk | Starter **$7/mo** |
| Turso | Free — genuinely generous | Free |
| Cloudinary | Free 25 GB | Free |
| TURN | Open Relay | Free |
| Domain | — | ~₹800/year |
| **Total** | **₹0** | **~₹700/month** |
