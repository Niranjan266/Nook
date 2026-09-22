/**
 * The guided tour: a spotlight that walks a new account around the shell.
 *
 * WHY IT FINDS ITS TARGETS BY data-tour AND NOT BY REFS
 *
 * What it points at lives in DockRail and Shelf, which render differently on a
 * phone, a tablet and a desk — some things twice, some not at all. A selector
 * asks the page what is actually on screen right now, which is the only
 * question that matters; refs would have to be threaded through three layouts
 * that otherwise have no idea the tour exists.
 *
 * WHY A MISSING TARGET BECOMES A CENTRED CARD INSTEAD OF A SKIPPED STEP
 *
 * The step counter says "4 of 7". Silently jumping from 3 to 5 because the
 * chat list happens to be hidden behind an open conversation reads as a bug,
 * and the thing being explained is still true — it is just not on screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { motion, AnimatePresence, useReducedMotion, type Transition } from 'framer-motion';
import { useUi } from '@/stores/ui';
import '@/styles/tour.css';

interface Step {
  /** A `data-tour` value, or null for a card with nothing to point at. */
  target: string | null;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    target: null,
    title: 'Welcome to your Nook',
    body: 'A quick look around — seven stops, well under a minute.',
  },
  {
    target: 'new-chat',
    title: 'Start a conversation',
    body: 'Tap + and type a username or Nook ID. No phone number needed.',
  },
  {
    target: 'search',
    title: 'Find anything',
    body: 'Search every message you have sent or received.',
  },
  {
    target: 'chats',
    title: 'Your chats',
    body: 'Everything lives in the list. Filter by unread, groups or your own folders.',
  },
  {
    target: 'settings',
    title: 'Make it yours',
    body: 'Your profile, Nook ID, privacy, accent colour and theme.',
  },
  {
    target: 'theme',
    title: 'Lights on, lights off',
    body: 'One tap flips between light and dark.',
  },
  {
    target: null,
    title: "You're all set",
    body: 'Go say hello to someone. You can replay this tour from Settings.',
  },
];

const FLAG = (id: string) => `nook.toured.${id}`;

interface TourState {
  open: boolean;
  start: () => void;
  stop: () => void;
}

export const useTour = create<TourState>((set) => ({
  open: false,
  start() {
    const ui = useUi.getState();
    // A sheet over the shell would hide every stop.
    ui.closeSheet();
    // On narrow screens the list is a drawer; open it so "Your chats" has
    // something to point at rather than falling back to a centred card.
    if (window.innerWidth <= 900) ui.setShelf(true);
    set({ open: true });
  },
  stop: () => set({ open: false }),
}));

let pending: number | undefined;

/**
 * Start the tour, optionally after a beat — long enough for whatever was on
 * screen (a closing sheet, the welcome confetti) to finish leaving.
 */
export function startTour(delayMs = 0) {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => useTour.getState().start(), delayMs);
}

/** The automatic run: once per account per device, then never again. */
export function startTourOnce(userId: string, delayMs = 0) {
  try {
    if (localStorage.getItem(FLAG(userId))) return;
    // Marked on start, not finish: a refresh mid-tour should not replay it.
    localStorage.setItem(FLAG(userId), '1');
  } catch {
    return; // private mode: better never than every launch
  }
  startTour(delayMs);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6; // breathing room between the target and the cut-out edge
const GAP = 14; // between the cut-out and the card
const MARGIN = 12; // the card never gets closer than this to the screen edge

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5);

