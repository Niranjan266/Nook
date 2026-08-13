# Environment variables — what goes where

The single most common way to break this deployment is to put server variables
into Vercel. They will not work, and the ones that *do* take effect will be
published to the world. This page exists so that never happens.

---

## The one rule

**Vercel builds a folder of static files.** There is no Node process, no
database connection, no socket. At build time Vite finds every
`import.meta.env.VITE_*` reference and **pastes the literal value into the
JavaScript bundle**, which is then served to every visitor.

So in Vercel:

- A variable **not** starting with `VITE_` is read by nothing. Harmless, useless.
- A variable **starting with `VITE_`** is **public**. Anyone can open DevTools →
  Sources and read it.

Which means a `VITE_TURSO_AUTH_TOKEN` would hand every visitor write access to
your database. Never prefix a secret with `VITE_`.

The client only ever reads **one** variable. Verified by searching the source:

```
client/src/lib/config.ts:12   import.meta.env.VITE_API_URL
client/src/lib/config.ts:31   import.meta.env.PROD          ← Vite sets this itself
```

That is the whole list.

---

## Vercel → Project → Settings → Environment Variables

| Name | Value | Environments |
|---|---|---|
| `VITE_API_URL` | `https://nook-api.niranjand.in` | Production, Preview, Development |

**Nothing else.** No token, no secret, no database URL.

### Never set `NODE_ENV` in Vercel

This one does not merely do nothing — **it breaks the build**, and the error
message points nowhere near the cause.

npm treats `NODE_ENV=production` as an implicit `--omit=dev`. `tsc` and `vite`
are devDependencies, so the install quietly succeeds having skipped them, and
the build then dies with:

```
sh: line 1: tsc: command not found
Error: Command "npm --prefix client run build" exited with 127
```

Reproduced on a clean machine:

```
npm --prefix client install                    →  added 92 packages   ✅
NODE_ENV=production npm --prefix client install →  added 29 packages   ❌ no tsc
```

Vercel manages `NODE_ENV` itself. Delete it from the project if it is there.

The build command now passes `--include=dev` explicitly, so this cannot happen
again — but the variable still has no business being in Vercel.

Two things about this variable:

- **No trailing slash.** `config.ts` strips one if you leave it, but the mobile
  app is less forgiving. Get in the habit.
- **It is baked in at build time.** Editing the field does nothing to the site
  that is already live. You must **Redeploy** afterwards — and untick
  "Use existing Build Cache", or Vercel may reuse the bundle with the old value.

---

## Where `PUBLIC_URL` comes from

`PUBLIC_URL` is not a value you invent. It is **the address Render gives your
service**, and it arrives in two stages.

### Stage 1 — the free `onrender.com` domain

The moment the service deploys, Render publishes it on a domain derived from
the service name:

```
https://nook-api.onrender.com
```

It is shown at the top of the service page and has working HTTPS immediately,
with no DNS setup at all. Use it as `PUBLIC_URL` for your first deploy —
everything works.

> **While you are on that domain, `COOKIE_DOMAIN` must be empty.**
>
> A server can only set a cookie for its own domain. If `onrender.com` tries to
> issue `Domain=.niranjand.in`, the browser rejects the cookie outright and
> nobody can stay signed in. Leave `COOKIE_DOMAIN` blank and `tokens.js` falls
> back to `SameSite=None; Secure`, which is cross-site but functional.

### Stage 2 — your own subdomain

Render → your service → **Settings → Custom Domains** → **Add Custom Domain** →
`nook-api.niranjand.in`. Render then shows one record to create at BigRock:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `nook-api` | `nook-api.onrender.com` |

Custom domains and managed TLS are both included on the free instance type.
Once it verifies, Let's Encrypt issues the certificate automatically. **Then**
switch `PUBLIC_URL` to `https://nook-api.niranjand.in`, set
`COOKIE_DOMAIN=.niranjand.in`, and update `VITE_API_URL` in Vercel + redeploy.

---

## ⚠ Read this before creating any DNS record for niranjand.in

`niranjand.in` is currently delegated to **five** nameservers — four at BigRock
and one at Vercel:

```
dns1.bigrock.in  dns2.bigrock.in  dns3.bigrock.in  dns4.bigrock.in
ns1.vercel-dns.com
```

Each holds its own independent copy of the zone, and resolvers pick one at
random. The two copies do not agree:

