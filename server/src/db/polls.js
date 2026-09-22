/**
 * Polls and shared lists: the parts of those messages that are not the body.
 *
 * Every write here is a single statement or a single transaction. Voting and
 * ticking are exactly the interactions people do at the same moment as each
 * other — a poll lands in a group and five people tap within a second — so a
 * read-then-write anywhere in this file would lose somebody's tap.
 */
import { all, one, run, tx, newId, now, bool, placeholders } from './index.js';

/** Hard limits, shared by the send schema and the routes so they cannot drift. */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;
export const LIST_MAX_ITEMS = 100;

/* ── creation ─────────────────────────────────────────────────────────────── */

export async function createPoll(messageId, { options, multiple, anonymous, closesAt }) {
  await tx([
    {
      sql: 'INSERT INTO polls (message_id, multiple, anonymous, closes_at) VALUES (?, ?, ?, ?)',
      args: [messageId, bool(multiple), bool(anonymous), closesAt ? new Date(closesAt).getTime() : null],
    },
    ...options.map((text, position) => ({
      sql: 'INSERT INTO poll_options (id, message_id, position, text) VALUES (?, ?, ?, ?)',
      args: [newId(), messageId, position, text],
    })),
  ]);
}

export async function createList(messageId, userId, items) {
  if (!items.length) return;
  const t = now();
  await tx(
    items.map((text, position) => ({
      sql: `INSERT INTO list_items (id, message_id, position, text, added_by, added_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [newId(), messageId, position, text, userId, t],
    }))
  );
}

/* ── hydration ────────────────────────────────────────────────────────────── */

/**
 * Attach `poll` and `list` to whichever of these messages need them.
 *
 * Called from `attachChildren`, so it costs nothing on a page with no polls —
 * the queries only run when there is something to fetch, and then it is a
 * fixed four regardless of how many polls are on screen.
 */
export async function attachPollsAndLists(messages) {
  const polls = messages.filter((m) => m.type === 'poll');
  const lists = messages.filter((m) => m.type === 'list');

  if (polls.length) {
    const ids = polls.map((m) => m._id);
    const ph = placeholders(ids);
    const [heads, options, votes] = await Promise.all([
      all(`SELECT * FROM polls WHERE message_id IN (${ph})`, ids),
      all(`SELECT * FROM poll_options WHERE message_id IN (${ph}) ORDER BY position`, ids),
      all(`SELECT * FROM poll_votes WHERE message_id IN (${ph}) ORDER BY at`, ids),
    ]);
    const byId = new Map(polls.map((m) => [m._id, m]));
    for (const h of heads) {
      const m = byId.get(h.message_id);
      if (!m) continue;
      m.poll = {
        multiple: Boolean(h.multiple),
        anonymous: Boolean(h.anonymous),
        closesAt: h.closes_at ? new Date(h.closes_at) : null,
        closedAt: h.closed_at ? new Date(h.closed_at) : null,
        closedBy: h.closed_by || null,
        options: [],
      };
    }
    const optionById = new Map();
    for (const o of options) {
      const poll = byId.get(o.message_id)?.poll;
      if (!poll) continue;
      const option = { id: o.id, text: o.text, voters: [] };
      poll.options.push(option);
      optionById.set(o.id, option);
    }
    for (const v of votes) optionById.get(v.option_id)?.voters.push(v.user_id);
  }

  if (lists.length) {
    const ids = lists.map((m) => m._id);
    const rows = await all(
      `SELECT * FROM list_items WHERE message_id IN (${placeholders(ids)}) ORDER BY position`,
      ids
    );
    const byId = new Map(lists.map((m) => [m._id, m]));
    for (const m of lists) m.list = { items: [] };
    for (const r of rows) {
      byId.get(r.message_id)?.list.items.push({
        id: r.id,
        text: r.text,
        addedBy: r.added_by,
        addedAt: new Date(r.added_at),
        checkedBy: r.checked_by || null,
        checkedAt: r.checked_at ? new Date(r.checked_at) : null,
      });
    }
  }

  return messages;
}

/** Open means: nobody closed it, and its deadline (if any) has not passed. */
export const pollIsClosed = (poll) =>
  Boolean(poll?.closedAt) || Boolean(poll?.closesAt && new Date(poll.closesAt).getTime() <= Date.now());

/* ── votes ────────────────────────────────────────────────────────────────── */

/**
 * Make this person's votes exactly `optionIds`.
 *
 * "Set my votes to this" rather than "add one" / "remove one": it is
 * idempotent, so a retried request cannot double-count, and a single-choice
 * change of mind is one request instead of an unvote racing a vote. The
 * delete and the inserts share a transaction, so two quick taps on different
 * options in a single-choice poll serialise — whichever lands last wins, and
 * there is never a moment with both.
 */
export async function setVotes(messageId, userId, optionIds) {
  const t = now();
  const keep = optionIds.length ? `AND option_id NOT IN (${placeholders(optionIds)})` : '';
  await tx([
    {
      sql: `DELETE FROM poll_votes WHERE message_id = ? AND user_id = ? ${keep}`,
      args: [messageId, userId, ...optionIds],
    },
    ...optionIds.map((optionId) => ({
      sql: `INSERT INTO poll_votes (message_id, option_id, user_id, at) VALUES (?, ?, ?, ?)
            ON CONFLICT (message_id, option_id, user_id) DO NOTHING`,
      args: [messageId, optionId, userId, t],
    })),
  ]);
}

export async function voteCount(messageId) {
  const row = await one('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = ?', [messageId]);
  return row?.n || 0;
}

/** First close wins; a second one is a no-op rather than moving the time. */
export const closePoll = (messageId, userId) =>
  run('UPDATE polls SET closed_at = ?, closed_by = ? WHERE message_id = ? AND closed_at IS NULL', [
    now(),
    userId,
    messageId,
  ]);

/* ── list items ───────────────────────────────────────────────────────────── */

/**
 * Append an item, in one statement.
 *
 * The position and the size cap are both computed inside the INSERT, so two
 * people adding at once cannot take the same slot, and a burst of adds cannot
 * slip past the cap between a count and a write. Returns the new id, or null
 * when the list is already full.
 */
export async function addListItem(messageId, userId, text) {
  const id = newId();
  const result = await run(
    `INSERT INTO list_items (id, message_id, position, text, added_by, added_at)
     SELECT ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM list_items WHERE message_id = ?), ?, ?, ?
      WHERE (SELECT COUNT(*) FROM list_items WHERE message_id = ?) < ?`,
    [id, messageId, messageId, text, userId, now(), messageId, LIST_MAX_ITEMS]
  );
  return (result.rowsAffected ?? 0) > 0 ? id : null;
}

export const findListItem = (messageId, itemId) =>
  one('SELECT * FROM list_items WHERE id = ? AND message_id = ?', [itemId, messageId]);

export const setListItemChecked = (messageId, itemId, userId, checked) =>
  run('UPDATE list_items SET checked_by = ?, checked_at = ? WHERE id = ? AND message_id = ?', [
    checked ? userId : null,
    checked ? now() : null,
    itemId,
    messageId,
  ]);

export const removeListItem = (messageId, itemId) =>
  run('DELETE FROM list_items WHERE id = ? AND message_id = ?', [itemId, messageId]);
