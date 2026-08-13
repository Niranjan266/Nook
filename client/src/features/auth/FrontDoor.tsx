import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useAuth } from '@/stores/auth';
import { get, post, setToken, ApiError } from '@/lib/api';
import { API_BASE } from '@/lib/config';
import { spring, stepIn } from '@/lib/motion';
import { IconCheck, IconWarning } from '@/components/Icon';

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

export default function FrontDoor() {
  const { login, signup } = useAuth();
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
  const [googleOn, setGoogleOn] = useState(false);

  /* Only offer the button if the server can actually honour it — otherwise it
     is a control that leads to a 503, which is worse than no control. */
  useEffect(() => {
    get<{ available: boolean }>('/auth/google/available')
      .then((r) => setGoogleOn(r.available))
      .catch(() => setGoogleOn(false));
  }, []);

  /**
   * Coming back from Google.
   *
   * The callback redirects here with `?g=<one-time code>`. Trade it for a
   * session, then strip it from the URL with replaceState so it never reaches
   * the history stack or a bookmark — it is single-use, but a spent code
   * sitting in the address bar invites someone to try it anyway.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = params.get('g');
    const failed = params.get('google_error');

    if (!handoff && !failed) return;
    window.history.replaceState({}, '', window.location.pathname);

    if (failed) {
      setError(
        failed === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : failed === 'unconfigured'
            ? 'Google sign-in is not set up on this server yet.'
            : 'Google sign-in did not complete. Try again.'
      );
      return;
    }

    setBusy(true);
    post<{ accessToken: string }>('/auth/google/exchange', { code: handoff })
      .then(async (data) => {
        setToken(data.accessToken);
        await useAuth.getState().init();
        await openDoor();
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Google sign-in did not complete. Try again.');
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the mark leans toward the cursor ─────────────────────────────────── */
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [9, -9]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-11, 11]), { stiffness: 150, damping: 18 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [mx, my]);

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
      if (step === 'in') {
        await login(username.trim().toLowerCase(), password);
        await openDoor();
      } else if (step === 'up') {
        await signup({
          username: username.trim().toLowerCase(),
          displayName: displayName.trim() || username.trim(),
          password,
          email: email.trim() || undefined,
        });
        await openDoor();
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
        await useAuth.getState().init();
        await openDoor();
      }
    } catch (err) {
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

  return (
    <div className={`door${opening ? ' opening' : ''}`}>
      <div className="door-blobs" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="door-stack">
        <div className="door-mark">
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

        <div className="door-panel">
          <form onSubmit={submit} noValidate>
          <div className="door-steps">
            {/* initial={false} — never animate the first paint in, or a
                background tab can leave the form invisible until focus */}
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div key={step} custom={dir} variants={stepIn} initial="hidden" animate="show" exit="exit">
                <h1 className="door-heading">{heading.title}</h1>
                <p className="door-sub">{heading.sub}</p>

                <div className="door-fields">
                  {step !== 'reset' && (
                    <label className="field">
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
                      {step === 'up' && avail && (
                        <span className={`door-avail ${avail.ok ? 'ok' : 'no'}`}>
                          {avail.ok ? <IconCheck size={15} /> : <IconWarning size={15} />}
                          {avail.msg}
                        </span>
                      )}
                    </label>
                  )}

                  {step === 'up' && (
                    <label className="field">
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
                    <div className="field">
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
                    <label className="field">
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
                    <label className="field">
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

          {(error || notice) && (
            <motion.p
              className="field-error"
              style={notice && !error ? { color: 'var(--moss-deep)' } : undefined}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
            >
              {error ? <IconWarning size={15} /> : <IconCheck size={15} />}
              {error || notice}
            </motion.p>
          )}

          <div className="door-actions">
            <button className="slab slab-block" type="submit" disabled={!canSubmit || busy}>
              {busy
                ? 'One moment…'
                : step === 'in'
                  ? 'Open the door'
                  : step === 'up'
                    ? 'Make my nook'
                    : step === 'recover'
                      ? 'Send me a code'
                      : 'Set password and go in'}
            </button>

            {/* Only on the two steps where it means something. On "forgot
                password" it would be a non-sequitur, and during a reset the
                person is mid-way through a different flow. */}
            {googleOn && (step === 'in' || step === 'up') && (
              <>
                <div className="door-or" aria-hidden="true">
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="slab slab-quiet slab-block google-btn"
                  onClick={() => {
                    // A full-page navigation, not a popup: popups are blocked
                    // on some mobile browsers and break the back button.
                    window.location.href = `${API_BASE}/api/auth/google/start`;
                  }}
                >
                  <GoogleMark />
                  Continue with Google
                </button>
              </>
            )}

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
          </div>
        </form>
        </div>
      </div>

      <p className="door-note">
        Nook has no feed, no reels, no stories and no strangers. Messages are encrypted in transit
        and never used to train anything.
      </p>

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
