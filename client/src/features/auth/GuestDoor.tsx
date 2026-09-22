import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { get, post, setToken, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { openAfterSignIn } from '@/lib/links';
import { IconWarning } from '@/components/Icon';
import type { Me } from '@/lib/types';
import { DoorBackdrop, SubmitFace, ThemeToggle, enterAt, successBeat, useErrorShake } from './FrontDoor';
import Logo from '@/components/Logo';
import { springs } from '@/lib/motion';

/**
 * The page behind a guest link: a name, and you are in.
 *
 * The server makes a throwaway account and hands back a session, so this is
 * sign-up with every field but one removed. The session is then read back
 * through /auth/me because the join response carries only a sketch of the
 * user, and the rest of the app expects settings and the like to be there.
 *
 * It wears the same entrance, backdrop and button as the front door — a
 * guest should not feel they came in through the tradesman's entrance.
 */
export default function GuestDoor({ code, onDone }: { code: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [invite, setInvite] = useState<{ conversationName: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const shake = useErrorShake(error, reduce);

  // Same reasoning as the front door: CSS entrance, class dropped on a timer.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 900);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    get<{ invite: { conversationName: string } }>(`/spaces/guest/${encodeURIComponent(code)}`)
      .then((r) => setInvite(r.invite))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'That link is not valid any more.'));
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await post<{ accessToken: string; conversationId: string }>(
        `/spaces/guest/${encodeURIComponent(code)}/join`,
        { displayName: name.trim() }
      );
      setToken(data.accessToken);
      const { user } = await get<{ user: Me }>('/auth/me');
      // The check shows before the hand-off, because adopt() unmounts us.
      setDone(true);
      await successBeat(reduce);
      openAfterSignIn(data.conversationId);
      useAuth.getState().adopt(user, data.accessToken);
      // Same tick as adopt, so the app never sees "signed in with a guest
      // link still pending" and mistakes the new guest for someone else.
      onDone();
    } catch (err) {
      setDone(false);
      setError(err instanceof ApiError ? err.message : 'Could not join. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className={`door${intro ? ' intro' : ''}`}>
      <DoorBackdrop />
      <ThemeToggle />

      <div className="door-stack">
        <div className="door-mark">
          <div className="door-mark-in">
            <div className="door-bob">
              <Logo size={104} tile={false} animate={!reduce} />
            </div>
            <div className="door-words">
              <span className="door-wordmark">Nook</span>
            </div>
          </div>
        </div>
        <div className="door-rise">
          <motion.div className="door-panel" animate={shake}>
            <form onSubmit={join} noValidate>
              <h1 className="door-heading door-in" style={enterAt(0)}>
                Join {invite?.conversationName || 'the conversation'}
              </h1>
              <p className="door-sub door-in" style={enterAt(1)}>
                No account, no install — just a name the others will see.
              </p>
              <div className="door-fields">
                <label className="field door-in" style={enterAt(2)}>
                  <span className="field-label">What should we call you?</span>
                  <input
                    className="groove"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    autoComplete="name"
                    autoFocus
                  />
                </label>
              </div>
              <AnimatePresence initial={false}>
                {error && (
                  <motion.p
                    key={error}
                    className="field-error"
                    role="status"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1, transition: springs.pop }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  >
                    <IconWarning size={15} />
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="door-actions door-in" style={enterAt(3)}>
                <button
                  className={`slab slab-block door-submit${busy || done ? ' is-busy' : ''}`}
                  type="submit"
                  disabled={!invite || !name.trim() || busy}
                  aria-busy={busy}
                >
                  <SubmitFace
                    state={done ? 'done' : busy ? 'busy' : 'idle'}
                    label="Join as a guest"
                    busyLabel="Joining…"
                  />
                </button>
                <div className="door-switch">
                  <span>Have an account?</span>
                  <button type="button" onClick={onDone}>
                    Sign in
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
