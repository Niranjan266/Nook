import type { Transition, Variants } from 'framer-motion';

/** One spring for the whole app. Clay has weight; nothing snaps instantly. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const quick: Transition = { duration: 0.16, ease: [0.22, 0.9, 0.3, 1] };

/** A sent bubble grows from slightly small and drifts up into place. */
export const bubbleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};

/** Sheets arrive as clay sliding over the surface — never a plain fade. */
export const sheetSlide = {
  initial: { x: '108%', opacity: 0.4 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '108%', opacity: 0.3 },
};

export const sheetSlideUp = {
  initial: { y: '104%' },
  animate: { y: 0 },
  exit: { y: '104%' },
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
