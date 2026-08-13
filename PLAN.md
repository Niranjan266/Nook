# Nook — Build Plan

> A private place for the people who matter. No feeds, no reels, no strangers.

---

## 1. Product identity

**Name:** Nook — a small, private corner. Short, warm, pronounceable everywhere, not a tech-jargon name.

**Tagline options**
- "Your corner of the internet."
- "Just the people who matter."
- "Quiet by design."

**Logo concept:** a soft-cornered square (a room) with the top-right corner folded *inward*, creating a small alcove. The negative space of the alcove reads as a lowercase **n**. Rendered as an extruded clay object with dual soft shadows (light from top-left) — works as a flat mono SVG for favicons and as a 3D-ish clay object for splash/onboarding.

Variants to produce: full lockup (mark + wordmark), mark only, mono black, mono white, favicon 32/180/512, maskable PWA icon.

---

## 2. Confirmed decisions

| Area | Decision |
|---|---|
| Scope | Full-stack, genuinely real-time |
| Frontend | Vite + React 19 + TypeScript |
| Backend | Node + Express + Socket.IO (separate long-lived server) |
| Database | MongoDB + Mongoose |
| Auth | Username + password (email optional, used only for recovery) |
| Calls | Real WebRTC 1:1 audio + video, Socket.IO signalling |
| Design | Claymorphism core + neo-brutalist accents |
| Keys | All stubbed via `.env.example`; dev fallbacks so it runs with zero third-party accounts |

---

## 3. Design system — "Soft Clay, Hard Edges"

### 3.1 The rule that keeps it non-generic
Every surface is one of exactly **two materials**, never a blend:

- **Clay** — puffy, rounded (18–32px), dual shadow (light top-left, shade bottom-right), no borders. Used for containers, bubbles, cards, avatars, panels.
- **Slab** — flat fill, 2px ink border, hard offset shadow (4px 4px 0), radius 6px. Used for primary actions, badges, counters, toggles, tags.

Clay = the world. Slab = the things you press. That single rule gives the whole app a signature and stops it drifting into generic-SaaS territory.

### 3.2 Palette (warm, muted, zero neon, zero AI-purple gradients)

**Light**
```
--clay-bg      #E9E1D6   canvas
--clay-surface #F4EEE6   raised
--clay-sunk    #DED4C6   pressed / input grooves
--ink          #1E1A17   text, borders
--ink-soft     #5C5349   secondary text
--terracotta   #C0603C   primary action
--moss         #57694A   success, online, sent
--ochre        #CE9535   warning, unread
--clay-blue    #47606F   links, info
--rust         #A33F2F   destructive
```

**Dark** (warm charcoal, not blue-black)
```
--clay-bg #201D1A  --clay-surface #2B2724  --clay-sunk #171412
--ink #EFE6DA  --ink-soft #A79C8E
(accents lift ~12% luminance)
```

### 3.3 Typography
- **Display / headings:** Bricolage Grotesque — variable, slightly quirky, not Inter/Poppins.
- **Body / UI:** Instrument Sans — clean, warm, high legibility at 14–16px.
- **Numerals, timestamps, codes, call timers:** JetBrains Mono.

Scale: 12 / 14 / 16 / 20 / 26 / 34 / 48. Message body locked at 15.5px / 1.5 line-height.

### 3.4 Motion (Framer Motion)
One spring token everywhere: `{ type: "spring", stiffness: 420, damping: 34 }`.

- Message send — bubble scales from 0.94 with a slight upward drift; the clay shadow settles a beat *after* the bubble, so it feels like weight.
- Slab buttons — press translates 3px right/down and collapses the hard shadow to 0. Physical.
- Panels — slide as clay sheets over the surface, never fade-in-from-nothing.
- Reactions — emoji pops out of the bubble on an arc, not a straight line.
- Typing indicator — three clay dots that *knead* (squash-stretch), not the standard bouncing dots.
- `prefers-reduced-motion` — all of the above collapse to 120ms opacity/position.

