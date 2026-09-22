# Nook — Design System

> **Midnight Pebble**

Dark-first and high-contrast, but soft. Nook is a small room for a few people, so it should feel like one at night: calm, close, nothing sharp. Every surface is rounded like a stone worn smooth; one electric colour — volt — marks what is *yours*.

The tokens live in `client/src/styles/tokens.css`, the shared materials in `materials.css`, the motion in `client/src/lib/motion.ts`. This file explains them.

---

## 1. The rules

1. **Dark is the default; the phone decides.** The theme follows `prefers-color-scheme` unless someone picks light or dark in Settings. `data-theme` is always set on `<html>` (the inline script in `index.html` before first paint, then `stores/ui.ts`), so `:root` carries the dark values and `:root[data-theme='light']` overrides them.
2. **Surfaces are flat, soft, and quiet.** A fill and one soft shadow. In dark mode a shadow disappears against the night, so surfaces also carry a 1px hairline (`--edge`). No dual neumorphic shadows, no hard borders, no offset shadows, no glass.
3. **Everything you press is a pill** (or a 44px circle for icons). Buttons, chips, inputs, search, segmented controls.
4. **Volt means you.** Your own bubbles are volt in both modes — the one colour that never changes. At night volt is also the primary colour (buttons, active tab, unread); by day that job passes to iris, because volt fails contrast as text or as a button on white.
5. **Colour is never the only signal.** Errors say what went wrong; states have labels or icons.

---

## 2. Colour

Use the semantic names. The fixed hues (`--volt`, `--mint`, `--sky`, `--rose`, `--peach`, `--night`) are for things that must look the same in both modes — avatars, the logo, stickers.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0E0D14` | `#F4F2FB` | Page |
| `--surface` | `#18161F` | `#FFFFFF` | Cards, panels, sheets |
| `--surface-2` | `#22202C` | `#ECE9F8` | Raised bits, inputs, *their* bubbles (dark) |
| `--line` | `#2A2735` | `#E4E0F3` | Hairlines, dividers |
| `--ink` | `#F4F2FA` | `#1F1B2E` | Text |
| `--ink-2` | `#A9A4BA` | `#5E5875` | Secondary text (≥ 4.5:1 on bg) |
| `--ink-3` | `#7D7890` | `#8E88A4` | Icons and decoration **only** — never body text |
| `--primary` | volt `#C8F545` | iris `#5443D6` | Buttons, active tab, unread |
| `--on-primary` | `#0E0D14` | `#FFFFFF` | Text on primary |
| `--primary-ink` | volt | iris | The primary colour used *as text* (links) |
| `--primary-soft` | `#2A3218` | `#E6E2FF` | Selected rows, pressed toggles |
| `--iris` | `#8B7CFF` | `#5443D6` | Secondary accent: focus, selection, highlights |
| `--peach` | `#FFB36B` | `#FFB36B` | Badges, stickers, warm highlights (`--peach-ink` for text) |
| `--danger` / `--danger-ink` | `#FF7A66` | `#D6452F` / `#B23A26` | Fills / text |
| `--success` / `--success-ink` | `#3DD6A8` | `#12A150` / `#0B7A3B` | Fills / text |
| `--bubble-mine` / `-ink` | volt / `#0E0D14` | volt / `#1F1B2E` | Your bubbles |
| `--bubble-theirs` / `-ink` | `#22202C` / ink | `#FFFFFF` / ink | Their bubbles (light adds `--bubble-theirs-shadow`) |

Light-mode `--danger` and `--success` are fills; as text on the page they fall under 4.5:1, which is why the `-ink` variants exist.

### Accents

Each person can pick an accent in Settings; it recolours *their* primary. The stored ids predate this palette and the server validates them, so they stayed and only their meaning changed:

| Stored id | Now | Label |
|---|---|---|
| `terracotta` (the old default) | volt at night / iris by day | Nook |
| `moss` | mint `#3DD6A8` | Mint |
| `ochre` | peach `#FFB36B` | Peach |
| `clay-blue` | sky `#6AA8FF` | Sky |
| `rust` | rose `#FF8FA3` | Rose |

Every accent is a light hue, so text on it is dark (≥ 7:1). In light mode each has a deeper `--primary-ink` for use as text. Avatars without a photo use the same five hues, keyed off the same ids, with night-ink initials.

### Shadows

| Token | Dark | Light |
|---|---|---|
| `--edge` | `inset 0 0 0 1px var(--line)` | nothing |
| `--shadow-1` | `0 6px 20px rgba(0,0,0,.35)` | `0 6px 20px rgba(84,67,214,.08)` |
| `--shadow-2` | hover lift, a step deeper | |
| `--lift` | `0 14px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04)` | `0 10px 34px rgba(84,67,214,.18)` |

Resting surfaces: `var(--edge), var(--shadow-1)`. Popups, menus, sheets: `var(--lift)`. Light-mode shadows are tinted iris, not grey, so they read as depth rather than dirt.

---

## 3. Shape and space

