import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  motion,
  AnimatePresence,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { get, post, setToken, ApiError } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { quick } from '@/lib/motion';
import { IconCheck, IconWarning, IconDownload, IconSun, IconMoon } from '@/components/Icon';
import { startGoogleSignIn, bindDeepLinks } from '@/lib/native';
import type { Me } from '@/lib/types';

type Step = 'in' | 'up' | 'recover' | 'reset';

/**
 * Google's mark, inline.
 *
 * Their brand guidelines require the four-colour "G" on a sign-in control, and
 * it is the one part of this screen that cannot be redrawn in our palette. The
 * rest of the button is ours — Slab shape, our type, our spacing — so it reads
 * as a Nook control that happens to carry Google's mark, rather than Google's
 * button dropped into someone else's design.
 */
const GoogleMark = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"
    />
    <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5A22 22 0 0 0 2 24c0 3.6.9 6.9 2.5 9.9l7.3-5.7z" />
    <path
      fill="#EA4335"
      d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
    />
  </svg>
);

const HEADINGS: Record<Step, { title: string; sub: string }> = {
  in: { title: 'Welcome back', sub: 'Your corner is exactly where you left it.' },
  up: { title: 'Make a nook', sub: 'A username is all you need. Email is optional, always.' },
  recover: { title: 'Locked out', sub: "We'll email a code, if you added an address." },
  reset: { title: 'Pick a new password', sub: 'Then you are straight back in.' },
};

function strength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  return Math.min(score, 4);
}

/**
 * Whether to offer the APK. Computed once outside the component: it cannot
 * change while the page is open, and re-deriving it on every render would be
 * work for an answer that never moves.
 */
const showApp =
  typeof navigator !== 'undefined' &&
  /Android/i.test(navigator.userAgent) &&
  !(window as any).Capacitor?.isNativePlatform?.();

/* ── shared door pieces ──────────────────────────────────────────────────────
   Exported for GuestDoor, which is the same room with fewer fields. They live
   here rather than in a new module so the two doors cannot drift apart. */

/** How long the check holds before the app takes over. Long enough to be
    seen, short enough that nobody waits on it. */
const SUCCESS_BEAT = 340;

/** Hold the success face for a beat. Reduced motion still gets a glimpse,
    just a shorter one — the point is confirmation, not choreography. */
export const successBeat = (reduce: boolean | null) =>
  new Promise<void>((resolve) => setTimeout(resolve, reduce ? 160 : SUCCESS_BEAT));

/** Stagger index for the entrance, read by the CSS as --i. */
export const enterAt = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * The card resizes with a spring rather than the app's default, which is
 * tuned for bubbles: a whole card overshooting reads as wobble, not weight.
 */
const layoutSpring: Transition = { type: 'spring', stiffness: 460, damping: 42, mass: 0.9 };

/** A short, decaying shake. Horizontal only — a nod "no", never a jolt. */
const SHAKE = { x: [0, -9, 8, -5, 3, 0], transition: { duration: 0.36, ease: 'easeOut' } };

/**
 * The cause of an error has to be seen, so the card shakes when one arrives.
 * Keyed on the message: submit clears it first, so the same mistake twice
 * still shakes twice.
 */
export function useErrorShake(error: string, reduce: boolean | null) {
  const controls = useAnimationControls();
  useEffect(() => {
    if (error && !reduce) controls.start(SHAKE);
  }, [error, reduce, controls]);
  return controls;
}

/** Slow clay blobs behind everything. Transform-only, so the GPU does it. */
export const DoorBackdrop = () => (
  <div className="door-blobs" aria-hidden="true">
    <span />
    <span />
    <span />
    <span />
  </div>
);

/**
 * What the theme looks like right now, including when it is left to the
 * system. The store only knows the preference; this follows the OS as well,
 * so the icon never shows a sun over a dark screen.
 */
