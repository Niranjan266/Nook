# Nook

**Your corner of the internet.** A private, real-time chat app for the people who actually matter — text, photos, video, voice notes, snaps, disappearing messages, groups, and real WebRTC voice/video calls. No feed. No reels. No stories. No strangers. No algorithm.

---

## Run it

```bash
# from the project root
npm run install:all      # installs client + server

# terminal 1
npm run dev:server       # http://localhost:4000

# terminal 2
npm run dev:client       # http://localhost:5173
```

Open **http://localhost:5173**.

**No database to install.** libSQL is embedded: with no Turso credentials the server writes to `server/data/nook.db`, a real SQLite file that survives restarts. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when you deploy.

**Want demo data?**

```bash
npm run seed
```

Creates four accounts — `ada`, `river`, `kofi`, `mira` — all with password `nookdemo1`, plus a direct chat and a group with history. Sign in as `ada` in one browser and `river` in an incognito window to watch real-time messaging, typing indicators, receipts and calls actually work.

---

## What's in it

**Messaging** — text with live links · photos · video · voice notes with waveform scrubbing · documents · **Snaps** (view once, then burnt) · reply-quote · forward to many · edit (15-minute window) · delete for me / unsend for everyone · star · full-text search · radial reaction picker · read receipts · typing indicators · presence · drafts · **per-conversation disappearing message timers**.

**Wallpaper** — the headline feature. Upload an image, we pull its dominant colour and tint the bubbles to match, with dim and blur sliders so text stays readable. The wallpaper belongs to the **conversation, not your device** — so in a direct chat the other person is asked to accept before it changes for both of you. Seven built-in clay textures included, all pure CSS.

**Groups** — creation, admins, add/remove, promote/demote, invite links, group wallpaper, system messages.

**Calls** — real WebRTC 1:1 voice and video with Socket.IO signalling. Ring screen, accept/decline, mute, camera toggle, in-call timer, minimise-to-pill, and a call log written back into the conversation.

**System** — offline outbox in IndexedDB that replays in order when you reconnect · optimistic sending with a visible failed state and retry · Web Push with Reply / Mark read actions · installable PWA · light/dark/system themes · five accent colours · full keyboard navigation · WCAG AA contrast.

---

## Stack

| Layer | Choice |
|---|---|
| Client | Vite · React 18 · TypeScript · Zustand · Framer Motion · socket.io-client · idb-keyval |
| Styling | Hand-written CSS design system (no Tailwind, no UI kit) |
| Server | Node · Express · Socket.IO · libSQL/Turso · bcrypt · JWT (access + refresh) · zod |
| Media | Cloudinary, with a local-disk fallback so it runs keyless |
| Email | Brevo, with a console fallback so it runs keyless |
| Push | Web Push / VAPID, auto-generating dev keys |
| Calls | WebRTC + STUN (TURN configurable) |

Every third-party service degrades gracefully. You can run and fully use Nook with a completely empty `.env`.

---

## Design — "Soft Clay, Hard Edges"

Two materials, never blended:

- **Clay** — puffy, rounded, dual shadow (light top-left, shade bottom-right), no borders. Every surface you look at.
- **Slab** — flat fill, 2px ink border, hard 4px offset shadow, near-square corners. Every control you press. Pressing one physically moves it into its own shadow.

Palette is warm and muted: bisque, terracotta, moss, ochre, slate, warm charcoal. No neon, no purple-cyan gradients, no glassmorphism. Type is Bricolage Grotesque + Instrument Sans + JetBrains Mono — deliberately not Inter or Poppins.

Layouts break the usual templates on purpose: the sign-in screen is a single low-sitting column over drifting clay blobs that splits down the middle and slides apart when you get in. The shell is an avatar dock rail plus a collapsible conversation shelf, with contextual panels sliding over the chat as clay sheets rather than sitting in a fixed third column.

See `docs/DESIGN.md` for the full system and `docs/SETUP.md` for keys and deployment.

---

## Honest limitations

- **Not end-to-end encrypted.** TLS in transit, access-controlled at rest, but the server can read messages. Real E2E (libsignal/MLS) is a dedicated project that complicates search, push previews and multi-device.
- **Snap screenshots can't be blocked.** No web app can. Nook blurs on window blur and tells the sender a screenshot may have happened. That's a courtesy, not a guarantee.
- **WebRTC needs TURN for ~20% of networks.** STUN alone fails behind strict NATs. Set `TURN_URL` for production.
- **Group calls are 1:1 only for now.** Group calling needs an SFU (LiveKit/mediasoup) and real infrastructure cost.

---

## Layout

```
chat app/
├── client/            Vite + React + TS
│   ├── public/        logo, manifest, service worker
│   └── src/
│       ├── styles/    tokens · base · materials · auth · shell · chat · call
│       ├── lib/       api · socket · types · format · color · motion · push · outbox
│       ├── stores/    auth · chat · call · ui
│       ├── components/Avatar · Sheet · Icon · Lightbox · Toasts
│       └── features/  auth · shell · chat · calls · sheets
├── server/            Express + Socket.IO + libSQL
│   └── src/
│       ├── db/        schema.sql · users · conversations · messages · misc
│       ├── routes/    auth · users · conversations · messages · rooms · spaces · media · push · calls
│       ├── sockets/   connection, messaging, typing, presence, call signalling
│       └── services/  media · mail · push · tokens · messages · scheduler
├── mobile/            Expo + React Native
│   ├── app/           routes: sign-in · chats · chat · thread · room · calls · you
│   └── src/           theme · components · lib · stores
└── docs/              GO-LIVE.md · KEYS.md · DEPLOY.md · SETUP.md · DESIGN.md · ROADMAP.md
```