| Token | Value | Use |
|---|---|---|
| `--r-bubble` | 24px | Bubbles — with `--r-bubble-tail` (6px) on the corner nearest the sender |
| `--r-card` | 22px | Cards, panels |
| `--r-sheet` | 28px | Sheets (top corners) |
| `--r-sm` | 12px | Small tiles, thumbnails |
| `--r-pill` | 999px | Buttons, chips, inputs, search |

Spacing is a 4px grid: `--s-1` … `--s-9` = 4, 8, 12, 16, 20, 24, 32, 40, 48. Touch targets are at least `--tap` (44px).

---

## 4. Type

| Role | Face | Weights |
|---|---|---|
| Display (headings, names, wordmark) | **Fredoka** | 500 / 600 / 700 |
| Body and UI | **Nunito** | 400 / 600 / 700 / 800 |
| Code only | JetBrains Mono | 400 / 500 |

Both are rounded, which is most of the "pebble". Loaded with a `<link>` in `index.html` (found at once, unlike a CSS `@import`).

Scale: 12 caption (`--t-xs`) · 13 small (`--t-sm`) · 15 body (`--t-base`) · 17 title (`--t-title`) · 20 (`--t-lg`) · 26 (`--t-xl`) · 34 display (`--t-2xl`). On phones the body steps up to 16px.

Times and counts use `font-variant-numeric: tabular-nums` (the `time` element and `.tabular` class), not a monospace face — a column of times lines up and a ticking timer doesn't jitter.

---

## 5. Motion

Soft, quick, and a little bouncy where something *small* arrives — never where something large does.

| CSS | Value | Framer (`lib/motion.ts`) |
|---|---|---|
| `--dur-fast` / `--dur-base` / `--dur-slow` | 160 / 220 / 320ms | `dur.fast` / `dur.base` / `dur.slow` |
| `--ease-out` | `cubic-bezier(.2,.9,.3,1)` | `ease.out` |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | `ease.in` |
| `--ease-spring` | `cubic-bezier(.3,1.35,.5,1)` | `ease.spring` |
| `--press-scale` / `--dur-press` | .96 / 90ms | `press`, `pressScale` |

Springs:

- **pop** `{ stiffness 420, damping 26 }` — popups, reactions, a sent message.
- **sheet** `{ stiffness 380, damping 32 }` — panels; one gentle ~1% overshoot. Give bottom sheets a little padding below their edge so the bounce never shows a gap.
- **gentle** `{ stiffness 260, damping 30 }` — anything that should just settle.

