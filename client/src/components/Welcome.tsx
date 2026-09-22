/**
 * The welcome, shown exactly once, to an account that did not exist a moment
 * ago.
 *
 * WHY IT TRIGGERS ON createdAt RATHER THAN ON THE SIGNUP FLOW
 *
 * There are two front doors — the form and Google — and Google's finishes in
 * three different places depending on platform (query param, deep link, cold
 * start). Hooking "just signed up" into each of those means four places to
 * keep agreeing, and the deep-link one would be missed the first time it was
 * ever exercised. `createdAt` is one fact from one endpoint that is true
 * however the account arrived: if the account is minutes old when the app
 * first meets it, this person just signed up. A localStorage flag keeps it to
 * once per device, so a refresh straight after signing up does not repeat it.
 *
 * WHY FRAMER MOTION AND NOT A 3D OR LOTTIE RUNTIME
 *
 * This appears once, for a few seconds, to every new person — which means it
 * loads for every new person, on the connection they happened to sign up on.
 * Three.js is ~600KB and a Lottie player ~60KB before any animation file, all
 * to decorate a moment the app already owns the tools for: Framer Motion is
 * in the bundle powering everything else, and the confetti is two dozen coloured
 * shards it animates for free. The first thing a new account sees should not
 * be a loading spinner for its own welcome.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import Logo from '@/components/Logo';
import { springs, dur } from '@/lib/motion';

const FLAG = (id: string) => `nook.welcomed.${id}`;

/** An account this much older than "now" is signing in, not signing up. */
const FRESH_MS = 10 * 60 * 1000;

const QUOTES = [
  'Small rooms make room for real talk.',
  'The best conversations happen in corners.',
  'No feed. No strangers. Just your people.',
  'A quiet corner of the internet, kept for you.',
  'Fewer people, better conversations.',
  'Every good story starts in a nook.',
];

/** The Midnight Pebble palette, for the confetti. */
const SHARD_COLOURS = ['#C8F545', '#8B7CFF', '#FFB36B', '#3DD6A8', '#6AA8FF', '#FF8FA3'];

export function shouldWelcome(me: { id: string; createdAt?: string | null } | null): boolean {
  if (!me?.createdAt) return false;
  const age = Date.now() - new Date(me.createdAt).getTime();
  if (!(age >= 0 && age < FRESH_MS)) return false;
  try {
    return !localStorage.getItem(FLAG(me.id));
  } catch {
    return false; // private mode: better never than every launch
  }
}

interface Props {
  open: boolean;
  name: string;
  userId: string;
  onClose: () => void;
}

export default function Welcome({ open, name, userId, onClose }: Props) {
  const reduced = useReducedMotion();
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);

  /**
   * The confetti burst: each shard gets a random trajectory once, up front.
   * Generated lazily so the math never runs for people who never see this.
   */
  const shards = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 340,
        y: -(120 + Math.random() * 220),
        fall: 260 + Math.random() * 160,
        rotate: (Math.random() - 0.5) * 540,
        size: 7 + Math.random() * 9,
        round: Math.random() > 0.5,
        colour: SHARD_COLOURS[i % SHARD_COLOURS.length],
        delay: 0.35 + Math.random() * 0.25,
      })),
    []
  );

  const dismiss = () => {
    try {
      localStorage.setItem(FLAG(userId), String(Date.now()));
    } catch {
      /* private mode — it will simply not repeat this session */
    }
    onClose();
  };

  // The moment deserves attention, but not hostage-taking: Escape leaves too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const firstName = (name || 'friend').split(' ')[0];
  const words = `Welcome to your nook, ${firstName}`.split(' ');

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="welcome-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.base }}
        >
          <motion.div
            className="welcome-card"
            // A large thing arriving: it settles on the sheet spring rather
            // than bouncing; the small things inside it get the bounce.
            initial={{ scale: 0.92, y: 32, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 16, opacity: 0, transition: { duration: dur.fast } }}
            transition={springs.sheet}
          >
            {/* Confetti, from behind the mark. Skipped entirely for people who
                asked their OS for less motion — for them this is a calm card,
                which is its own kind of welcome. */}
            {!reduced &&
              shards.map((s) => (
                <motion.span
                  key={s.id}
                  className="welcome-shard"
                  style={{
                    width: s.size,
                    height: s.round ? s.size : s.size * 0.55,
                    borderRadius: s.round ? '50%' : 2,
                    background: s.colour,
                  }}
                  initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
                  animate={{
                    x: s.x,
                    y: [0, s.y, s.y + s.fall],
                    opacity: [0, 1, 1, 0],
                    rotate: s.rotate,
                    scale: 1,
                  }}
                  transition={{ duration: 1.9, delay: s.delay, ease: [0.16, 0.6, 0.4, 1] }}
                />
              ))}

            {/* The mark. The tile lands, then the pebbles arrive one after the
                other — two people finding the same corner, the logo's own story. */}
            <motion.div
              style={{ lineHeight: 0 }}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...springs.pop, delay: 0.15 }}
            >
              <Logo size={76} animate={!reduced} />
            </motion.div>

            {/* The greeting, a word at a time — arriving, not just appearing. */}
            <h2 className="welcome-title" aria-label={words.join(' ')}>
              {words.map((word, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: reduced ? 0 : 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.gentle, delay: 0.5 + i * 0.07 }}
                >
                  {word}
                  {i < words.length - 1 ? ' ' : ''}
                </motion.span>
              ))}
            </h2>

            <motion.p
              className="welcome-quote"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.0, duration: 0.5 }}
            >
              “{quote}”
            </motion.p>

            <motion.button
              className="slab welcome-go"
              onClick={dismiss}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.pop, delay: 1.2 }}
              whileTap={{ scale: 0.96 }}
            >
              Step inside
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
