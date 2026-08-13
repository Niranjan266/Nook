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

Two things about this variable:

- **No trailing slash.** `config.ts` strips one if you leave it, but the mobile
  app is less forgiving. Get in the habit.
- **It is baked in at build time.** Editing the field does nothing to the site
  that is already live. You must **Redeploy** afterwards — and untick
  "Use existing Build Cache", or Vercel may reuse the bundle with the old value.

---

## Northflank → your service → Environment

This is the real backend, and this is where every secret lives.

### Required

| Name | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Turns on secure cookies and disables verbose logging. |
| `PORT` | `4000` | Must match the port you exposed on the service. |
| `CLIENT_ORIGIN` | `https://nook.niranjand.in` | CORS allow-list. Comma-separate for more than one. A mismatch here is the classic "works locally, blocked in production". |
| `PUBLIC_URL` | `https://nook-api.niranjand.in` | How the API refers to itself in media URLs and push payloads. |
| `COOKIE_DOMAIN` | `.niranjand.in` | **Leading dot is required.** See below. |
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
server silently falls back to writing files to local disk. On Northflank that
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

`MY-KEYS.txt` is in `.gitignore`. Copy the values into Northflank, then delete
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
