# Nook — roadmap status

Nook is a private messenger for **personal and commercial use**.

**Eight of the ten sections are built and running.** Two are specced rather than built, for reasons given at the bottom and in detail in `ENCRYPTION-AND-LOCAL-FIRST.md`.

| # | Section | Status |
|---|---|---|
| 1 | Trust — end-to-end encryption | **Spec only** — see below |
| 2 | Rooms | ✅ Built |
| 3 | Anti-engagement | ✅ Built |
| 4 | Small things, big affection | ✅ Built |
| 5 | Voice notes | ✅ Built |
| 6 | Media pipeline | ✅ Built |
| 7 | Scale and hardening | ✅ Built |
| 8 | Local-first CRDTs | **Spec only** — see below |
| 9 | Commercial | ✅ Built |
| 10 | Things to skip | ✅ Still skipped, deliberately |

---

## 2. Rooms ✅

A conversation is a *place*, not a list. This is the part nobody else has.

- **Mood** — a shared state visible only inside the room: deep work, away, having a rough week, celebrating, travelling, resting. Optional one-line note, optional expiry. Not a status broadcast to 400 contacts.
- **The wall** — notes, photos and countdowns pinned to the room itself, behind the messages, so they never scroll away. Twelve per room, positioned anywhere.
- **Time of day** — the room wears one look in daylight and another after dark, on a schedule you set. Evaluated client-side so it changes without a round trip.
- **Wallpaper history** — every wallpaper the room has ever worn, with dates, restorable in one tap. A long conversation becomes a visual diary.

## 3. Anti-engagement ✅

Things a big messenger structurally won't build.

- **Mutual quiet hours** — a *contract*, not a personal mute. The other person sees your window before they send, with a one-tap "send when they're up" that schedules for the exact end of it. Push is suppressed inside the window; the message still arrives.
- **Send later** — in an hour, tomorrow morning, or when they wake. Queued server-side, cancellable until it lands.
- **Slow mode** — per person, not per room, so one chatty member can't mute everyone else.
- **Nudge** — once every 24 hours, rate-limited server-side. Scarcity is the feature.
- **No unread badge** by default.

## 4. Small things ✅

- **Collapsible side-threads** — one level deep on purpose. Replies live in the thread, never the main stream, and the root carries a "3 replies" tag.
- **Pinned messages** — up to five, shared by everyone, cycling through one at a time so the pin bar can't become a second inbox.
- **Chat folders** — user-made, stored on *you*, so nobody learns which drawer you filed them in.
- **Swipe to reply** — pointer-driven with rubber-band resistance, a haptic tick at the arm point, and a reply arrow uncovered behind the bubble.
- **Per-person notification sounds** — six tones synthesised with the Web Audio API. No audio files to download, cache or keep in sync.
- **Edit history** — tap "edited" to see every previous version.
- **Export** — a self-contained HTML file, built entirely client-side. Your data genuinely leaves.
- **Link previews** — fetched by *our* server, so your device never touches a URL a stranger sent. SSRF-guarded against private and link-local addresses.

## 5. Voice notes ✅

- **On-device transcription** while you record, shown live in the recorder.
- **Speed control** 1× / 1.5× / 2×, and **skip-silence** that reuses the recorded waveform rather than decoding audio again.
- **Resume** where you left off, per message.

## 6. Media ✅

- **BlurHash** placeholders — ~30 characters inside the message, so the shape of a photo is on screen before a byte of it is requested.
- **Server-side thumbnails** via sharp, including for the local-disk fallback, which previously had none.
- **Client-side compression** — a 12 MB phone photo no longer travels as 12 MB.
- **Shared media grid** — every photo, file and voice note in one place.

## 7. Scale and hardening ✅

- **Optional Redis adapter** for Socket.IO — without it two instances can't see each other's sockets.
- **Windowed message rendering** — 60 at a time, widening as you scroll.
- **Rate limits** on link previews and auth.
- **Time-boxed cache reads** so a wedged IndexedDB can never stall the app.

## 9. Commercial ✅

- **Spaces** — personal life in one, a business in another.
- **Roles** — owner / admin / member / guest, and removing someone revokes their access to every conversation in the space at once.
- **Guest links** — a customer joins one conversation with no account and no install. Expiring and use-capped.
- **Retention rules** — auto-delete after N days, per conversation or space-wide. Starred messages are never swept.
- **Self-hosting** — `docker compose up -d`. Your server, your data, nothing phoning home.

## 10. Still skipped, deliberately ✅

SFU group calls, stickers and GIF search, a native app, AI summarisers, and anything resembling discovery or "people you may know" — the last one especially, because adding it rebuilds exactly what Nook exists to avoid.

---

## 1 and 8 — specced, not built

I could have produced something that *looked* like both in the time available. I don't think that would have served you.

**End-to-end encryption** is 3–5 weeks and it rewrites search, push notifications, media handling and multi-device. A half-implementation is worse than none, because "encrypted" becomes a claim you can't stand behind. Everything built above was designed to survive it: transcription is on-device, link previews are server-side by design, export is client-side, media dimensions are measured in the browser.

**Local-first CRDTs** replace the data layer outright. Bolting Yjs alongside the current store gives you the costs of both models and the benefits of neither.

Full specs — data model, order of work, what breaks, and the traps — are in **`ENCRYPTION-AND-LOCAL-FIRST.md`**. Both are written so someone can start from them directly.

**Do encryption first.** It's the one thing standing between "private because there's no feed" and "private because we can't read it either."
