/**
 * One account, opened from the table.
 *
 * A drawer rather than a separate page: you are working through a list, and
 * losing your place in it every time you look at somebody is the thing that
 * makes admin tools tiring to use.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import {
  adminGet,
  adminPost,
  adminPatch,
  adminDelete,
  IMPERSONATE_KEY,
  type AdminUserDetail,
} from '@/lib/adminApi';
import { IconClose, IconWarning, IconCheck, IconLock, IconTrash, IconLogOut } from '@/components/Icon';

const when = (ms: number) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';

export default function UserPanel({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = () =>
    adminGet<AdminUserDetail>(`/users/${userId}`)
      .then(setUser)
      .catch((e) => setError(e.message));

  useEffect(() => {
    setUser(null);
    setError('');
    setConfirmingDelete(false);
    setConfirmText('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  /** Hand a real session for this account to the main app, and go there. */
  const openAccount = async () => {
    setBusy('open');
    setError('');
    try {
      const { accessToken } = await adminPost<{ accessToken: string }>(`/users/${userId}/open`);
      sessionStorage.setItem(IMPERSONATE_KEY, accessToken);
      window.location.href = '/';
    } catch (e: any) {
      setError(e.message || 'Could not open that account.');
      setBusy('');
    }
  };

  const peak = Math.max(1, ...(user?.activity || []).map((a) => a.count));

  return (
    <>
      <motion.div
        className="admin-scrim"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="admin-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={spring}
        role="dialog"
        aria-label="Account"
      >
        <header className="admin-drawer-head">
          <span className="eyebrow">Account</span>
          <span className="grow" />
          <button className="clay-round" onClick={onClose} aria-label="Close">
            <IconClose size={17} />
          </button>
        </header>

        {error && (
          <p className="admin-error">
            <IconWarning size={14} /> {error}
          </p>
        )}

        {!user ? (
          <p className="tiny faint">Loading…</p>
        ) : (
          <>
            <div className="admin-drawer-person">
              <span
                className="admin-avatar admin-avatar-lg"
                style={{ backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : undefined }}
              >
                {!user.avatarUrl && user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <h2>{user.displayName}</h2>
                <span className="tiny faint">
                  @{user.username} · <code>{user.nookId}</code>
                </span>
                {user.email && (
                  <span className="tiny faint">
                    {user.email} {user.emailVerified ? '· confirmed' : '· unconfirmed'}
                  </span>
                )}
              </span>
            </div>

            {user.suspended && (
              <p className="admin-banner-bad">
                <IconLock size={14} /> This account is suspended. Every request it makes is refused.
              </p>
            )}

            <dl className="admin-facts">
              <div><dt>Messages</dt><dd>{user.messageCount.toLocaleString()}</dd></div>
              <div><dt>Rooms</dt><dd>{user.conversationCount}</dd></div>
              <div><dt>Media sent</dt><dd>{user.mediaCount}</dd></div>
              <div><dt>Joined</dt><dd>{when(user.createdAt)}</dd></div>
              <div><dt>Last seen</dt><dd>{user.online ? 'online now' : when(user.lastSeen)}</dd></div>
              <div><dt>Sign-in</dt><dd>{user.viaGoogle ? 'Google' : user.passwordless ? 'none' : 'password'}</dd></div>
            </dl>

            <section>
              <span className="eyebrow">Last fourteen days</span>
              {user.activity.length === 0 ? (
                <p className="tiny faint">Nothing sent in that time.</p>
              ) : (
                <div className="admin-spark" role="img" aria-label="Messages per day over the last fortnight">
                  {user.activity.map((a) => (
                    <span
                      key={a.day}
                      style={{ height: `${Math.max(6, (a.count / peak) * 100)}%` }}
                      title={`${new Date(a.day).toLocaleDateString()} — ${a.count}`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <span className="eyebrow">Rooms</span>
              <ul className="admin-rooms">
                {user.rooms.map((r) => (
                  <li key={r.id}>
                    <span className="grow">{r.type === 'group' ? r.name : 'Direct chat'}</span>
                    <span className="tiny faint">{when(r.lastActivity)}</span>
                  </li>
                ))}
                {user.rooms.length === 0 && <li className="tiny faint">No rooms yet.</li>}
              </ul>
            </section>

            <section className="admin-actions">
              <span className="eyebrow">Actions</span>

              <button className="slab slab-block" onClick={openAccount} disabled={Boolean(busy)}>
                {busy === 'open' ? 'Opening…' : 'Open this account'}
              </button>
              <p className="tiny faint">
                Signs you in as {user.displayName.split(' ')[0]} for fifteen minutes. You will see
                their private conversations. Recorded in the audit trail.
              </p>

              <button
                className="clay-btn"
                disabled={Boolean(busy)}
                onClick={() => act('signout', () => adminPost(`/users/${user.id}/sign-out`))}
              >
                <IconLogOut size={16} />
                {busy === 'signout' ? 'Signing out…' : 'Sign out everywhere'}
              </button>

              <button
                className="clay-btn"
                disabled={Boolean(busy)}
                onClick={() =>
                  act('suspend', () =>
                    adminPatch(`/users/${user.id}/suspend`, { suspended: !user.suspended })
                  )
                }
              >
                {user.suspended ? <IconCheck size={16} /> : <IconLock size={16} />}
                {busy === 'suspend'
                  ? 'Working…'
                  : user.suspended
                    ? 'Unsuspend'
                    : 'Suspend'}
              </button>

              {!confirmingDelete ? (
                <button
                  className="slab slab-danger slab-block"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <IconTrash size={16} /> Delete account
                </button>
              ) : (
                <div className="admin-danger">
                  <p className="tiny">
                    This removes the account and every message they ever sent. It cannot be undone.
                    Type <strong>{user.username}</strong> to confirm.
                  </p>
                  <input
                    className="groove"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={user.username}
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label="Type the username to confirm deletion"
                  />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="clay-btn grow" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                    <button
                      className="slab slab-danger grow"
                      disabled={confirmText !== user.username || Boolean(busy)}
                      onClick={() =>
                        act('delete', async () => {
                          await adminDelete(`/users/${user.id}`, { confirm: confirmText });
                          onClose();
                        })
                      }
                    >
                      {busy === 'delete' ? 'Deleting…' : 'Delete for good'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </motion.aside>
    </>
  );
}

export function UserPanelHost({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <AnimatePresence>
      {userId && <UserPanel userId={userId} onClose={onClose} onChanged={onChanged} />}
    </AnimatePresence>
  );
}