**Lottie** used sparingly and only where an SVG can't do it: empty-chat illustration, call-connecting pulse, upload success, push-permission prompt. Muted palette to match tokens — no stock rainbow animations.

### 3.5 Layouts that deliberately break the templates

**Auth — "The Front Door" (no left-text/right-form, no split screen)**
Single centred column, 400px, sitting *low* in the viewport at ~58% height. Above it, an oversized clay Nook mark that reacts to cursor/tilt. Behind everything, a slow-drifting field of blurred clay blobs (CSS only, no video, no particles). Fields are **sunken grooves**, not outlined boxes. The submit button is the one Slab element on screen. On successful login the whole clay panel splits down the middle and slides apart to reveal the app — the door opening. Login/signup/recovery are steps within the same panel, animated as a card stack, not separate routed pages.

**App shell — not a WhatsApp-Web clone**
- Far left: a slim **dock rail** of circular clay avatars (pinned people + groups), with unread as a Slab counter. Hover expands names.
- Left-of-centre: a **shelf drawer** of conversations — collapsible, and collapsed by default on wide screens so the conversation gets the space.
- Centre/right: the conversation itself, edge-to-edge, wearing its own wallpaper.
- Contextual surfaces (profile, media, settings, search) arrive as **clay sheets sliding over** the conversation, not as a permanently docked third column.

**Mobile:** dock becomes a bottom clay bar with 4 chunky targets; conversation is full-screen; sheets become bottom sheets with drag-to-dismiss. Breakpoints 480 / 768 / 1024 / 1440. Every interactive target ≥ 44px.

---

## 4. Feature scope

### Messaging
Text with rich links · images · video · voice notes (waveform record + scrub) · documents · **Snaps** (view-once media, screenshot-detect attempt, auto-burn) · reply-quote · forward · edit window · delete for me / for everyone · star · pin · full-text search · reactions (long-press radial picker, not a flat row) · read receipts (sent / delivered / read) · typing indicators · drafts · disappearing-message timers per chat.

### The wallpaper feature (your headline feature — done properly)
Upload a custom wallpaper for a conversation. It is stored **on the conversation, not the device**, so *both* participants see the same wallpaper. Includes: crop/position editor, auto-extracted dominant colour that tints bubbles and the chat header, a dim/blur slider so text stays readable, a curated set of 12 built-in clay-texture wallpapers, and a "propose wallpaper" flow so the other person can accept or keep their own.

### Groups
Create · name/photo/description · admins · add/remove · mention `@` · reply threads · leave · invite link · group-wide wallpaper.

### Calls
Real WebRTC 1:1 voice and video. Ring screen, accept/decline, mute, camera flip, speaker toggle, in-call timer, minimise-to-pill, call history with missed/incoming/outgoing. Group calls appear in UI as "coming soon" rather than being faked.

### Contacts & privacy
Add by username, block, report, last-seen visibility controls, read-receipt opt-out, profile photo privacy, per-chat mute, archive, PIN-locked chats.

### System
Presence (online / last seen) · Web Push notifications with actions (Reply, Mark read) via service worker · offline queue with retry (IndexedDB) · optimistic sending with a clear failed state · light/dark/system theme · PWA installable · full keyboard navigation · WCAG 2.1 AA contrast on every token pair.

---

## 5. Architecture

```
nook/
├─ client/                     Vite + React 19 + TS
│  ├─ app/                     routes, providers, theme
│  ├─ design/                  tokens.css, clay.css, slab.css, motion.ts
│  ├─ components/              primitives (ClayPanel, SlabButton, Groove…)
│  ├─ features/                auth, chats, message, media, calls,
│  │                           wallpaper, contacts, groups, settings
│  ├─ stores/                  Zustand: auth, chats, messages, presence,
│  │                           calls, ui, drafts
│  ├─ lib/                     socket.ts, api.ts, webrtc.ts, push.ts, idb.ts
│  └─ public/sw.js             service worker (push + offline shell)
│
├─ server/                     Node + Express + Socket.IO
│  ├─ models/                  User, Conversation, Message, Call, Contact,
│  │                           PushSubscription
│  ├─ routes/                  auth, users, conversations, messages,
│  │                           media, push
│  ├─ sockets/                 connection, message, presence, typing,
│  │                           call-signal
│  ├─ services/                cloudinary, brevo, webpush, token
│  └─ middleware/              auth, rateLimit, validate (zod), error
│
└─ docs/  DESIGN.md · API.md · SETUP.md
```

