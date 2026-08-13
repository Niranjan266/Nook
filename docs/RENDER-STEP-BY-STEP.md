# Hosting the Nook API on Render — step by step

Everything below is written for **your** setup: repo `Niranjan266/Nook`, domain
`niranjand.in` with DNS at BigRock, frontend already live on Vercel at
`nook.niranjand.in`.

Total hands-on time is about 25 minutes. The waiting (DNS propagation) is
longer, which is why step 0 comes first.

**Order matters here.** The app goes live on Render's own domain first and only
moves to `nook-api.niranjand.in` at the end. Doing it the other way round means
debugging DNS, TLS and cookies all at once with nothing known-good to compare
against.

---

## Step 0 · Fix the nameservers at BigRock — do this first, it takes hours

`niranjand.in` is currently delegated to **five** nameservers: four at BigRock
and one at Vercel. Each has its own separate copy of the zone, and resolvers
pick one at random. They disagree — and the Vercel one answers **every**
subdomain, including ones that don't exist:

```
zzz-does-not-exist.niranjand.in  @ dns1.bigrock.in     → NXDOMAIN
zzz-does-not-exist.niranjand.in  @ ns1.vercel-dns.com  → 216.198.79.65
```

So if you add `nook-api` at BigRock only, about **one lookup in five** goes to
Vercel instead of Render, and Render's certificate validation will keep failing
for reasons that look random.

1. Log in to **BigRock** → **Manage Domain** → `niranjand.in`
2. Open **Name Servers**
3. Remove `ns1.vercel-dns.com`. Leave only:
   ```
   dns1.bigrock.in   dns2.bigrock.in   dns3.bigrock.in   dns4.bigrock.in
   ```
4. Save

This does not affect your live site — `nook.niranjand.in` reaches Vercel through
a CNAME held at BigRock, which is Vercel's supported setup. Their nameservers
are optional.

While you're in the DNS panel: **delete any `AAAA` records** on the domain.
Render uses IPv4 only, and a stray `AAAA` causes intermittent failures.

Propagation takes anywhere from 30 minutes to a few hours. Carry on with the
next steps meanwhile — you don't need DNS until step 7.

---

## Step 1 · Collect the values you'll paste in

Have these ready in a text file before you start. Render will ask for them all
in one go.

| Value | Where from |
|---|---|
| `TURSO_DATABASE_URL` | Turso dashboard — `libsql://nook-nook.aws-ap-south-1.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso → your DB → **Edit → Generate Token** |
| `CLOUDINARY_CLOUD_NAME` | `g8b45gku` |
| `CLOUDINARY_API_KEY` | `981321153139535` |
| `CLOUDINARY_API_SECRET` | Cloudinary → Settings → Access Keys |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | double-click **`Make-Keys.bat`** → `MY-KEYS.txt` |
| `BREVO_API_KEY` | optional — leave blank and recovery codes print to the logs |

**Two of these must be rotated before you use them.** The Cloudinary secret and
the Turso token both appeared in our chat, which means they exist in a log
somewhere and should be considered burned:

- Cloudinary → Settings → **Access Keys** → **Generate New Key**, then disable the old one
- Turso → `turso db tokens invalidate nook`, then generate a fresh token

You do **not** need to generate the JWT secrets. `render.yaml` marks them
`generateValue: true`, so Render creates them itself and they never pass through
your clipboard.

---

## Step 2 · Create the Render account

1. Go to **[render.com](https://render.com)** → **Get Started**
2. Sign up with **GitHub** (simplest — it sets up the repo connection at the same time)
3. No credit card is requested. If you're ever asked for one, you've landed on a paid flow — back out.

---

## Step 3 · Give Render access to the repo

Your `Nook` repo is **private**, so Render can't see it until you grant access
explicitly. This is the single most common place people get stuck — the repo
list simply comes up empty.

1. In the Render dashboard, click **New** (top right)
2. Choose **Blueprint**
3. If `Nook` isn't listed, click **Configure account** / **Configure in GitHub**
4. GitHub opens → select **Only select repositories** → tick **Nook** → **Install & Authorize**
5. You're returned to Render, and `Nook` now appears

---

## Step 4 · Apply the Blueprint

`render.yaml` at the repo root already describes the entire service, so there
is no form to fill in — Render reads it.

1. Select the **Nook** repo → **Connect**
2. Render shows what it will create:
   ```
   nook-api    web service    Docker    free    Singapore
   ```
3. Give the blueprint a name (`nook` is fine)
4. It now prompts for every variable marked `sync: false`. Fill in:

| Field | Value |
|---|---|
| `TURSO_DATABASE_URL` | your `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | your **new** token |
| `PUBLIC_URL` | `https://nook-api.onrender.com` |
| `COOKIE_DOMAIN` | **leave completely empty** |
| `CLOUDINARY_CLOUD_NAME` | `g8b45gku` |
| `CLOUDINARY_API_KEY` | `981321153139535` |
| `CLOUDINARY_API_SECRET` | your **new** secret |
| `VAPID_PUBLIC_KEY` | from `MY-KEYS.txt` |
| `VAPID_PRIVATE_KEY` | from `MY-KEYS.txt` |
| `BREVO_API_KEY` | optional — leave blank |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | optional — leave blank |