Ready-made variants: `popIn`, `popFrom(origin)` (grows out of the corner it's anchored to), `sheetSlide`, `sheetSlideUp` / `sheetUp`, `toastIn` (bottom), `toastDrop` (top), `listStagger` + `listItem` (40ms apart), `bubbleSend` (rises from the composer), `bubbleReceive` (slides 12px in from their side), `reactionPop`, `stepIn`, `convoEnter(phone)`. `spring` is the app-wide default (pop, slightly calmer, because it also drives layout animations).

Leaving is always faster than arriving. Presses squeeze to .96 in 90ms and ease back out.

`<MotionConfig reducedMotion="user">` in `main.tsx` drops transforms for people who ask for less motion, and `base.css` collapses CSS animations to nothing.

**Hard-won rule: never gate content on an entrance animation.** A background tab throttles `requestAnimationFrame`, which can freeze an animation mid-flight and leave the UI invisible. The auth panel uses a CSS keyframe with `animation-fill-mode: both`, and `AnimatePresence` uses `initial={false}` so the first paint is never animated.

---

## 6. The mark

**Two pebbles leaning together** — two people, one nook.

On a 48-unit box:

- iris pebble — ellipse at (19, 26), rx 13, ry 15, `#8B7CFF`, in front
- volt pebble — ellipse at (31, 22), rx 11, ry 13, `#C8F545` at 92%, leaning in behind
- eyes — circles r 2 at (16, 25) and (22, 25), in the tile's colour
- the app-icon tile is night `#0E0D14`

The brand colours are fixed, not theme tokens: the mark is the same object in both modes, the way an app icon is.

| Where | File |
|---|---|
| In the app | `<Logo />` (`client/src/components/Logo.tsx`) — `tile`, `size`, `animate`, `title` |
| Web icons | `public/logo.svg`, `favicon.svg`, `icon-maskable.svg`, `logo-mono.svg` |
| Email header | `public/email-logo.png` (144px; mail clients show no SVG) |
| Android | adaptive `drawable/ic_launcher_{background,foreground,monochrome}.xml`, legacy `mipmap-*/ic_launcher*.png`, notification `drawable/ic_stat_nook.xml`, splash `drawable*/splash.png` |

One-colour versions (mono SVG, themed icon, notification icon) cut a sliver out of the back pebble where it meets the front one and punch the eyes out, so the pair still reads as two without colour. Every raster, and the gap path, comes from `tools/android-icons.py` — change the numbers there, in `Logo.tsx` and in `logo.svg` together.

---

## 7. Materials (`materials.css`)

The class names are from the clay era and screens depend on them; the look is new.

| Class | Now |
|---|---|
| `.clay` (+ `.clay-2`, `.clay-3`) | Surface: `--surface`, `--r-card`, `--edge` + `--shadow-1` (`-2` hover depth, `-3` = `--lift`) |
| `.sunk` | Well: `--surface-2`, no inset shadow |
| `.slab` | Primary button: pill, `--primary` / `--on-primary`, no border, presses to .96. `.slab-quiet`, `.slab-danger`, `.slab-sm`, `.slab-block` |
| `.clay-btn` | Secondary button: pill of `--surface-2`; `.on` / `aria-pressed` → `--primary-soft` |
| `.clay-round` | 44px round icon button |
| `.groove` | Input: pill of `--surface-2`; focus is an iris halo (`--ring`); textarea keeps `--r-card` |
| `.seg` / `.seg-item` | Pill track with a raised pill for the choice |
| `.chip` | Small pill; `-quiet`, `-moss` (mint), `-ochre` (peach) |
| `.toggle` | Round thumb in a pill track; on = `--primary` |

### Legacy aliases

Every old token name (`--clay-*`, `--ink-soft`, `--ink-faint`, `--accent*`, `--terracotta`, `--moss`, `--ochre`, `--clay-blue`, `--rust`, `--slab-*`, `--r-clay*`, `--r-slab`, `--dur`, `--ease-clay`) still exists at the bottom of `tokens.css`, pointed at its nearest new token, so screens not yet restyled wear the new palette. They are **being migrated**: don't use them in new code, and delete a line once nothing references it.

---

## 8. Layouts

### The Front Door (auth)
A single 400px column sitting **low** in the viewport, the mark above it leaning toward the cursor, soft blurred blobs drifting behind. Sign-in, sign-up and recovery are steps within the same panel, animated as a card stack — not separate routed pages. On success the panel splits and slides apart, revealing the app.

> The grid here bit us once: giving two children explicit `grid-row: 2` without a column made CSS Grid invent a second column and place them **side by side** — the exact split-screen we were avoiding. Both now live in one `.door-stack`.

### The shell
- **Dock rail** (76px) — round avatars for pinned and unread conversations, unread as a pill counter, names on hover. Bottom: search, calls, new, you.
- **Shelf** — the conversation list, collapsible, so the conversation gets the room.
- **Surface** — the conversation, edge to edge, wearing its own wallpaper.
- **Sheets** — profile, wallpaper, settings, search slide *over* the conversation. There is no permanently docked third column.

### Responsive
| Width | Behaviour |
|---|---|
| > 1180px | Rail + shelf + surface, side by side |
| 900–1180px | Shelf narrows to 268px |
| 640–900px | Shelf becomes a fixed drawer over the surface; back button appears |
| ≤ 640px | Rail becomes a bottom bar; one pane at a time — list *or* conversation; sheets become bottom sheets with a drag handle |

All layout decisions come from `useMediaQuery`, never a one-shot `window.innerWidth` read, so a resize is handled live.

> Another one that bit us: the base `.shelf` rule pinned it to `grid-column: 2`. On phones, where the shell is one column, that made the grid invent a second column and push everything sideways. Reset explicitly in the phone block.

---

## 9. Components worth knowing

**Bubble** — `--r-bubble` with a `--r-bubble-tail` corner nearest the sender; `--bubble-mine` (volt) for yours, `--bubble-theirs` for theirs. The timestamp sits absolutely bottom-right, and `.msg-text::after` injects an inline-block spacer (56px, 74px for your own messages with ticks) so the last line always leaves room. Non-text payloads get `padding-bottom: 24px` via `:has()` instead.

**Media frame** — `min-width: 180px; min-height: 120px` and an `aspect-ratio` from the real image dimensions, which the *client* measures before upload.

> Third one that bit us: `<button>` doesn't pass a percentage height to its children, so the image was 0px tall — and a zero-area lazy image is never "in view", so it never loads, so the box stays zero. Media is now absolutely positioned inside the frame, and the last 12 messages load eagerly.

**Radial reaction picker** — six emoji arc out of the bubble on long-press or right-click, each on a `26°` offset with a 22ms stagger.

**Avatar** — circular for people, squircle for groups. Colour is deterministic from the user id, so someone without a photo always looks the same. The presence dot is a round `--success` dot ringed in the page colour.

---

## 10. Accessibility

- Focus is a 2px iris outline at 3px offset (`:focus-visible` only — never on a tap); inputs show the iris `--ring` halo.
- Every interactive target is ≥ 44px on touch.
- `--ink-3` is for icons and decoration only; secondary text is `--ink-2`. Text-coloured accents use the `-ink` variants in light mode.
- Wallpapers ship with dim and blur sliders precisely so text contrast survives a user's own photo.
- Icons that carry meaning are paired with text or an `aria-label`; decorative SVG is `aria-hidden`.
- Sheets are `role="dialog" aria-modal`, trap Tab, close on Escape, and move focus on open.
- The message stream is `role="log" aria-live="polite"`.
- Nothing relies on hover alone: the bubble toolbar is hover/focus-within on pointer devices and replaced by long-press on touch (`@media (hover: none)`).