```
nook.niranjand.in       @ dns1.bigrock.in     → CNAME f95a6ed4cc7b34be.vercel-dns-017.com
nook.niranjand.in       @ ns1.vercel-dns.com  → A 216.198.79.65

www.niranjand.in        @ dns1.bigrock.in     → NXDOMAIN
www.niranjand.in        @ ns1.vercel-dns.com  → A 216.198.79.65

zzz-does-not-exist...   @ dns1.bigrock.in     → NXDOMAIN
zzz-does-not-exist...   @ ns1.vercel-dns.com  → A 216.198.79.65   ← answers anything
```

The Vercel nameserver resolves **every** subdomain to Vercel. So the moment you
add `nook-api` as a CNAME at BigRock, roughly **one lookup in five** will hit
`ns1.vercel-dns.com` instead and be sent to Vercel, where the API does not
exist — a 404 from the wrong server, for some users, some of the time,
persisting for as long as their resolver caches it. This is one of the most
unpleasant classes of bug to diagnose, because the record looks perfectly
correct everywhere you check.

**Fix it first.** In BigRock → Manage Domain → Name Servers, remove
`ns1.vercel-dns.com` and leave only the four `*.bigrock.in` entries.

This will not affect the live site. `nook.niranjand.in` already reaches Vercel
via a CNAME held at BigRock, which is Vercel's documented and fully supported
setup for subdomains — their nameservers are optional. Allow up to a few hours
for the change to propagate, then confirm all answers agree before adding
`nook-api`.

---

## Render → your service → Environment

This is the real backend, and this is where every secret lives. `render.yaml`
at the repo root already declares all of them, so Render prompts you for each
one during **New → Blueprint**. Nothing secret is stored in the repo: every
sensitive key is marked `sync: false`, which means "ask me, never commit".

### What the free instance actually gives you

| | |
|---|---|
| RAM / CPU | 512 MB, 0.1 CPU |
| Credit card | Not required |
| WebSockets | Supported — required here, and the reason Vercel can't host this half |
| Custom domain + TLS | Included on free |
| Filesystem | **Ephemeral.** Wiped on every redeploy, restart and spin-down |
| Outbound SMTP | Blocked on ports 25/465/587 — Brevo's HTTPS API is unaffected |

**The one real limitation:** Render spins the service down after **15 minutes
with no inbound traffic**, and the next request takes about a minute to wake it.
Inbound traffic includes WebSocket messages on existing connections, so an
active conversation keeps it awake by itself; the delay is only felt by the
first person to open the app after a quiet spell.

If you want it awake permanently, a free external pinger (cron-job.org, no card)
hitting `/api/health` every 10 minutes will do it — but note the arithmetic
before you set that up. Render grants **750 free instance hours per month** and
a 31-day month is 744 hours, so a permanently-awake service consumes almost the
entire allowance and leaves ~6 hours of margin for the whole workspace. Run a
second free service and you will be suspended before month end. Sleeping is the
safer default.

### Required

| Name | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Turns on secure cookies and disables verbose logging. |
| `PORT` | `4000` | Must match the port you exposed on the service. |
| `CLIENT_ORIGIN` | `https://nook.niranjand.in` | CORS allow-list. Comma-separate for more than one. A mismatch here is the classic "works locally, blocked in production". |
| `PUBLIC_URL` | `https://nook-api.niranjand.in` | How the API refers to itself in media URLs and push payloads. See "Where `PUBLIC_URL` comes from" above — on your first deploy this is the `onrender.com` domain. |
| `COOKIE_DOMAIN` | `.niranjand.in` | **Leading dot is required — and leave it empty until the custom domain is live.** See below. |
| `TURSO_DATABASE_URL` | `libsql://nook-nook.aws-ap-south-1.turso.io` | Not a secret — it is just an address. |
| `TURSO_AUTH_TOKEN` | *(your **rotated** token)* | Secret. Full read/write on the database. |
| `JWT_ACCESS_SECRET` | *(from `Make-Keys.bat`)* | Secret. Anyone holding it can mint a login for any account. |
| `JWT_REFRESH_SECRET` | *(from `Make-Keys.bat`)* | Secret. Must be a **different** random value from the access secret. |

#### Why `COOKIE_DOMAIN` matters more than it looks

The refresh cookie is what keeps you signed in across a page reload. With
`.niranjand.in`, the cookie belongs to the whole domain, so a cookie set by
`nook-api.niranjand.in` is **first-party** to `nook.niranjand.in`.

