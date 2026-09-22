import type { Transition, Variants } from 'framer-motion';

/*
 * Midnight Pebble motion. Soft, quick, and a little bouncy where something
 * small arrives (a popup, a reaction, a sent bubble) — never where something
 * large does. Every value here has a twin in tokens.css (--dur-*, --ease-*,
 * --press-scale) so a CSS transition and a Framer one side by side move alike.
 *
 * Reduced motion is handled once, by <MotionConfig reducedMotion="user"> in
 * main.tsx: transforms are dropped and only opacity animates.
 */

/** Seconds, matching --dur-fast / --dur-base / --dur-slow. */
export const dur = { fast: 0.16, base: 0.22, slow: 0.32, press: 0.09 } as const;

/**
 * The same curves as the CSS tokens. `clay` is the old overshoot curve's
 * name, kept for anything still importing it; it now means --ease-spring.
 */
export const ease = {
  out: [0.2, 0.9, 0.3, 1] as const,
  in: [0.4, 0, 1, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  spring: [0.3, 1.35, 0.5, 1] as const,
  clay: [0.3, 1.35, 0.5, 1] as const,
};

/** Press feedback: squeeze to this and let go. Matches --press-scale. */
export const pressScale = 0.96;
export const press = { scale: pressScale, transition: { duration: dur.press, ease: ease.out } };

/**
 * The three springs.
 *   pop    — small things arriving: popups, reactions, a sent message.
 *   sheet  — panels: one gentle overshoot (~1%), enough to feel placed.
 *   gentle — anything that should just settle: layout shifts, big moves.
 */
export const springs = {
  pop: { type: 'spring', stiffness: 420, damping: 26 } as Transition,
  sheet: { type: 'spring', stiffness: 380, damping: 32 } as Transition,
  gentle: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
};

/**
 * The app-wide default, imported all over. A touch calmer than `pop` because
 * it also drives layout animations, where a visible bounce reads as jitter.
 */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 30 };
export const springSoft: Transition = springs.gentle;
export const quick: Transition = { duration: dur.fast, ease: ease.out };

export const sheetSpring: Transition = springs.sheet;
/** Leaving is always faster than arriving: nobody waits to watch a close. */
export const sheetOut: Transition = { duration: dur.base, ease: ease.in };

/**
 * Opening a conversation. On a phone it pushes in from the right like a
 * native screen; on a wide layout the pane is already there, so it only
 * settles in — a slide across a desktop would be a lot of movement for a
 * change of content.
 */
export const convoEnter = (phone: boolean) =>
  phone
    ? {
        initial: { x: '100%' },
        animate: { x: 0 },
        transition: { type: 'spring', stiffness: 400, damping: 40 } as Transition,
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: dur.base, ease: ease.out } as Transition,
      };

/** Kept for existing callers; new code should pick bubbleSend / bubbleReceive. */
export const bubbleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: springs.pop },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};

/** Yours: rises out of the composer, growing from the corner nearest you. */
export const bubbleSend: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.9, originX: 1, originY: 1 },
  show: { opacity: 1, y: 0, scale: 1, originX: 1, originY: 1, transition: springs.pop },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};

/** Theirs: slides 12px in from their side and settles — no bounce. */
export const bubbleReceive: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: springs.gentle },
  exit: { opacity: 0, transition: quick },
};

/** Side panels slide over the page. */
export const sheetSlide = {
  initial: { x: '104%', opacity: 0.6 },
  animate: { x: 0, opacity: 1, transition: springs.sheet },
  exit: { x: '104%', opacity: 0.4, transition: sheetOut },
};

/**
 * Bottom sheets rise. The sheet spring overshoots by about 1%, so a sheet
 * should carry a little bottom padding (or background below its edge) to
 * never show a gap under itself at the top of the bounce.
 */
export const sheetSlideUp = {
  initial: { y: '104%' },
  animate: { y: 0, transition: springs.sheet },
  exit: { y: '104%', transition: sheetOut },
};
export const sheetUp: Variants = {
  hidden: { y: '104%' },
  show: { y: 0, transition: springs.sheet },
  exit: { y: '104%', transition: sheetOut },
};

/** Toasts rise in on the spring and drop away quickly (bottom-anchored). */
export const toastIn: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.92 },
  show: { opacity: 1, y: 0, scale: 1, transition: springs.pop },
  exit: { opacity: 0, y: 12, scale: 0.96, transition: { duration: dur.fast, ease: ease.in } },
};

/** Top-anchored toasts and banners drop down from above. */
export const toastDrop: Variants = {
  hidden: { opacity: 0, y: -20, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: springs.pop },
  exit: { opacity: 0, y: -12, transition: { duration: dur.fast, ease: ease.in } },
};

/** Staggered list reveal: 40ms apart, so a list reads as arriving in order. */
export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: springs.gentle },
};

/** The auth card stack. */
export const stepIn: Variants = {
  hidden: (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40, scale: 0.98 }),
  show: { opacity: 1, x: 0, scale: 1, transition: springs.sheet },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40, scale: 0.98, transition: quick }),
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: springs.pop },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};

/**
 * A popup that grows out of the thing that opened it. Pass the corner or
 * edge it is anchored to — a menu under a top-right button is 'top right' —
 * so it unfolds from there instead of from its own middle.
 */
export const popFrom = (origin = 'center'): Variants => ({
  hidden: { opacity: 0, scale: 0.92, transformOrigin: origin },
  show: { opacity: 1, scale: 1, transformOrigin: origin, transition: springs.pop },
  exit: {
    opacity: 0,
    scale: 0.96,
    transformOrigin: origin,
    transition: { duration: dur.fast, ease: ease.in },
  },
});

/** A reaction landing on a bubble: from nothing, past full size, back. */
export const reactionPop: Variants = {
  hidden: { opacity: 0, scale: 0.3 },
  show: { opacity: 1, scale: 1, transition: springs.pop },
  exit: { opacity: 0, scale: 0.5, transition: quick },
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
