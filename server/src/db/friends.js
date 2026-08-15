/**
 * Friend requests.
 *
 * The rule this file exists to enforce: two people who have not agreed to talk
 * cannot talk. Everything else — the conversation row, the member rows, the
 * unread counters — carries on working exactly as before, because refusing at
 * the point of sending is far simpler to reason about than refusing at the
 * point of creating, and it leaves the recipient a real conversation to accept
 * *from*.
 *
 * Friendship is symmetric even though the rows are directed: one accepted row
 * in either direction means both of you may write. Storing it directed keeps
 * "who asked whom" available, which the UI needs to decide between "waiting for
 * them" and "they are waiting for you".
 */
import { all, one, run, now } from './index.js';

export const PENDING = 'pending';
export const ACCEPTED = 'accepted';
export const DECLINED = 'declined';

const hydrate = (r) =>
  r && {
    fromId: r.from_id,
    toId: r.to_id,
    status: r.status,
    note: r.note || '',
    createdAt: r.created_at,
    respondedAt: r.responded_at || 0,
  };

/** The row for this ordered pair, if any. */
export const findRequest = async (fromId, toId) =>
  hydrate(await one('SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ?', [fromId, toId]));

/**
 * Everything between two people, in either direction. Callers nearly always
 * want both rows — "did I ask them" and "did they ask me" are different
 * answers, and one query is cheaper than two.
 */
export async function edgeBetween(a, b) {
  const rows = await all(
    'SELECT * FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
    [a, b, b, a]
  );
  const mine = rows.find((r) => r.from_id === a);
  const theirs = rows.find((r) => r.from_id === b);
  return { outgoing: hydrate(mine), incoming: hydrate(theirs) };
}

/**
 * May these two exchange messages?
 *
 * Accepted in either direction is enough. A person is always allowed to talk
 * to themselves — the saved-messages conversation everyone ends up using as a
 * notepad would otherwise be locked out by its own rule.
 */
export async function areFriends(a, b) {
  if (a === b) return true;
  const row = await one(
    `SELECT 1 AS ok FROM friend_requests
      WHERE status = 'accepted'
        AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
      LIMIT 1`,
    [a, b, b, a]
  );
  return Boolean(row);
}

/**
 * Send, or re-send after a decline.
 *
 * An upsert rather than an insert: someone who was turned down and asks again
 * later should replace their old row, not collide with it. Re-sending resets
 * the status to pending and clears the previous response time, so the
 * recipient sees a fresh request rather than a stale "declined" they cannot
 * act on.
 */
export async function sendRequest(fromId, toId, note = '') {
  await run(
    `INSERT INTO friend_requests (from_id, to_id, status, note, created_at, responded_at)
     VALUES (?, ?, 'pending', ?, ?, 0)
     ON CONFLICT (from_id, to_id) DO UPDATE SET
       status = 'pending',
       -- Re-sending without a note must not erase the note you sent the first
       -- time. A second tap on "Add friend" is the same request, not a new
       -- blank one, and the recipient losing the only context they had is a
       -- silent regression nobody would think to look for.
       note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE friend_requests.note END,
       created_at = excluded.created_at,
       responded_at = 0`,
    [fromId, toId, String(note || '').slice(0, 200), now()]
  );
  return findRequest(fromId, toId);
}

export async function setStatus(fromId, toId, status) {
  await run('UPDATE friend_requests SET status = ?, responded_at = ? WHERE from_id = ? AND to_id = ?', [
    status,
    now(),
    fromId,
    toId,
  ]);
  return findRequest(fromId, toId);
}

export const cancelRequest = (fromId, toId) =>
  run("DELETE FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'", [fromId, toId]);

/** Removing a friend drops both rows, so either side can ask again cleanly. */
export const unfriend = (a, b) =>
  run(
    'DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)',
    [a, b, b, a]
  );

export async function incoming(userId) {
  const rows = await all(
    "SELECT * FROM friend_requests WHERE to_id = ? AND status = 'pending' ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(hydrate);
}

export async function outgoing(userId) {
  const rows = await all(
    "SELECT * FROM friend_requests WHERE from_id = ? AND status = 'pending' ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(hydrate);
}

export async function incomingCount(userId) {
  const row = await one(
    "SELECT COUNT(*) AS n FROM friend_requests WHERE to_id = ? AND status = 'pending'",
    [userId]
  );
  return row?.n || 0;
}

/** Everyone this person is allowed to talk to, in either direction. */
export async function friendIds(userId) {
  const rows = await all(
    `SELECT from_id, to_id FROM friend_requests
      WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)`,
    [userId, userId]
  );
  return rows.map((r) => (r.from_id === userId ? r.to_id : r.from_id));
}

const BACKFILL_KEY = 'friends:grandfathered';

/**
 * Grandfather everyone who was already talking before this rule existed.
 *
 * Switching the rule on without this would silently lock every existing pair
 * out of their own history — a data-loss-shaped bug even though no data is
 * lost. Anyone with a direct conversation between them has demonstrably
 * consented, so they start as friends.
 *
 * This runs exactly once, recorded in `app_meta`, and the flag is the whole
 * point rather than bookkeeping. "Grandfather any pair with a conversation and
 * no friend row" describes an unfriended pair just as accurately as a
 * pre-feature one — so re-running it on every boot would quietly undo every
 * unfriending at the next restart. A person who removed someone must stay
 * removed; a server restart is not consent.
 */
export async function backfillFromConversations() {
  const done = await one('SELECT 1 AS ok FROM app_meta WHERE key = ?', [BACKFILL_KEY]);
  if (done) return 0;

  const rows = await all(
    `SELECT m1.user_id AS a, m2.user_id AS b
       FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id > m1.user_id
      WHERE c.type = 'direct'`
  );

  let added = 0;
  for (const { a, b } of rows) {
    const existing = await one(
      `SELECT 1 AS ok FROM friend_requests
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) LIMIT 1`,
      [a, b, b, a]
    );
    if (existing) continue;
    await run(
      `INSERT OR IGNORE INTO friend_requests (from_id, to_id, status, note, created_at, responded_at)
       VALUES (?, ?, 'accepted', '', ?, ?)`,
      [a, b, now(), now()]
    );
    added += 1;
  }

  await run('INSERT OR REPLACE INTO app_meta (key, value, at) VALUES (?, ?, ?)', [
    BACKFILL_KEY,
    String(added),
    now(),
  ]);
  return added;
}
