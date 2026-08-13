# Nook — Design System

> **Soft Clay, Hard Edges**

Everything here exists to stop Nook looking like every other chat app. The rules are deliberately narrow: a small palette, two materials, one spring, and layouts that refuse the obvious template.

---

## 1. The one rule

Every surface in Nook is **exactly one of two materials**, and they are never blended.

| | **Clay** | **Slab** |
|---|---|---|
| Role | The world you look at | The things you press |
| Fill | `--clay-surface` / `--clay-raised` | Accent or `--clay-surface` |
| Border | None, ever | `2px solid var(--ink)` |
| Shadow | Dual, soft — light top-left, shade bottom-right | Hard offset, `4px 4px 0`, never blurred |
| Radius | 14–38px | 6px |
| Press | Sinks inward (`--clay-in`) | Translates 4px right/down into its own shadow |

Containers, bubbles, avatars, panels, sheets → **clay**.
Primary buttons, unread counts, badges, toggle thumbs, day markers, focus rings → **slab**.

If you can't decide which a new component is, ask whether the user presses it.

**Why it works:** soft shadows alone read as generic neumorphism; hard offsets alone read as generic neo-brutalism. Restricting each to a specific *job* makes the interface legible — you can tell what's interactive without reading a single label.

---

## 2. Palette

Warm, muted, low-saturation. No neon. No purple-cyan gradient. No glassmorphism.

### Light
```
--clay-bg      #E9E1D6   canvas
--clay-surface #F4EEE6   raised
--clay-raised  #FAF6F0   raised twice (bubbles, panels)
--clay-sunk    #DED4C6   pressed — inputs, wells, tracks
--clay-edge    #CFC2B1   hairlines

--ink          #1E1A17   text and every slab border
--ink-soft     #5C5349   secondary
--ink-faint    #8B8073   tertiary, timestamps
```

### Accents
```
--terracotta  #C0603C    default
--moss        #57694A    success, online, sent
--ochre       #CE9535    warning, snaps, unread
--clay-blue   #47606F    links, read receipts
--rust        #A33F2F    destructive
```

Every accent has a `-deep` variant for text on clay. Use the deep variant whenever the colour carries a word.

### Dark
Warm charcoal, never blue-black — `#201D1A` canvas, `#2B2724` surface, `#EFE6DA` ink. Accents lift ~12% luminance. Clay shadows swap to near-black with a faint warm highlight, so clay still catches light from the top-left.

**Per-person accents.** Each user picks one of five accents; it colours their own UI *and* their name in group conversations, so a busy group stays readable at a glance.

---

## 3. Type

| Role | Face | Notes |
|---|---|---|
| Display, headings, slab labels | **Bricolage Grotesque** | Variable, slightly odd. Deliberately not Inter/Poppins. |
| Body, UI | **Instrument Sans** | Warm, legible at 14–16px. |
| Timestamps, counts, codes, timers | **JetBrains Mono** | Anything numeric is monospaced so it stops jittering. |

Scale: 12 / 13 / 15 / 16 / 20 / 26 / 34 / 48. Message body is locked at **15.5px / 1.5**.

---

## 4. Motion

One spring for the entire app:

```ts
{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }
```

Signature behaviours:

- **Message send** — bubble scales from 0.94 and drifts up; the shadow settles a beat after, so it reads as weight.
- **Slab press** — moves 4px right/down and collapses its shadow to zero. Physical, not decorative.
- **Sheets** — slide over the conversation as clay. They never fade in from nothing.
- **Reactions** — pop out of the bubble along an arc, not a straight line.
- **Typing** — three clay dots that *knead* (squash and stretch), not the standard bounce.
- **Sign-in** — the panel splits down the middle and slides apart. The door opening.

`prefers-reduced-motion` collapses all of it to ~120ms opacity and position.

**Hard-won rule: never gate content on an entrance animation.** A background tab throttles `requestAnimationFrame`, which can freeze an animation mid-flight and leave the UI invisible. The auth panel uses a CSS keyframe with `animation-fill-mode: both`, and `AnimatePresence` uses `initial={false}` so the first paint is never animated.

---

## 5. Layouts that refuse the template

### The Front Door (auth)
Not a split screen. Not left-text/right-form. Not a centred card on a gradient.

A single 400px column sitting **low** in the viewport, an oversized clay mark above it that leans toward the cursor, and a field of slow-drifting blurred clay blobs behind. Inputs are **grooves pressed into the clay**, not outlined boxes. Exactly one slab on screen: the submit button. Sign-in, sign-up and recovery are steps within the same panel, animated as a card stack — not separate routed pages.

On success the panel splits and slides apart, revealing the app.

> The grid here bit us once: giving two children explicit `grid-row: 2` without a column made CSS Grid invent a second column and place them **side by side** — the exact split-screen we were avoiding. Both now live in one `.door-stack`.

### The shell
Not a WhatsApp-Web clone.

- **Dock rail** (76px) — circular clay avatars for pinned and unread conversations, unread as a slab counter, names on hover. Bottom: search, calls, new, you.
- **Shelf** — the conversation list, collapsible, so the conversation gets the room.
- **Surface** — the conversation, edge to edge, wearing its own wallpaper.
- **Sheets** — profile, wallpaper, settings, search arrive as clay panels sliding *over* the conversation. There is no permanently docked third column.

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

## 6. Components worth knowing

**Groove** — the input. Sunken clay, no border, focus adds a 2.5px accent ring inside the existing inset shadow. Chrome's autofill blue is overridden with a 1000px inset box-shadow so autofilled fields stay clay.

**Bubble** — clay, `--clay-raised` incoming, accent outgoing. The first bubble of a run squares off its bottom corner as a tail. The timestamp sits absolutely bottom-right, and `.msg-text::after` injects an inline-block spacer (56px, 74px for your own messages with ticks) so the last line always leaves room. Non-text payloads get `padding-bottom: 24px` via `:has()` instead.

**Media frame** — `min-width: 180px; min-height: 120px` and an `aspect-ratio` from the real image dimensions, which the *client* measures before upload.

> Third one that bit us: `<button>` doesn't pass a percentage height to its children, so the image was 0px tall — and a zero-area lazy image is never "in view", so it never loads, so the box stays zero. Media is now absolutely positioned inside the frame, and the last 12 messages load eagerly.

**Radial reaction picker** — six emoji arc out of the bubble on long-press or right-click, each on a `26°` offset with a 22ms stagger.

**Avatar** — circular for people, squircle for groups. Colour is deterministic from the user id, so someone without a photo always looks the same. The presence dot is a *rotated square*, not a circle — it matches the slab language.

---

## 7. Accessibility

- Focus is a 2.5px solid ink ring at 3px offset — visible on clay *and* on top of a photo wallpaper.
- Every interactive target is ≥ 44px on touch.
- Wallpapers ship with dim and blur sliders precisely so text contrast survives a user's own photo.
- Icons that carry meaning are paired with text or an `aria-label`; decorative SVG is `aria-hidden`.
- Sheets are `role="dialog" aria-modal`, trap Tab, close on Escape, and move focus on open.
- The message stream is `role="log" aria-live="polite"`.
- Nothing relies on hover alone: the bubble toolbar is hover/focus-within on pointer devices and replaced by long-press on touch (`@media (hover: none)`).
