/**
 * /nookcontrol — the admin panel.
 *
 * Lazy-loaded from App.tsx so none of this reaches an ordinary visitor's
 * browser. It is a separate screen rather than a sheet inside the app because
 * it is a separate job: you are not chatting, you are looking after the
 * instance, and mixing the two invites clicking the wrong thing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';
import {
  adminGet,
  adminPost,
  setAdminToken,
  adminToken,
  AdminError,
  type AdminUser,
  type AdminStats,
} from '@/lib/adminApi';
import { API_BASE } from '@/lib/config';
import { IconSearch, IconWarning, IconLogOut, IconCheck, IconUsers } from '@/components/Icon';

const SORTS = [
  { id: 'recent', label: 'Last seen' },
  { id: 'joined', label: 'Newest' },
  { id: 'messages', label: 'Most messages' },
  { id: 'name', label: 'Name' },
] as const;

const ago = (ms: number) => {
  if (!ms) return 'never';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
};

/* ── sign in ──────────────────────────────────────────────────────────────── */

function SignIn({ onIn }: { onIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<{ passwordSignIn: boolean; googleSignIn: boolean } | null>(null);

  useEffect(() => {
    adminGet<{ passwordSignIn: boolean; googleSignIn: boolean }>('/config')
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await adminPost<{ token: string }>('/sign-in', { username, password });
      setAdminToken(token);
      onIn();
    } catch (err: any) {
      setError(err instanceof AdminError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <div className="admin-gate">
      <motion.form
        className="clay clay-3 admin-gate-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <span className="eyebrow">Nook</span>
        <h1>Control</h1>
        <p className="small muted">This page is not linked from anywhere. Only you should be here.</p>

        {config && !config.passwordSignIn && (
          <p className="admin-note">
            <IconWarning size={14} /> Password sign-in is not configured on this server. Set
            ADMIN_USERNAME and ADMIN_PASSWORD_HASH — run Make-Admin.bat to generate the hash.
          </p>
        )}

        <label className="field">
          <span className="field-label">Username</span>
          <input
            className="groove"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="groove"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="admin-error">
            <IconWarning size={14} /> {error}
          </p>
        )}

        <button className="slab slab-block" disabled={busy || !username || !password}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        {config?.googleSignIn && (
          <>
            <div className="door-or" aria-hidden="true">
              <span>or</span>
            </div>
            <button
              type="button"
              className="slab slab-quiet slab-block"
              onClick={() => {
                // Reuse the app's Google flow, then trade the resulting
                // session for an admin token — see AdminApp's handoff effect.
                window.location.href = `${API_BASE}/api/auth/google/start?admin=1`;
              }}
            >
              Continue with Google
            </button>
          </>
        )}
      </motion.form>
    </div>
  );
}

/* ── panel ────────────────────────────────────────────────────────────────── */

export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(Boolean(adminToken()));
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<string>('recent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actor, setActor] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, list, me] = await Promise.all([
        adminGet<AdminStats>('/stats'),
        adminGet<{ users: AdminUser[]; total: number }>(
          `/users?q=${encodeURIComponent(query)}&sort=${sort}&limit=100`
        ),
        adminGet<{ actor: string }>('/me'),
      ]);
      setStats(s);
      setUsers(list.users);
      setTotal(list.total);
      setActor(me.actor);
    } catch (err: any) {
      if (err instanceof AdminError && err.expired) setSignedIn(false);
      else setError(err.message || 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, [query, sort]);

  useEffect(() => {
    if (!signedIn) return;
    // Debounced so typing in the search box does not fire a request per key.
    const t = setTimeout(load, query ? 260 : 0);
    return () => clearTimeout(t);
  }, [signedIn, load, query]);

  const cards = useMemo(
    () =>
      stats
        ? [
            { label: 'People', value: stats.users, sub: `${stats.newThisWeek} joined this week` },
            { label: 'Active today', value: stats.activeToday, sub: `${stats.suspended} suspended` },
            { label: 'Messages', value: stats.messages, sub: `${stats.messagesToday} today` },
            { label: 'Rooms', value: stats.conversations, sub: `${stats.groups} groups` },
          ]
        : [],
    [stats]
  );

  if (!signedIn) return <SignIn onIn={() => setSignedIn(true)} />;

  return (
    <div className="admin">
      <header className="admin-head">
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="eyebrow">Nook</span>
          <h1>Control</h1>
        </span>
        <span className="grow" />
        <span className="tiny muted admin-actor" title={actor}>
          {actor}
        </span>
        <button
          className="clay-btn"
          onClick={() => {
            setAdminToken(null);
            setSignedIn(false);
          }}
        >
          <IconLogOut size={16} /> Sign out
        </button>
      </header>

      <div className="admin-cards">
        {cards.map((c) => (
          <div className="clay clay-2 admin-card" key={c.label}>
            <span className="eyebrow">{c.label}</span>
            <strong>{c.value.toLocaleString()}</strong>
            <span className="tiny faint">{c.sub}</span>
          </div>
        ))}
      </div>

      <div className="admin-toolbar">
        <label className="admin-search">
          <IconSearch size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, username, email or Nook ID"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search people"
          />
        </label>
        <div className="admin-sorts" role="group" aria-label="Sort by">
          {SORTS.map((s) => (
            <button
              key={s.id}
              className={`admin-sort${sort === s.id ? ' on' : ''}`}
              onClick={() => setSort(s.id)}
              aria-pressed={sort === s.id}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="admin-error">
          <IconWarning size={14} /> {error}
        </p>
      )}

      <p className="tiny faint admin-count">
        {loading ? 'Loading…' : `${users.length} of ${total} ${total === 1 ? 'person' : 'people'}`}
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Nook ID</th>
              <th className="num">Messages</th>
              <th className="num">Rooms</th>
              <th>Last seen</th>
              <th>Joined</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.suspended ? 'is-suspended' : ''}>
                <td>
                  <span className="admin-person">
                    <span
                      className="admin-avatar"
                      style={{ backgroundImage: u.avatarUrl ? `url(${u.avatarUrl})` : undefined }}
                      data-accent={u.accent}
                      aria-hidden="true"
                    >
                      {!u.avatarUrl && u.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                      <span className="admin-name">
                        {u.displayName}
                        {u.online && <span className="admin-dot" title="Online now" />}
                      </span>
                      <span className="tiny faint">
                        @{u.username}
                        {u.email ? ` · ${u.email}` : ''}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="mono tiny">{u.nookId}</td>
                <td className="num mono">{u.messageCount.toLocaleString()}</td>
                <td className="num mono">{u.conversationCount}</td>
                <td className="tiny">{u.online ? 'now' : ago(u.lastSeen)}</td>
                <td className="tiny">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  {u.suspended ? (
                    <span className="chip admin-chip-bad">Suspended</span>
                  ) : u.viaGoogle ? (
                    <span className="chip">Google</span>
                  ) : u.emailVerified ? (
                    <span className="chip">
                      <IconCheck size={12} /> Verified
                    </span>
                  ) : (
                    <span className="chip admin-chip-quiet">Password</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && users.length === 0 && (
          <p className="admin-empty">
            <IconUsers size={22} />
            {query ? `Nobody matches “${query}”.` : 'No accounts yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
