# Nook — Setup

Nook runs with a **completely empty `.env`**. Every third-party service has a working local fallback. Add keys when you want the real thing.

---

## 1. First run

```bash
npm run install:all

# terminal 1
npm run dev:server     # http://localhost:4000

# terminal 2
npm run dev:client     # http://localhost:5173
```

On first boot the server builds its schema and seeds itself:

```
db        schema ready (42 statements) → local file
demo      four accounts ready, password "nookdemo1":
            ada  ·  river  ·  kofi  ·  mira
database  local file — server/data/nook.db
```

Sign in as **ada** in one window and **river** in an incognito window to see messaging, typing, receipts, presence and calls working between two real people.

> **No database to install.** With no Turso credentials the server writes to `server/data/nook.db`, a real SQLite file. Your messages survive restarts, and there's no signup, no daemon and no download.

---

## 2. Requirements

| | Version | Notes |
|---|---|---|
| Node | 20+ | Tested on 22 and 24 |
| npm | 10+ | npm 11 blocks install scripts by default — see below |
| Database | none | libSQL is embedded. Turso only for production. |

### npm 11 and install scripts

npm 11 refuses to run package install scripts until you approve them. Vite's `esbuild` needs its postinstall to fetch a platform binary. If `npm run dev:client` fails with a missing esbuild binary:

```bash
cd client
npm approve-scripts esbuild
npm rebuild esbuild
```

Nook deliberately uses **bcryptjs**, not argon2, for password hashing — argon2 needs a native build toolchain, which on Windows means installing Visual Studio Build Tools before the project will even start. bcrypt at cost 12 is a sound choice and keeps `clone && run` honest.

---

## 3. Turso, for production

```env
# server/.env — both empty in development
TURSO_DATABASE_URL=libsql://nook-you.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOi...
```

```bash
turso db create nook
turso db show nook --url
turso db tokens create nook
```

The schema is created at boot, every statement `IF NOT EXISTS`, so there's no migration command and no "did you run the migration?" failure mode. To force the demo accounts into a real database:

```bash
SEED_DEMO=1 npm run dev:server     # or: npm run seed
```

**Search runs on SQLite FTS5** — ranked, prefix-matched and index-backed, which is a genuine upgrade on the regex scan the previous version used.

---

## 4. Cloudinary — media

**Without keys:** uploads are written to `server/uploads/` and served from `/uploads`. Fully functional; the files just live on your disk.

**With keys:** images and video go to Cloudinary, with automatic thumbnails and format/quality optimisation.

```env
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Get them from the Cloudinary dashboard → Account Details. The free tier is generous. Max upload is 64 MB, set in `server/src/routes/media.js`.

---

## 5. Brevo — email

Email is **optional in Nook**. Accounts are username + password; an email address is only ever used to recover a forgotten password.

**Without a key:** recovery codes print to the server console in a box. Perfectly usable in development.

**With a key:**

```env
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=no-reply@yourdomain.com
BREVO_SENDER_NAME=Nook
```

From Brevo → SMTP & API → API Keys. The sender address must be a verified sender in your Brevo account or delivery will fail.

---

## 6. Web Push

**Without keys:** a VAPID keypair is generated at every boot and printed. Push works, but existing subscriptions break on restart.

Copy the printed pair into `.env` to make it stable:

```env
VAPID_PUBLIC_KEY=B...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourdomain.com
```

Push requires HTTPS in production (localhost is exempt). Notifications carry **Reply** and **Mark read** actions, handled in `client/public/sw.js`.

---

## 7. Calls and TURN

1:1 voice and video are real WebRTC, signalled over Socket.IO. STUN alone connects roughly 80% of users; the rest are behind symmetric NATs and need a TURN relay.

```env
STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
TURN_URL=turn:your-turn-server:3478
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

Free option: [Open Relay](https://www.metered.ca/tools/openrelay/). Paid: Twilio Network Traversal, Metered, Cloudflare Calls.

Browsers only allow camera and microphone access on **HTTPS or localhost**. Testing calls across two devices on a LAN over plain HTTP will fail with a permissions error — that's the browser, not Nook.

---

## 8. Deploying

**Client** — static build, host anywhere:

```bash
npm run build          # → client/dist
```

Set `VITE_API_TARGET` at build time if the API is on another origin, and point the Vite proxy config or your host's rewrite rules at it.

**Server** — needs a **long-lived process**, not serverless. Socket.IO holds open connections, so Vercel/Netlify functions won't work for the API. Render, Railway, Fly.io or a plain VPS are all fine.

```env
NODE_ENV=production
CLIENT_ORIGIN=https://your-client-domain
JWT_ACCESS_SECRET=<64 random hex chars>
JWT_REFRESH_SECRET=<a different 64>
TURSO_DATABASE_URL=libsql://nook-you.turso.io
TURSO_AUTH_TOKEN=<your token>
```

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Two production gotchas:

1. **Free tiers sleep.** A sleeping instance drops every socket. Fine for a demo, not for real use.
2. **Refresh cookies are `SameSite=None; Secure` in production**, so the API must be served over HTTPS or sessions won't persist.

---

## 9. Where things live

```
server/src/
  config/env.js        every setting, with its fallback
  db/schema.sql        the whole schema, ~20 tables + FTS5
  db/index.js          libSQL client, query helpers, id generation
  db/migrate.js        runs the schema at boot, idempotent
  db/users.js          users, contacts, blocks, folders
  db/conversations.js  conversations, members, pins, wall, wallpaper history
  db/messages.js       messages and everything that was an array inside one
  db/misc.js           calls, push subscriptions, spaces, guest links
  lib/serialize.js     the single shape the client sees
  services/            media · mail · push · tokens · messages · scheduler
  sockets/index.js     messaging, typing, presence, call signalling
  routes/              auth · users · conversations · messages · rooms · spaces · media · push · calls

client/src/          the web app (Vite + React)
mobile/              the phone app (Expo + React Native)
```

---

## 10. Troubleshooting

| Symptom | Cause |
|---|---|
| Client starts, API calls 500 | Server not running — check the server console |
| `SQLITE_UNKNOWN: unauthorized` | `TURSO_AUTH_TOKEN` is wrong or expired — regenerate it |
| Phone app can't reach the API | `localhost` on a phone is the phone. Set `EXPO_PUBLIC_API_URL` to your laptop's LAN IP |
| `Cannot find module '@esbuild/...'` | npm 11 blocked the postinstall — see §2 |
| Sign-in works, refresh logs you out | Cookies blocked, or `CLIENT_ORIGIN` doesn't match the browser origin |
| Calls ring but never connect | You need TURN — see §7 |
| Camera/mic permission denied | Not on HTTPS or localhost |
| Push does nothing | Keys rotate every boot unless you set VAPID in `.env` |
| Messages send but nobody receives | Socket blocked — check for a proxy stripping WebSocket upgrades |