/** The first copy that is actually laid out — desk and phone may both render one. */
function findTarget(name: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

const offscreen = (r: DOMRect) =>
  r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Where the card goes: below or above for most things, beside for the desk
 * rail — a card above the rail's search button would sit on the rail itself.
 * Whatever wins is clamped on-screen, and a card that fits nowhere centres.
 */
function placeCard(t: Rect | null, card: { w: number; h: number }, vw: number, vh: number) {
  const centre = { x: (vw - card.w) / 2, y: (vh - card.h) / 2 };
  if (!t) return centre;

  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const hx = clamp(cx - card.w / 2, MARGIN, vw - card.w - MARGIN);
  const vy = clamp(cy - card.h / 2, MARGIN, vh - card.h - MARGIN);

  const below = { x: hx, y: t.y + t.h + GAP, ok: t.y + t.h + GAP + card.h <= vh - MARGIN };
  const above = { x: hx, y: t.y - GAP - card.h, ok: t.y - GAP - card.h >= MARGIN };
  const right = { x: t.x + t.w + GAP, y: vy, ok: t.x + t.w + GAP + card.w <= vw - MARGIN };
  const left = { x: t.x - GAP - card.w, y: vy, ok: t.x - GAP - card.w >= MARGIN };

  const vertical = cy < vh / 2 ? [below, above] : [above, below];
  const sideways = cx < vw / 2 ? [right, left] : [left, right];
  const order = vw > 640 && t.w < vw * 0.25 && cx < vw * 0.25 ? [...sideways, ...vertical] : [...vertical, ...sideways];

  const pick = order.find((o) => o.ok);
  return pick ? { x: pick.x, y: pick.y } : centre;
}

export default function Tour() {
  const open = useTour((s) => s.open);
  const stop = useTour((s) => s.stop);
  const reduced = useReducedMotion();

  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [card, setCard] = useState({ w: 320, h: 190 });
  // The first placement is instant; springing in from a guessed size looks like a twitch.
  const [settled, setSettled] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef(-1);
  const returnFocus = useRef<HTMLElement | null>(null);

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  // Every run begins at the start — reset before paint so the old step never flashes.
  useLayoutEffect(() => {
    if (!open) return;
    setStep(0);
    setSettled(false);
    scrolledFor.current = -1;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  const measure = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setView((v) => (v.w === vw && v.h === vh ? v : { w: vw, h: vh }));

    const name = STEPS[step].target;
    const el = name ? findTarget(name) : null;
    let next: Rect | null = null;
    if (el) {
      let r = el.getBoundingClientRect();
      if (offscreen(r) && scrolledFor.current !== step) {
        scrolledFor.current = step;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        r = el.getBoundingClientRect();
      }
      if (!offscreen(r)) next = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    setRect((prev) => (sameRect(prev, next) ? prev : next));
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    /**
     * Poll briefly after anything changes. The shelf slides in on the same
     * tick the tour opens, and a resize across the phone breakpoint re-renders
     * the whole shell a frame after the event — a single reading would point
     * at where things were, not where they are.
     */
    const settle = (ms: number) => {
      cancelAnimationFrame(raf);
      const until = performance.now() + ms;
      const tick = () => {
        measure();
        if (performance.now() < until) raf = requestAnimationFrame(tick);
      };
      tick();
    };
    settle(700);
    const onResize = () => settle(350);
    const onScroll = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, measure]);

  // The card's real size, so flipping and clamping use numbers, not guesses.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!open || !el) return;
    const read = () =>
      setCard((c) =>
        c.w === el.offsetWidth && c.h === el.offsetHeight ? c : { w: el.offsetWidth, h: el.offsetHeight }
      );
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const finish = useCallback(() => {
    stop();
    const back = returnFocus.current;
    if (back && document.contains(back)) requestAnimationFrame(() => back.focus());
  }, [stop]);

  const next = useCallback(() => {
    if (last) finish();
    else setStep((s) => s + 1);
  }, [last, finish]);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Keep focus in the card; when the button that had it vanishes (Back on
  // step one), the card itself takes it so the keyboard never falls out.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (el && !el.contains(document.activeElement)) el.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const onButton = (e.target as HTMLElement | null)?.closest?.('button');
      let handled = true;
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      // Enter on a focused button already clicks it; handling it too would advance twice.
      else if (e.key === 'Enter' && !onButton) next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Tab' && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>('button');
        if (!focusable.length) return;
        const first = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        const inside = cardRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) lastEl.focus();
        else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) first.focus();
        else return;
      } else handled = false;
      if (handled) {
        e.preventDefault();
        // Capture phase + stop: the shell's own shortcuts and a sheet's Esc
        // should not also react while the tour has the floor.
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, next, prev, finish]);

  const spot = rect
    ? { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 }
    : { x: view.w / 2, y: view.h / 2, w: 0, h: 0 };
  const small = Math.min(spot.w, spot.h);
  // Round buttons get a round cut-out; anything wider gets a soft rectangle.
  const radius = rect ? (small <= 64 ? small / 2 : 16) : 0;
  const pos = placeCard(rect, card, view.w, view.h);

  const move: Transition =
    reduced || !settled ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.22 }}
        >
          <motion.div
            className="tour-spot"
            aria-hidden="true"
            initial={false}
            animate={{ x: spot.x, y: spot.y, width: spot.w, height: spot.h, borderRadius: radius }}
            transition={move}
          >
            <motion.span
              className={`tour-ring${reduced ? '' : ' pulse'}`}
              initial={false}
              animate={{ opacity: rect ? 1 : 0 }}
              transition={{ duration: 0.18 }}
            />
          </motion.div>

          <motion.div
            ref={cardRef}
            className="tour-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            aria-describedby="tour-body"
            tabIndex={-1}
            initial={false}
            animate={{ x: pos.x, y: pos.y }}
            transition={move}
          >
            <div className="tour-top">
              <span className="eyebrow">
                {step + 1} of {STEPS.length}
              </span>
              <span className="tour-dots" aria-hidden="true">
                {STEPS.map((_, i) => (
                  <span key={i} className={`tour-dot${i === step ? ' on' : i < step ? ' done' : ''}`} />
                ))}
              </span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                aria-live="polite"
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4 }}
                transition={{ duration: 0.14 }}
              >
                <h2 id="tour-title" className="tour-title">
                  {current.title}
                </h2>
                <p id="tour-body" className="tour-body">
                  {current.body}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="tour-foot">
              {!last && (
                <button type="button" className="tour-skip" onClick={finish}>
                  Skip
                </button>
              )}
              <span className="tour-spacer" />
              {step > 0 && (
                <button type="button" className="slab slab-sm slab-quiet" onClick={prev}>
                  Back
                </button>
              )}
              <button type="button" className="slab slab-sm" onClick={next}>
                {last ? "Let's go" : 'Next'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