function useResolvedDark() {
  const theme = useUi((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}

/**
 * Light/dark, before you are even in. Choosing sets an explicit theme — a
 * person who taps it has made a choice, and "system" would quietly undo it
 * the next time the OS flips. Both icons stay mounted and swap in CSS, so the
 * rotation costs nothing and never needs a render to finish.
 */
export function ThemeToggle() {
  const dark = useResolvedDark();
  const setTheme = useUi((s) => s.setTheme);
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className="door-theme"
      data-dark={dark ? 'true' : 'false'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
    >
      <IconSun className="door-theme-sun" size={20} />
      <IconMoon className="door-theme-moon" size={20} />
    </button>
  );
}

/**
 * The inside of a submit button: label, working dots and the success check
 * stacked in one grid cell. Stacking — not swapping — is what keeps the
 * button exactly the same size through every state, so nothing below it moves.
 */
export function SubmitFace({
  state,
  label,
  busyLabel = 'One moment…',
}: {
  state: 'idle' | 'busy' | 'done';
  label: string;
  busyLabel?: string;
}) {
  return (
    <span className="door-face" data-state={state}>
      <span className="door-face-label">{label}</span>
      <span className="door-face-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="door-face-done" aria-hidden="true">
        <IconCheck size={22} strokeWidth={2.6} />
      </span>
      <span className="sr-only" aria-live="polite">
        {state === 'busy' ? busyLabel : state === 'done' ? 'Signed in' : ''}
      </span>
    </span>
  );
}

/**
 * Steps slide in the direction of travel. Opacity runs on its own short
 * clock so the old step is gone before the new one has finished settling —
 * two half-visible forms at once reads as a glitch.
 */
const stepSlide: Variants = {
  hidden: (dir: number) => ({ opacity: 0, x: dir > 0 ? 28 : -28 }),
  show: {
    opacity: 1,
    x: 0,
    transition: { x: { type: 'spring', stiffness: 420, damping: 36 }, opacity: { duration: 0.2 } },
  },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -28 : 28, transition: quick }),
};

