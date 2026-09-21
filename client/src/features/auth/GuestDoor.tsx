import { useEffect, useState } from 'react';
import { get, post, setToken, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { openAfterSignIn } from '@/lib/links';
import { IconWarning } from '@/components/Icon';
import type { Me } from '@/lib/types';

/**
 * The page behind a guest link: a name, and you are in.
 *
 * The server makes a throwaway account and hands back a session, so this is
 * sign-up with every field but one removed. The session is then read back
 * through /auth/me because the join response carries only a sketch of the
 * user, and the rest of the app expects settings and the like to be there.
 */
export default function GuestDoor({ code, onDone }: { code: string; onDone: () => void }) {
  const [invite, setInvite] = useState<{ conversationName: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      openAfterSignIn(data.conversationId);
      useAuth.getState().adopt(user, data.accessToken);
      // Same tick as adopt, so the app never sees "signed in with a guest
      // link still pending" and mistakes the new guest for someone else.
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="door">
      <div className="door-stack">
        <div className="door-mark">
          <img src="/logo.svg" alt="" width={88} height={88} />
          <span className="door-wordmark">Nook</span>
        </div>
        <div className="door-panel">
          <form onSubmit={join} noValidate>
            <h1 className="door-heading">Join {invite?.conversationName || 'the conversation'}</h1>
            <p className="door-sub">No account, no install — just a name the others will see.</p>
            <div className="door-fields">
              <label className="field">
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
            {error && (
              <p className="field-error" role="status">
                <IconWarning size={15} />
                {error}
              </p>
            )}
            <div className="door-actions">
              <button className="slab slab-block" type="submit" disabled={!invite || !name.trim() || busy}>
                {busy ? 'Joining…' : 'Join as a guest'}
              </button>
            </div>
            <div className="door-switch">
              <span>Have an account?</span>
              <button type="button" onClick={onDone}>
                Sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