5. Click **Apply**

> **Why `COOKIE_DOMAIN` is empty right now.** A server can only set cookies for
> its own domain. If `onrender.com` tries to issue `Domain=.niranjand.in`, the
> browser silently discards the cookie and nobody can stay signed in. Blank
> makes the server fall back to `SameSite=None; Secure`, which is cross-site but
> works. You'll fill it in at step 8.

---

## Step 5 · Watch the first build

The first build takes **3–5 minutes** — it's building the Docker image from
scratch, including `libvips` for image thumbnails. Later builds are much faster
because Render caches the layers.

In the **Logs** tab you're looking for:

```
db        schema ready (42 statements) → turso
scheduler send-later, disappearing messages, retention
╭──────────────────────────────────────────────╮
│  Nook — server                               │
╰──────────────────────────────────────────────╯
```

The database schema builds itself on first boot. There is nothing to migrate or
import.

Your service URL is at the top of the page: `https://nook-api.onrender.com`
(Render appends a suffix if that name is taken — use whatever it shows).

---

## Step 6 · Verify before going further

Open in a browser:

```
https://nook-api.onrender.com/api/health
```

You want **exactly** this:

```jsonc
{
  "ok": true,
  "db": "turso",           // "sqlite-file" → TURSO_* didn't take
  "media": "cloudinary",   // "local-disk"  → the Cloudinary secret is wrong
  "mail": "console",       // "brevo" if you set the key; console is fine
  "push": "configured"     // "ephemeral"   → VAPID_* didn't take
}
```

**Do not continue past a wrong value here.** Each fallback is silent by design:
`local-disk` means every uploaded photo is written to a filesystem that Render
wipes on the next restart, and `sqlite-file` means the same for your entire
database. Fix the variable in **Environment**, save, and let it redeploy.

Now connect the frontend:

1. **Vercel** → `nook` project → **Settings → Environment Variables**
2. Set `VITE_API_URL` = `https://nook-api.onrender.com` (no trailing slash)
3. **Deployments → ⋯ → Redeploy**, and **untick "Use existing Build Cache"**
4. Open `https://nook.niranjand.in` and create an account

`VITE_API_URL` is compiled into the JavaScript at build time, so saving the
variable alone changes nothing — the redeploy is what matters.

**Signing up should work now.** If it does, everything below is cosmetic.

---

## Step 7 · Add the custom domain

1. Render → `nook-api` → **Settings** → **Custom Domains** → **Add Custom Domain**
2. Enter `nook-api.niranjand.in` → **Save**
3. Render shows the record to create. For a subdomain it is always a CNAME:

| Type | Name / Host | Value |
|---|---|---|
| `CNAME` | `nook-api` | `nook-api.onrender.com` |

4. Add that record in **BigRock → Manage DNS → CNAME Records**
   - Host: `nook-api` (just the label, not the full name — BigRock appends the domain)
   - Value: exactly what Render displays
   - TTL: leave the default
5. Back in Render, click **Verify**

Certificate issuance is automatic via Let's Encrypt and included on the free
instance. Verification usually completes in a few minutes but can take up to an
hour. If it stays pending, confirm step 0 propagated:

```powershell
Resolve-DnsName nook-api.niranjand.in -Server dns1.bigrock.in
Resolve-DnsName nook-api.niranjand.in -Server 8.8.8.8
```

Both should return the CNAME. If `8.8.8.8` disagrees, the old nameservers are
still cached — wait longer.

---

## Step 8 · Switch everything over

Only once `https://nook-api.niranjand.in/api/health` works in a browser:

**Render → Environment:**

| Variable | New value |
|---|---|
| `PUBLIC_URL` | `https://nook-api.niranjand.in` |
| `COOKIE_DOMAIN` | `.niranjand.in` ← **the leading dot is required** |

Save; Render redeploys automatically.

**Vercel:** set `VITE_API_URL` = `https://nook-api.niranjand.in` and redeploy
without cache.

The leading dot is what makes the refresh cookie belong to the whole domain, so
a cookie set by `nook-api.niranjand.in` counts as first-party to
`nook.niranjand.in`.

Without it the cookie is cross-site, and **Safari and Firefox discard
third-party cookies by default** — they have for years. Chrome is the lenient
one here: Google abandoned the forced deprecation in 2024 and now asks users
instead, so Chrome mostly still accepts them. That asymmetry is what makes this
bug so unpleasant. It works perfectly on your machine, and an iPhone user tells
you the app "keeps logging me out".

---

## Step 9 · Final check

1. Open `https://nook.niranjand.in`, sign in
2. **Hard-refresh** (Ctrl+Shift+R). Still signed in? `COOKIE_DOMAIN` is right. Bounced to sign-in? It isn't.
3. Open a second browser in incognito, sign in as another account
4. Send a message both ways — it should appear instantly, with no refresh. That's the WebSocket working, which is the whole reason the API isn't on Vercel.
5. Send a photo, then reload. Still there? Cloudinary is live. Gone? You're on `local-disk`.
6. Try a voice or video call

---

## What to expect day to day

Render's free instance **spins down after 15 minutes with no inbound traffic**,
and the next request takes about a minute to wake it. Render shows a loading
page while that happens.

WebSocket messages on an open connection count as traffic, so an active
conversation keeps the service awake by itself. The wait is only paid by the
first person to open the app after a quiet spell.

If you want it permanently awake, a free pinger such as
[cron-job.org](https://cron-job.org) (no card) hitting `/api/health` every 10
minutes will do it — but check the arithmetic first. Render grants **750 free
instance hours a month** and a 31-day month is 744 hours. A permanently-awake
service consumes nearly the whole allowance, leaving about six hours of margin
for your entire workspace. Add a second free service and everything gets
suspended before month end.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| Repo doesn't appear in Render | Private repo — go back to step 3 and grant access in GitHub |
| Build fails on `npm install` | Check the log for the real error; the Dockerfile is verified working on `node:22` |
| Health says `"db": "sqlite-file"` | `TURSO_DATABASE_URL` is empty or misspelt |
| Health says `"media": "local-disk"` | One of the three Cloudinary values is missing — all three are required |
| Health says `"push": "ephemeral"` | `VAPID_*` didn't take; subscriptions will break on every restart |
| Sign-up says "Can't reach the server at…" | `VITE_API_URL` is wrong, or you didn't redeploy Vercel after changing it |
| Browser console: CORS blocked | `CLIENT_ORIGIN` must be exactly `https://nook.niranjand.in`, no trailing slash |
| Signed out on every refresh | `COOKIE_DOMAIN` missing, or missing its leading dot |
| Certificate stuck "pending" | Step 0 hasn't propagated, or a stray `AAAA` record exists |
| Messages only appear after refresh | WebSocket isn't connecting — check `PUBLIC_URL` and that nothing proxies the API |
| First load takes ~1 minute | Normal. The instance was asleep. |

---

## What is where, when you're done

```
nook.niranjand.in      →  Vercel     the web app (static files)      ₹0
nook-api.niranjand.in  →  Render     the API (Node + Socket.IO)      ₹0
                       →  Turso      the database                    ₹0
                       →  Cloudinary photos, video, voice notes      ₹0
```

Vercel genuinely cannot host the API half: its functions start per request and
stop, and Socket.IO needs a connection held open for as long as the app is on
screen. That is why there are two hosts, and no setting changes it.
