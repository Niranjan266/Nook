/**
 * Queries that only the admin panel uses.
 *
 * Kept apart from db/users.js deliberately: these read across every account,
 * which is exactly the thing the rest of the app must never do. Having them in
 * one file makes the blast radius obvious, and makes it easy to see at review
 * time whether anything outside the admin routes imports them. Nothing should.
 */
import { all, one, run, now } from './index.js';

/* ── audit ────────────────────────────────────────────────────────────────── */

export const audit = ({ actor, action, targetId = '', detail = '', ip = '' }) =>
  run(
    'INSERT INTO admin_audit (actor, action, target_id, detail, ip, at) VALUES (?, ?, ?, ?, ?, ?)',
    [actor, action, targetId, String(detail).slice(0, 500), ip, now()]
  );

export const recentAudit = (limit = 100) =>
  all('SELECT * FROM admin_audit ORDER BY at DESC LIMIT ?', [Math.min(limit, 500)]);

/* ── overview ─────────────────────────────────────────────────────────────── */

export async function instanceStats() {
  const dayAgo = now() - 24 * 60 * 60 * 1000;
  const weekAgo = now() - 7 * 24 * 60 * 60 * 1000;

  const [users, active, newWeek, convos, groups, messages, dayMessages, media, suspended] =
    await Promise.all([
      one('SELECT COUNT(*) AS n FROM users'),
      one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', [dayAgo]),
      one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [weekAgo]),
      one('SELECT COUNT(*) AS n FROM conversations'),
      one(`SELECT COUNT(*) AS n FROM conversations WHERE type = 'group'`),
      one('SELECT COUNT(*) AS n FROM messages'),
      one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', [dayAgo]),
      one('SELECT COUNT(*) AS n FROM messages WHERE media IS NOT NULL'),
      one('SELECT COUNT(*) AS n FROM users WHERE suspended = 1'),
    ]);

  return {
    users: users.n,
    activeToday: active.n,
    newThisWeek: newWeek.n,
    suspended: suspended.n,
    conversations: convos.n,
    groups: groups.n,
    messages: messages.n,
    messagesToday: dayMessages.n,
    withMedia: media.n,
  };
}

/* ── people ───────────────────────────────────────────────────────────────── */

const SORTS = {
  recent: 'u.last_seen DESC',
  joined: 'u.created_at DESC',
  messages: 'message_count DESC',
  name: 'u.display_name COLLATE NOCASE ASC',
  username: 'u.username ASC',
};

/**
 * One query, not one-per-user. The counts come from correlated subqueries,
 * which SQLite handles well at this size and which keeps the whole listing to
 * a single round trip — the alternative is N+1 against a database that may be
 * on the other side of the planet.
 */
export async function listUsers({ query = '', sort = 'recent', limit = 50, offset = 0 } = {}) {
  const order = SORTS[sort] || SORTS.recent;
  const like = `%${String(query).toLowerCase()}%`;
  const filtered = query
    ? `WHERE (u.username LIKE ? OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? OR u.nook_id = ?)`
    : '';
  const args = query ? [like, like, like, String(query).toLowerCase()] : [];

  const rows = await all(
    `SELECT
       u.id, u.username, u.nook_id, u.display_name, u.email, u.email_verified,
       u.avatar_url, u.accent, u.online, u.last_seen, u.created_at,
       u.suspended, u.passwordless, u.google_sub,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id)                    AS message_count,
       (SELECT COUNT(*) FROM conversation_members cm WHERE cm.user_id = u.id)        AS conversation_count,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.media IS NOT NULL) AS media_count
     FROM users u
     ${filtered}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    [...args, Math.min(limit, 200), offset]
  );

  const total = await one(
    `SELECT COUNT(*) AS n FROM users u ${filtered}`,
    args
  );

  return { users: rows.map(shape), total: total.n };
}

const shape = (r) => ({
  id: r.id,
  username: r.username,
  nookId: r.nook_id || '',
  displayName: r.display_name,
  email: r.email || '',
  emailVerified: Boolean(r.email_verified),
  avatarUrl: r.avatar_url || '',
  accent: r.accent,
  online: Boolean(r.online),
  lastSeen: r.last_seen || 0,
  createdAt: r.created_at,
  suspended: Boolean(r.suspended),
  passwordless: Boolean(r.passwordless),
  viaGoogle: Boolean(r.google_sub),
  messageCount: r.message_count || 0,
  conversationCount: r.conversation_count || 0,
  mediaCount: r.media_count || 0,
});

export async function userDetail(id) {
  const r = await one(
    `SELECT u.*,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id)                    AS message_count,
       (SELECT COUNT(*) FROM conversation_members cm WHERE cm.user_id = u.id)        AS conversation_count,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.media IS NOT NULL) AS media_count
     FROM users u WHERE u.id = ?`,
    [id]
  );
  if (!r) return null;

  // Daily message counts for the last fortnight — enough to see a pattern,
  // small enough to send in the same response.
  const since = now() - 14 * 24 * 60 * 60 * 1000;
  const activity = await all(
    `SELECT (created_at / 86400000) AS day, COUNT(*) AS n
       FROM messages WHERE sender_id = ? AND created_at > ?
       GROUP BY day ORDER BY day`,
    [id, since]
  );

  const rooms = await all(
    `SELECT c.id, c.type, c.name, c.last_activity
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ?
      ORDER BY c.last_activity DESC LIMIT 20`,
    [id]
  );

  return {
    ...shape(r),
    about: r.about || '',
    activity: activity.map((a) => ({ day: a.day * 86400000, count: a.n })),
    rooms: rooms.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name || '(direct)',
      lastActivity: c.last_activity,
    })),
  };
}

export const setSuspended = (id, suspended) =>
  run('UPDATE users SET suspended = ?, updated_at = ? WHERE id = ?', [suspended ? 1 : 0, now(), id]);

export const deleteUser = (id) => run('DELETE FROM users WHERE id = ?', [id]);

/**
 * Invalidate every access token issued so far for this account.
 *
 * Set to *now*, never the future: the check in requireAuth compares against a
 * second-granularity `iat`, and pushing the epoch forward would reject tokens
 * minted immediately afterwards — locking the person out of signing back in.
 */
export const bumpTokenEpoch = (id) =>
  run('UPDATE users SET token_epoch = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);

/** Everyone with an address, for a broadcast. */
export const mailableUsers = () =>
  all(`SELECT id, username, display_name, email, nook_id FROM users WHERE email <> '' AND suspended = 0`);