/** Reduced motion: the same change, without the travel. */
const stepFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export default function FrontDoor() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>('in');
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [avail, setAvail] = useState<{ ok: boolean; msg: string } | null>(null);
  const [googleOn, setGoogleOn] = useState(true);
  const [done, setDone] = useState(false);

  /* The entrance runs on CSS keyed off this class, then the class goes.
     CSS rather than framer because it plays even in a background tab, and
     dropping the class on a timer means nothing can be left stuck at
     opacity 0 — worst case, it simply appears. */
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 900);
    return () => window.clearTimeout(t);
  }, []);

  const shake = useErrorShake(error, reduce);
  const layoutOn = !reduce;
  const layoutT = { layout: layoutSpring };

  /* Shown straight away and hidden only when the server says it is not set up.
     Waiting for the answer first meant a sleeping server — a minute and more
     to wake — hid the button, and a timed-out check hid it for good. */
  useEffect(() => {
    get<{ available: boolean }>('/auth/google/available')
      .then((r) => setGoogleOn(r.available !== false))
      .catch(() => {
        /* unreachable is not "not configured" — keep offering it */
      });
  }, []);

  /**
   * Coming back from Google.
   *
   * The callback redirects here with `?g=<one-time code>`. Trade it for a
   * session, then strip it from the URL with replaceState so it never reaches
   * the history stack or a bookmark — it is single-use, but a spent code
   * sitting in the address bar invites someone to try it anyway.
   */
  /**
   * One place that turns a handoff code into a session, because it now arrives
   * two ways: as `?g=` in the address bar on the web, and as a `nook://auth`
   * deep link in the Android app. Duplicating it would mean fixing sign-in
   * twice, and forgetting one of them.
   */
  const redeem = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const data = await post<{ user: any; accessToken: string }>('/auth/google/exchange', {
          code,
        });
        // The exchange returns the user with the token, so adopt the session
        // outright. Calling init() here would throw away this token whenever
        // the refresh cookie is cross-site and the browser dropped it — and
        // then play the door animation over a screen nobody had signed into,
        // which is what left the page blank.
        useAuth.getState().adopt(data.user, data.accessToken);
        await openDoor();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Google sign-in did not complete. Try again.');
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const explain = useCallback((failed: string) => {
    setBusy(false);
    setError(
      failed === 'access_denied'
        ? 'Google sign-in was cancelled.'
        : failed === 'unconfigured'
          ? 'Google sign-in is not set up on this server yet.'
          : 'Google sign-in did not complete. Try again.'
    );
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = params.get('g');
    const failed = params.get('google_error');

    if (!handoff && !failed) return;
    window.history.replaceState({}, '', window.location.pathname);

    if (failed) return explain(failed);
    redeem(handoff!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The app's half of the same flow.
   *
   * Google refuses embedded web views, so the sign-in runs in a real browser
   * and the result has to be handed back. Without this the browser kept the
   * session and the app stayed signed out with nothing to explain it.
   */
  useEffect(() => {
    return bindDeepLinks(redeem, explain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the mark leans toward the cursor ─────────────────────────────────── */
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [9, -9]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-11, 11]), { stiffness: 150, damping: 18 });

  useEffect(() => {
    // Motion nobody asked for, driven by the pointer — the first thing to go.
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [mx, my, reduce]);

  /* ── username availability ────────────────────────────────────────────── */
  const availTimer = useRef<number>();
  useEffect(() => {
    if (step !== 'up' || username.length < 3) return setAvail(null);
    window.clearTimeout(availTimer.current);
    availTimer.current = window.setTimeout(async () => {
      try {
        const res = await get<{ available: boolean; reason: string }>(
          `/auth/available/${encodeURIComponent(username)}`
        );
        setAvail({ ok: res.available, msg: res.available ? `nook.app/${username} is free` : res.reason });
      } catch {
        setAvail(null);
      }
    }, 380);
    return () => window.clearTimeout(availTimer.current);
  }, [username, step]);

  const go = (next: Step) => {
    setDir(['in', 'up', 'recover', 'reset'].indexOf(next) > ['in', 'up', 'recover', 'reset'].indexOf(step) ? 1 : -1);
    setError('');
    setNotice('');
    setStep(next);
  };

  /** The door opens: the panel splits and slides apart, then the app mounts. */
  const openDoor = () =>
    new Promise<void>((resolve) => {
      setOpening(true);
      setTimeout(resolve, 620);
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      /*
       * Sign-in and sign-up call the endpoints here and hand the session to
       * the store with adopt(), rather than going through login()/signup().
       * Those set status 'in' the moment the request lands, which unmounts
       * this screen in the same tick — the check would never be seen. adopt()
       * is exactly what they do (setToken + me + status), just a beat later.
       * If the store's login ever grows extra steps, mirror them here.
       */
      if (step === 'in') {
        const data = await post<{ user: Me; accessToken: string }>('/auth/login', {
          username: username.trim().toLowerCase(),
          password,
        });
        setDone(true);
        await successBeat(reduce);
        useAuth.getState().adopt(data.user, data.accessToken);
      } else if (step === 'up') {
        const data = await post<{ user: Me; accessToken: string }>('/auth/signup', {
          username: username.trim().toLowerCase(),
          displayName: displayName.trim() || username.trim(),
          password,
          email: email.trim() || undefined,
        });
        setDone(true);
        await successBeat(reduce);
        useAuth.getState().adopt(data.user, data.accessToken);
      } else if (step === 'recover') {
        const res = await post<{ message: string }>('/auth/recover', {
          username: username.trim().toLowerCase(),
        });
        setNotice(res.message);
        go('reset');
      } else {
        const data = await post<{ accessToken: string }>('/auth/recover/reset', {
          username: username.trim().toLowerCase(),
          code,
          password,
        });
        setToken(data.accessToken);
        setDone(true);
        await successBeat(reduce);
        await useAuth.getState().init();
        // init() failing leaves us mounted; do not leave a check on a door
        // that did not open.
        setDone(false);
        await openDoor();
      }
    } catch (err) {
      setDone(false);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const canSubmit =
    step === 'in'
      ? username.length >= 3 && password.length >= 1
      : step === 'up'
        ? username.length >= 3 && password.length >= 8 && avail?.ok !== false
        : step === 'recover'
          ? username.length >= 3
          : code.length === 6 && password.length >= 8;

  const heading = HEADINGS[step];
  const pw = strength(password);

  const faceState = done ? 'done' : busy ? 'busy' : 'idle';

  return (
    <div className={`door${opening ? ' opening' : ''}${intro ? ' intro' : ''}`}>
      <DoorBackdrop />
      <ThemeToggle />

      <div className="door-stack">
        {/* layout="position": when the card grows or shrinks the column
            re-centres, and the mark should glide with it, not jump. */}
        <motion.div className="door-mark" layout={layoutOn ? 'position' : false} transition={layoutT}>
          <div className="door-mark-in">
            <motion.img
              src="/logo.svg"
              alt=""
              width={104}
              height={104}
              style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
            />
            <div className="stack" style={{ alignItems: 'center', gap: 2 }}>
              <span className="door-wordmark">Nook</span>
              <span className="door-tagline">Your corner of the internet.</span>
            </div>
          </div>
        </motion.div>

        {/* The entrance rises on this wrapper, the card itself resizes and
            shakes. Separate elements, because a CSS animation and framer
            writing the same element's transform would fight. */}
        <div className="door-rise">
          <motion.div
            className="door-panel"
            layout={layoutOn}
            animate={shake}
            transition={layoutT}
            // Set inline so framer can correct the corners while the card
            // scales; a radius only in CSS would squash mid-resize.
            style={{ borderRadius: 38 }}
          >
            <form onSubmit={submit} noValidate>
              <div className="door-steps">
                {/* initial={false} — never animate the first paint in, or a
                    background tab can leave the form invisible until focus.
                    popLayout lifts the leaving step out of the flow, so the
                    card resizes straight to the new step's height instead of
                    holding the old one until the exit finishes. */}
                <AnimatePresence mode="popLayout" custom={dir} initial={false}>
                  <motion.div
                    key={step}
                    custom={dir}
                    variants={reduce ? stepFade : stepSlide}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    layout={layoutOn ? 'position' : false}
                    transition={layoutT}
                  >
                    <h1 className="door-heading door-in" style={enterAt(0)}>
                      {heading.title}
                    </h1>
                    <p className="door-sub door-in" style={enterAt(1)}>
                      {heading.sub}
                    </p>

                    <div className="door-fields">
                      {step !== 'reset' && (
                        <label className="field door-in" style={enterAt(2)}>
                          <span className="field-label">Username</span>
                          <input
                            className="groove"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase())}
                            placeholder="riverbend"
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={20}
                            required
                          />
                          <AnimatePresence initial={false}>
                            {step === 'up' && avail && (
                              <motion.span
                                key={avail.ok ? 'ok' : 'no'}
                                className={`door-avail ${avail.ok ? 'ok' : 'no'}`}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                              >
                                {avail.ok ? <IconCheck size={15} /> : <IconWarning size={15} />}
                                {avail.msg}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </label>
                      )}

                      {step === 'up' && (
                        <label className="field door-in" style={enterAt(3)}>
                          <span className="field-label">What should people call you?</span>
                          <input
                            className="groove"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="River Bend"
                            autoComplete="name"
                            maxLength={40}
                          />
                        </label>
                      )}

                      {step === 'reset' && (
                        <div className="field door-in" style={enterAt(2)}>
                          <span className="field-label">Six-digit code</span>
                          <div className="code-row">
                            {Array.from({ length: 6 }).map((_, i) => (
                              <input
                                key={i}
                                className="groove"
                                inputMode="numeric"
                                maxLength={1}
                                value={code[i] || ''}
                                aria-label={`Digit ${i + 1}`}
                                onChange={(e) => {
                                  const v = e.target.value.replace(/\D/g, '');
                                  const next = (code.slice(0, i) + v + code.slice(i + 1)).slice(0, 6);
                                  setCode(next);
                                  if (v) (e.target.nextElementSibling as HTMLInputElement)?.focus();
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Backspace' && !code[i]) {
                                    const prev = (e.currentTarget.previousElementSibling as HTMLInputElement) || null;
                                    prev?.focus();
                                    setCode(code.slice(0, Math.max(0, i - 1)));
                                  }
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {step !== 'recover' && (
                        <label className="field door-in" style={enterAt(step === 'up' ? 4 : 3)}>
                          <span className="field-label">
                            {step === 'in' ? 'Password' : step === 'reset' ? 'New password' : 'Password'}
                          </span>
                          <input
                            className="groove"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete={step === 'in' ? 'current-password' : 'new-password'}
                            required
                          />
                          {step !== 'in' && password.length > 0 && (
                            <div className="strength" aria-hidden="true">
                              {[0, 1, 2, 3].map((i) => (
                                <i key={i} className={i < pw ? (pw < 3 ? 'warn' : 'on') : ''} />
                              ))}
                            </div>
                          )}
                        </label>
                      )}

                      {step === 'up' && (
                        <label className="field door-in" style={enterAt(5)}>
                          <span className="field-label">Email — optional, for recovery only</span>
                          <input
                            className="groove"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                          />
                        </label>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              <AnimatePresence mode="popLayout" initial={false}>
                {(error || notice) && (
                  <motion.p
                    key={error ? `e:${error}` : `n:${notice}`}
                    className={`field-error${notice && !error ? ' field-notice' : ''}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 0.9, 0.3, 1] } }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    layout={layoutOn ? 'position' : false}
                    transition={layoutT}
                    role="status"
                  >
                    {error ? <IconWarning size={15} /> : <IconCheck size={15} />}
                    {error || notice}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.div
                className="door-actions door-in"
                style={enterAt(5)}
                layout={layoutOn ? 'position' : false}
                transition={layoutT}
              >
                <button
                  className={`slab slab-block door-submit${busy || done ? ' is-busy' : ''}`}
                  type="submit"
                  disabled={!canSubmit || busy}
                  aria-busy={busy}
                >
                  <SubmitFace
                    state={faceState}
                    label={
                      step === 'in'
                        ? 'Open the door'
                        : step === 'up'
                          ? 'Make my nook'
                          : step === 'recover'
                            ? 'Send me a code'
                            : 'Set password and go in'
                    }
                  />
                </button>

                {/* Only on the two steps where it means something. On "forgot
                    password" it would be a non-sequitur, and during a reset the
                    person is mid-way through a different flow. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {googleOn && (step === 'in' || step === 'up') && (
                    <motion.div
                      key="google"
                      className="door-google"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    >
                      <div className="door-or" aria-hidden="true">
                        <span>or</span>
                      </div>
                      <button
                        type="button"
                        className="slab slab-quiet slab-block google-btn"
                        onClick={() => {
                          // A full-page navigation, not a popup: popups are blocked
                          // on some mobile browsers and break the back button.
                          // In the app this opens a Custom Tab and comes back
                          // through nook://auth; in a browser it is an ordinary
                          // navigation. `startGoogleSignIn` says which happened.
                          startGoogleSignIn(API_BASE).then((handled) => {
                            if (!handled) window.location.href = `${API_BASE}/api/auth/google/start`;
                          });
                        }}
                      >
                        <GoogleMark />
                        Continue with Google
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="door-switch">
                  {step === 'in' && (
                    <>
                      <span>New here?</span>
                      <button type="button" onClick={() => go('up')}>
                        Make a nook
                      </button>
                      <span aria-hidden="true">·</span>
                      <button type="button" onClick={() => go('recover')}>
                        Forgot password
                      </button>
                    </>
                  )}
                  {step === 'up' && (
                    <>
                      <span>Already have one?</span>
                      <button type="button" onClick={() => go('in')}>
                        Sign in
                      </button>
                    </>
                  )}
                  {(step === 'recover' || step === 'reset') && (
                    <button type="button" onClick={() => go('in')}>
                      Back to sign in
                    </button>
                  )}
                </div>
              </motion.div>
            </form>
          </motion.div>
        </div>
      </div>

      <p className="door-note">
        Nook has no feed, no reels, no stories and no strangers. Messages are encrypted in transit
        and never used to train anything.
      </p>

      {/*
        Only on Android, and only in a browser. The APK is useless on a desktop
        or an iPhone, and offering a download that cannot be installed is worse
        than not mentioning it — so this asks the one question that decides it
        rather than showing everyone a link most of them cannot use.
      */}
      {showApp && (
        <a className="door-app" href="/download">
          <IconDownload size={15} />
          <span>Get the Android app — notifications on a locked phone</span>
        </a>
      )}

      {/* the door opening */}
      <AnimatePresence>
        {opening && (
          <>
            <motion.div
              className="door-leaf left"
              initial={{ clipPath: 'inset(0 50% 0 0)', x: 0 }}
              animate={{ clipPath: 'inset(0 50% 0 0)', x: '-100%' }}
              transition={{ duration: 0.62, ease: [0.7, 0, 0.3, 1] }}
            />
            <motion.div
              className="door-leaf right"
              initial={{ clipPath: 'inset(0 0 0 50%)', x: 0 }}
              animate={{ clipPath: 'inset(0 0 0 50%)', x: '100%' }}
              transition={{ duration: 0.62, ease: [0.7, 0, 0.3, 1] }}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