Leave it blank and the cookie becomes cross-site, forcing
`SameSite=None` — which Safari's tracking prevention and Chrome's third-party
cookie phase-out both discard. The symptom is nasty because it is intermittent:
sign-in appears to work, then users are silently logged out on refresh, and only
in some browsers.

`server/src/services/tokens.js` switches `SameSite` based on this variable, so
setting it correctly is what makes sessions survive.

### Media — Cloudinary

| Name | Value |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | `g8b45gku` |
| `CLOUDINARY_API_KEY` | `981321153139535` |
| `CLOUDINARY_API_SECRET` | *(your **rotated** secret)* |

The cloud name and API key are public identifiers — they appear in every image
URL. The **secret is not**, and the one you pasted into chat must be replaced:
Cloudinary Console → Settings → Access Keys → **Generate New Key**, then disable
the old one.

All three must be present or `env.js` sets `cloudinary.enabled = false` and the
server silently falls back to writing files to local disk. On Render that
disk is wiped on every redeploy, so your images would quietly vanish.
`GET /api/health` reports which mode is active — check it after deploying.

### Push notifications

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | *(from `Make-Keys.bat`)* |
| `VAPID_PRIVATE_KEY` | *(from `Make-Keys.bat`)* |
| `VAPID_SUBJECT` | `mailto:you@niranjand.in` |

Leave these out and the server generates a throwaway keypair **on every boot**.
Push still appears to work, then every existing subscription breaks the next
time the service restarts, because browsers tie a subscription to the public key
it was created with. Set them once and never change them.

The public key is not a secret, but the client does not read it from an env var
— it fetches it from the API at runtime, which is why there is no `VITE_` twin.

### Email — Brevo (optional)

| Name | Value |
|---|---|
| `BREVO_API_KEY` | *(your Brevo v3 key)* |
| `BREVO_SENDER_EMAIL` | `no-reply@niranjand.in` |
| `BREVO_SENDER_NAME` | `Nook` |

Omit and recovery codes print to the server log instead of being emailed.
Everything still functions; you just have to read the logs to recover an account.
The sender address must be verified in Brevo first or sends fail.

### Calls (optional, but read this)

| Name | Value |
|---|---|
| `STUN_URLS` | `stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302` |
| `TURN_URL` | *(e.g. `turn:your-host:3478`)* |
| `TURN_USERNAME` | |
| `TURN_CREDENTIAL` | |

STUN is free and covers most networks. Roughly **one connection in five** sits
behind a NAT strict enough that STUN alone cannot punch through — symmetric
NAT, corporate firewalls, some mobile carriers — and those calls will ring, be
answered, and then stay silent. Fixing that needs a TURN relay, which costs
money because it carries the actual audio and video. Metered and Twilio both
sell one; there is no free always-on option worth relying on.

---

## Mobile — `mobile/.env` and `mobile/eas.json`

| Name | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://nook-api.niranjand.in` |

Same rule as `VITE_`: **`EXPO_PUBLIC_` means public**, compiled into the app
binary. Never put a secret behind that prefix — an APK is trivially unzipped.

For local development `Nook-Mobile.bat` overwrites this file with your
computer's LAN address, because `localhost` on a phone means the phone itself.

---

## Generating the secrets

Double-click **`Make-Keys.bat`**. It writes `MY-KEYS.txt` containing the two JWT
secrets and the VAPID pair, generated on your machine by Node's crypto module.

`MY-KEYS.txt` is in `.gitignore`. Copy the values into Render, then delete
the file.

**Do not ask anyone — including me — to generate these for you.** A secret that
has appeared in a chat log, a ticket, or an email is burned and has to be
rotated. That is the whole reason this script exists.

---

## Checking it worked

```
https://nook-api.niranjand.in/api/health
```

```jsonc
{
  "ok": true,
  "db": "turso",          // "sqlite-file" means TURSO_* did not take
  "media": "cloudinary",  // "local-disk" means the secret is missing or wrong
  "push": "configured",   // "ephemeral" means VAPID_* did not take
  "mail": "brevo"         // "console" means BREVO_API_KEY is absent
}
```

Then open `https://nook.niranjand.in`, sign in, and **hard-refresh**. If you stay
signed in, `COOKIE_DOMAIN` is right. If you get bounced to sign-in, it is not.
