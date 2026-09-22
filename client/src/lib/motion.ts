import type { Transition, Variants } from 'framer-motion';

/** One spring for the whole app. Clay has weight; nothing snaps instantly. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const quick: Transition = { duration: 0.16, ease: [0.22, 0.9, 0.3, 1] };

/**
 * The same curves as the CSS tokens (--ease-out, --ease-clay, --ease-in in
 * base.css), so a CSS transition and a Framer one side by side move alike.
 */
export const ease = {
  out: [0.22, 0.9, 0.3, 1] as const,
  clay: [0.34, 1.32, 0.48, 1] as const,
  in: [0.5, 0, 0.75, 0] as const,
};

/**
 * Sheets: quick and springy, but critically damped enough that a 400px panel
 * does not wobble at the end — overshoot on something that large reads as lag.
 */
export const sheetSpring: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 };
/** Leaving is always faster than arriving: nobody waits to watch a close. */
export const sheetOut: Transition = { duration: 0.2, ease: ease.in };

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
        transition: { type: 'spring', stiffness: 430, damping: 44, mass: 0.9 } as Transition,
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.22, ease: ease.out } as Transition,
      };

/** A sent bubble grows from slightly small and drifts up into place. */
export const bubbleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};

/** Sheets arrive as clay sliding over the surface — never a plain fade. */
export const sheetSlide = {
  initial: { x: '108%', opacity: 0.4 },
  animate: { x: 0, opacity: 1, transition: sheetSpring },
  exit: { x: '108%', opacity: 0.3, transition: sheetOut },
};

export const sheetSlideUp = {
  initial: { y: '104%' },
  animate: { y: 0, transition: sheetSpring },
  exit: { y: '104%', transition: sheetOut },
};

/** Toasts rise in on the spring and drop away quickly. */
export const toastIn: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 30 } },
  exit: { opacity: 0, y: 12, scale: 0.94, transition: { duration: 0.16, ease: ease.in } },
};

/** Staggered list reveal for the shelf. */
export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.028, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: spring },
};

/** The auth card stack. */
export const stepIn: Variants = {
  hidden: (dir: number) => ({ opacity: 0, x: dir > 0 ? 44 : -44, scale: 0.985 }),
  show: { opacity: 1, x: 0, scale: 1, transition: spring },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -44 : 44, scale: 0.985, transition: quick }),
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.82 },
  show: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.86, transition: quick },
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