**State (Zustand):** normalised `messages` keyed by conversation; slices persist to IndexedDB for instant cold-start; socket events are the only writer for remote state, UI writes only optimistic entries flagged `pending`.

**Realtime events:** `message:send/new/ack/edit/delete`, `typing:start/stop`, `presence:update`, `receipt:delivered/read`, `reaction:toggle`, `wallpaper:changed`, `call:offer/answer/ice/end/decline`.

**Dev fallbacks so it runs with no keys:** Cloudinary → local `/uploads` disk store · Brevo → codes printed to server console · Web Push → auto-generated VAPID pair on first boot · MongoDB → connection string for a local `mongod` or Atlas.

---

## 6. Delivery phases

| # | Phase | Output |
|---|---|---|
| 0 | Brand & design system | Logo SVG set, `tokens.css`, clay/slab primitives, motion tokens, `DESIGN.md`, static style-guide page reviewed in Chrome |
| 1 | Scaffold | client + server repos, TS config, Tailwind + tokens, Mongo connection, health check |
| 2 | Auth | Username/password, argon2, JWT access+refresh, optional email recovery via Brevo, the "Front Door" screen |
| 3 | App shell | Dock rail, shelf drawer, conversation surface, clay sheets, responsive + theme switch |
| 4 | Core messaging | Socket.IO text messaging, optimistic send, receipts, typing, presence, reply/forward/edit/delete/star/search |
| 5 | Media | Cloudinary upload pipeline, image/video/doc, voice notes with waveform, Snaps (view-once + burn) |
| 6 | Wallpaper | Upload, crop, dominant-colour tint, dim/blur, shared-per-conversation, propose/accept |
| 7 | Groups | Creation, roles, mentions, group wallpaper, member management |
| 8 | Calls | WebRTC 1:1 voice + video, signalling, ring/in-call/minimised UI, call history |
| 9 | Notifications & offline | Service worker, Web Push with actions, offline queue, PWA install |
| 10 | Polish & verify | Lottie passes, a11y audit, motion-performance audit, responsive sweep at 5 widths in Chrome via MCP, README + SETUP |

Each phase ends with the app **actually opened in Chrome** through the MCP browser tools — real screenshots at desktop/tablet/mobile widths, console checked for errors, interactions exercised. Nothing is called done off a code read.

---

## 7. Explicitly not doing
Reels, shorts, stories, public feeds, discovery, follower counts, algorithmic anything, ads, neon/glow palettes, purple-cyan AI gradients, glassmorphism, split-screen auth pages, generic hero sections, stock rainbow Lottie files.

---

## 8. Honest notes
- **E2E encryption is not in scope.** Messages are encrypted in transit (TLS) and access-controlled, but the server can read them. Calling the app "private" is fair on the *no-feeds, no-tracking* axis; if you want cryptographic privacy, that's a dedicated phase (libsignal / MLS) and it materially complicates search, push previews, and multi-device.
- **Snap screenshot detection is unreliable on the web.** We can detect visibility change and blur the media, but a browser cannot truly block a screenshot. It will be presented as a courtesy notice, not a guarantee.
- **WebRTC needs a TURN server** for users behind strict NATs. STUN alone covers maybe 80% of connections. Free option: Open Relay; paid: Twilio/Metered. Flagged as an env var.
- **Free-tier limits:** Render/Railway free instances sleep, which drops sockets. Fine for demo, needs a paid dyno for real use.
