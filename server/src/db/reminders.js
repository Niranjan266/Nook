/**
 * Message reminders: "bring this back to me at 9 tomorrow".
 *
 * One row per person per message while it is pending — the partial unique
 * index in schema.sql enforces it, and `upsertReminder` leans on it so setting
 * a reminder twice moves the time instead of adding a second one.
 */
import { all, one, run, newId, now } from './index.js';

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    remindAt: new Date(row.remind_at),
    note: row.note || '',
    createdAt: new Date(row.created_at),
    firedAt: row.fired_at ? new Date(row.fired_at) : null,
    outcome: row.outcome || '',
  };
}

export const findReminder = async (id) => hydrate(await one('SELECT * FROM reminders WHERE id = ?', [id]));

export const countActive = async (userId) =>
  Number((await one('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND fired_at IS NULL', [userId]))?.n || 0);

export const activeFor = async (userId, messageId) =>
  hydrate(
    await one('SELECT * FROM reminders WHERE user_id = ? AND message_id = ? AND fired_at IS NULL', [userId, messageId])
  );

/**
 * Create, or move the pending one for this message.
 *
 * ON CONFLICT against the partial index rather than read-then-write, so two
 * taps racing each other still end with one row.
 */
export async function upsertReminder({ userId, messageId, conversationId, remindAt, note = '' }) {
  const id = newId();
  await run(
    `INSERT INTO reminders (id, user_id, message_id, conversation_id, remind_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, message_id) WHERE fired_at IS NULL
     DO UPDATE SET remind_at = excluded.remind_at, note = excluded.note`,
    [id, userId, messageId, conversationId, remindAt, note, now()]
  );
  return activeFor(userId, messageId);
}

/** Pending first (soonest at the top), then what fired in the last week. */
export async function listFor(userId, { recentDays = 7, recentLimit = 20 } = {}) {
  const [upcoming, recent] = await Promise.all([
    all('SELECT * FROM reminders WHERE user_id = ? AND fired_at IS NULL ORDER BY remind_at ASC LIMIT 200', [userId]),
    all(
      `SELECT * FROM reminders
        WHERE user_id = ? AND fired_at IS NOT NULL AND fired_at >= ? AND outcome != 'dropped'
        ORDER BY fired_at DESC LIMIT ?`,
      [userId, now() - recentDays * 86400_000, recentLimit]
    ),
  ]);
  return { upcoming: upcoming.map(hydrate), recent: recent.map(hydrate) };
}

/** Only the owner's rows — someone else's id is indistinguishable from none. */
export const deleteReminder = (id, userId) => run('DELETE FROM reminders WHERE id = ? AND user_id = ?', [id, userId]);

export const dueReminders = async (limit = 50) =>
  (
    await all('SELECT * FROM reminders WHERE fired_at IS NULL AND remind_at <= ? ORDER BY remind_at ASC LIMIT ?', [
      now(),
      limit,
    ])
  ).map(hydrate);

/**
 * Take a due reminder for firing. Exactly one caller gets `true`.
 *
 * Claim first, send second: a crash between the two loses that one reminder
 * rather than repeating it on every restart, and a reminder that nags twice
 * is worse than the rare one that never arrives.
 */
export async function claimReminder(id) {
  const result = await run('UPDATE reminders SET fired_at = ? WHERE id = ? AND fired_at IS NULL', [now(), id]);
  return (result.rowsAffected ?? 0) > 0;
}

export const setOutcome = (id, outcome) => run('UPDATE reminders SET outcome = ? WHERE id = ?', [outcome, id]);

/** Old history is not worth keeping; pending rows are never touched. */
export const pruneFired = (olderThanMs = 30 * 86400_000) =>
  run('DELETE FROM reminders WHERE fired_at IS NOT NULL AND fired_at < ?', [now() - olderThanMs]);
