/**
 * Messages, and everything that used to be an array inside one.
 *
 * The important function here is `hydrateMessages`: it takes a list of ids and
 * returns fully-populated message objects — sender, reply-to, reactions, reads,
 * deliveries, stars, deletions, view-once state — in a fixed number of queries
 * regardless of how many messages. Loading 40 messages costs 8 queries, not 320.
 */
import { all, one, run, newId, now, parseJson, toJson, bool, placeholders } from './index.js';
import { hydrateUser } from './users.js';
import { attachPollsAndLists, createPoll, createList } from './polls.js';

const SENDER_JOIN = `
  SELECT m.*,
         u.username     AS s_username,
         u.display_name AS s_display_name,
         u.avatar_url   AS s_avatar,
         u.accent       AS s_accent
    FROM messages m
    JOIN users u ON u.id = m.sender_id
`;

function baseMessage(row) {
  return {
    _id: row.id,
    id: row.id,
    conversation: row.conversation_id,
    sender: {
      _id: row.sender_id,
      id: row.sender_id,
      username: row.s_username,
      displayName: row.s_display_name,
      avatarUrl: row.s_avatar,
      accent: row.s_accent,
    },
    type: row.type,
    body: row.body,
    media: parseJson(row.media, null),
    linkPreview: parseJson(row.link_preview, null),
    transcript: row.transcript || '',
    replyTo: row.reply_to_id || null,
    forwardedFrom: row.forwarded_from || null,
    threadRoot: row.thread_root_id || null,
    replyCount: row.reply_count || 0,
    threadUpdatedAt: row.thread_updated_at ? new Date(row.thread_updated_at) : null,
    call: row.call_kind ? { kind: row.call_kind, status: row.call_status, duration: row.call_duration } : null,
    viewOnce: {
      enabled: Boolean(row.view_once),
      viewedBy: [],
      // How many times each viewer has opened it, so replays can be counted
      // per person rather than per message — in a group, one person using
      // their looks must not spend anybody else's.
      opens: {},
      burntAt: row.burnt_at ? new Date(row.burnt_at) : null,
    },
    // Seconds the viewer gets on a snap. 0 = they close it themselves.
    viewSeconds: row.view_seconds ?? 10,
    // Commas at both ends when stored; stripped here so callers see a list.
    savedBy: String(row.saved_by || '').split(',').filter(Boolean),
    deletedForAll: Boolean(row.deleted_for_all),
    editedAt: row.edited_at ? new Date(row.edited_at) : null,
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : null,
    delivered: Boolean(row.delivered),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    clientId: row.client_id || '',
    createdAt: new Date(row.created_at),
    reactions: [],
    readBy: [],
    deliveredTo: [],
    starredBy: [],
    deletedFor: [],
    mentions: [],
    edits: [],
    // Filled in by attachPollsAndLists, only for those two types.
    poll: null,
    list: null,
  };
}

/** Attach every child collection in one pass. */
async function attachChildren(messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => m._id);
  const byId = new Map(messages.map((m) => [m._id, m]));
  const ph = placeholders(ids);

  const [reactions, reads, deliveries, stars, deletions, views, mentions] = await Promise.all([
    all(`SELECT * FROM message_reactions WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_reads WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_deliveries WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_stars WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_deletions WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_views WHERE message_id IN (${ph})`, ids),
    all(`SELECT * FROM message_mentions WHERE message_id IN (${ph})`, ids),
  ]);

  for (const r of reactions)
    byId.get(r.message_id)?.reactions.push({ user: r.user_id, emoji: r.emoji, at: new Date(r.at) });
  for (const r of reads) byId.get(r.message_id)?.readBy.push({ user: r.user_id, at: new Date(r.at) });
  for (const d of deliveries)
    byId.get(d.message_id)?.deliveredTo.push({ user: d.user_id, at: new Date(d.at) });
  for (const s of stars) byId.get(s.message_id)?.starredBy.push(s.user_id);
  for (const d of deletions) byId.get(d.message_id)?.deletedFor.push(d.user_id);
  for (const v of views) {
    const m = byId.get(v.message_id);
    if (!m) continue;
    m.viewOnce.viewedBy.push(v.user_id);
    m.viewOnce.opens[String(v.user_id)] = v.opens || 1;
  }
  for (const m of mentions) byId.get(m.message_id)?.mentions.push(m.user_id);

  await attachPollsAndLists(messages);

  // Reply-to is rendered as a quote, so it needs the original's sender name
  // and a thumbnail — one extra query for the whole page of messages.
  const replyIds = [...new Set(messages.map((m) => m.replyTo).filter(Boolean))];
  if (replyIds.length) {
    const rows = await all(`${SENDER_JOIN} WHERE m.id IN (${placeholders(replyIds)})`, replyIds);
    const quotes = new Map(
      rows.map((r) => [
        r.id,
        {
          _id: r.id,
          body: r.body,
          type: r.type,
          deletedForAll: Boolean(r.deleted_for_all),
          media: parseJson(r.media, null),
          sender: { _id: r.sender_id, displayName: r.s_display_name },
        },
      ])
    );
    for (const m of messages) if (m.replyTo) m.replyTo = quotes.get(m.replyTo) || m.replyTo;
  }

  return messages;
}

export async function hydrateMessages(ids) {
  if (!ids?.length) return [];
  const rows = await all(`${SENDER_JOIN} WHERE m.id IN (${placeholders(ids)})`, ids);
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  // Preserve the order the caller asked for.
  const byId = new Map(messages.map((m) => [m._id, m]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function findMessage(id) {
  const rows = await hydrateMessages([id]);
  return rows[0] || null;
}

/* ── reads ───────────────────────────────────────────────────────────────── */

/** The main stream: no thread replies, nothing scheduled, nothing you deleted. */
export async function listMessages({ conversationId, userId, before, limit = 40 }) {
  const rows = await all(
    `${SENDER_JOIN}
      WHERE m.conversation_id = ?
        AND m.thread_root_id IS NULL
        AND m.created_at < ?
        AND (m.delivered = 1 OR m.sender_id = ?)
        AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = ?)
      ORDER BY m.created_at DESC
      LIMIT ?`,
    [conversationId, before ? new Date(before).getTime() : Date.now(), userId, userId, limit]
  );
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  return messages;
}

export async function listThread({ rootId, userId, limit = 200 }) {
  const rows = await all(
    `${SENDER_JOIN}
      WHERE m.thread_root_id = ?
        AND (m.delivered = 1 OR m.sender_id = ?)
        AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = ?)
      ORDER BY m.created_at ASC
      LIMIT ?`,
    [rootId, userId, userId, limit]
  );
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  return messages;
}

/**
 * What each search filter means, as SQL over `m`.
 *
 * Photos and videos need their media: an unsent or burnt message keeps its
 * type but not its file, and a grid tile with nothing in it is a bug report.
 * Links match on the preview *or* the body, because previews are fetched
 * after the fact and some sites never answer.
 */
export const SEARCH_KINDS = {
  photos: "m.type = 'image' AND m.media IS NOT NULL",
  videos: "m.type = 'video' AND m.media IS NOT NULL",
  voice: "m.type IN ('voice', 'audio') AND m.media IS NOT NULL",
  files: "m.type = 'file' AND m.media IS NOT NULL",
  links:
    "(m.link_preview IS NOT NULL OR m.body LIKE '%http://%' OR m.body LIKE '%https://%' OR m.body LIKE '%www.%')",
};

/** Opaque to the client: newest-first position as `createdAt:id`. */
export const encodeCursor = (m) => `${new Date(m.createdAt).getTime()}:${m._id}`;
function decodeCursor(cursor) {
  const [at, id] = String(cursor || '').split(':');
  const t = Number(at);
  return Number.isFinite(t) && id && /^[\w-]{1,64}$/.test(id) ? { t, id } : null;
}

/**
 * Search with filters, newest first, a page at a time.
 *
 * Text goes through FTS5 — prefix-matched and index-backed, never a scan of
 * every body — and the filters narrow it from there. With no text, a type or
 * sender filter alone walks the conversation indexes instead.
 *
 * Recency rather than FTS rank: a filtered search pages, and rank has no
 * stable "after this one" to resume from. Chat search is nearly always "the
 * one from last week" anyway.
 *
 * Everything a viewer must not see is excluded here, not after the LIMIT —
 * filtering a page after it is cut leaves holes, and a short page reads as
 * the end of the results. Snaps go entirely, caption and all: their media
 * was never the viewer's to browse. `excludeConversationIds` carries the
 * locked chats, which only the route can decide (unlocks live in memory).
 */
export async function searchFiltered({
  userId,
  query = '',
  conversationId = null,
  kind = null,
  from = null,
  before = null,
  after = null,
  cursor = null,
  excludeConversationIds = [],
  limit = 30,
}) {
  const where = [
    'm.deleted_for_all = 0',
    'm.delivered = 1',
    'm.view_once = 0',
    "m.type NOT IN ('snap', 'call', 'system')",
    // A kept message outlives its timer (see deleteExpired), so it stays findable.
    "(m.expires_at IS NULL OR m.expires_at > ? OR m.saved_by != '')",
    // IN rather than EXISTS so SQLite can walk each conversation's index.
    'm.conversation_id IN (SELECT cm.conversation_id FROM conversation_members cm WHERE cm.user_id = ?)',
    'NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = ?)',
  ];
  const args = [Date.now(), userId, userId];
  let join = '';

  // FTS5 treats punctuation as syntax; strip it and prefix-match each term.
  const terms = String(query || '')
    .replace(/["'()*:^-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => `"${t}"*`)
    .join(' AND ');
  if (terms) {
    join = 'JOIN messages_fts f ON f.rowid = m.rowid';
    where.push('messages_fts MATCH ?');
    args.push(terms);
  }

  if (conversationId) {
    where.push('m.conversation_id = ?');
    args.push(conversationId);
  }
  if (excludeConversationIds.length) {
    where.push(`m.conversation_id NOT IN (${placeholders(excludeConversationIds)})`);
    args.push(...excludeConversationIds);
  }
  if (kind && SEARCH_KINDS[kind]) where.push(SEARCH_KINDS[kind]);
  if (from) {
    where.push('m.sender_id = ?');
    args.push(from);
  }
  if (Number.isFinite(before)) {
    where.push('m.created_at < ?');
    args.push(before);
  }
  if (Number.isFinite(after)) {
    where.push('m.created_at >= ?');
    args.push(after);
  }
  const at = decodeCursor(cursor);
  if (at) {
    where.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))');
    args.push(at.t, at.t, at.id);
  }

  // One extra row says whether there is another page without a COUNT(*).
  args.push(limit + 1);
  const rows = await all(
    `${SENDER_JOIN}
       ${join}
      WHERE ${where.join('\n        AND ')}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`,
    args
  );

  const more = rows.length > limit;
  const messages = rows.slice(0, limit).map(baseMessage);
  await attachChildren(messages);
  return { messages, nextCursor: more && messages.length ? encodeCursor(messages[messages.length - 1]) : null };
}

export async function listStarred(userId, limit = 100) {
  const rows = await all(
    `${SENDER_JOIN}
       JOIN message_stars s ON s.message_id = m.id AND s.user_id = ?
      WHERE m.deleted_for_all = 0
      ORDER BY m.created_at DESC
      LIMIT ?`,
    [userId, limit]
  );
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  return messages;
}

export async function listScheduled(userId, limit = 50) {
  const rows = await all(
    `${SENDER_JOIN} WHERE m.sender_id = ? AND m.delivered = 0 ORDER BY m.scheduled_for ASC LIMIT ?`,
    [userId, limit]
  );
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  return messages;
}

export async function listMediaFor(conversationId, limit = 300) {
  const rows = await all(
    `${SENDER_JOIN}
      WHERE m.conversation_id = ? AND m.media IS NOT NULL AND m.deleted_for_all = 0 AND m.view_once = 0
      ORDER BY m.created_at DESC LIMIT ?`,
    [conversationId, limit]
  );
  const messages = rows.map(baseMessage);
  await attachChildren(messages);
  return messages;
}

export const dueScheduled = (limit = 50) =>
  all('SELECT id, conversation_id, sender_id, thread_root_id FROM messages WHERE delivered = 0 AND scheduled_for <= ? LIMIT ?', [
    Date.now(),
    limit,
  ]);

/** A message this sender already created under this clientId, if any. */
export const findByClientId = async (conversationId, senderId, clientId) => {
  const row = await one(
    'SELECT id FROM messages WHERE sender_id = ? AND client_id = ? AND conversation_id = ? LIMIT 1',
    [senderId, clientId, conversationId]
  );
  return row ? findMessage(row.id) : null;
};

export const lastMessageFrom = (conversationId, senderId) =>
  one(
    'SELECT created_at FROM messages WHERE conversation_id = ? AND sender_id = ? ORDER BY created_at DESC LIMIT 1',
    [conversationId, senderId]
  );

/* ── writes ──────────────────────────────────────────────────────────────── */

export async function createMessageRow(input) {
  const id = newId();
  const t = input.createdAt ? new Date(input.createdAt).getTime() : now();

  await run(
    `INSERT INTO messages
       (id, conversation_id, sender_id, type, body, media, link_preview, transcript,
        reply_to_id, forwarded_from, thread_root_id, call_kind, call_status, call_duration,
        view_once, view_seconds, deleted_for_all, scheduled_for, delivered, expires_at, client_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.conversationId,
      input.senderId,
      input.type || 'text',
      (input.body || '').slice(0, 8000),
      input.media ? toJson(input.media) : null,
      input.linkPreview ? toJson(input.linkPreview) : null,
      input.transcript || '',
      input.replyTo || null,
      input.forwardedFrom || null,
      input.threadRoot || null,
      input.call?.kind || null,
      input.call?.status || null,
      input.call?.duration || 0,
      bool(input.viewOnce),
      Number.isFinite(input.viewSeconds) ? input.viewSeconds : 10,
      input.scheduledFor ? new Date(input.scheduledFor).getTime() : null,
      bool(input.delivered !== false),
      input.expiresAt ? new Date(input.expiresAt).getTime() : null,
      input.clientId || '',
      t,
    ]
  );

  // Written before anyone can be told the message exists, so no client ever
  // receives a poll with no options or a list that is missing its items.
  if (input.type === 'poll' && input.poll) await createPoll(id, input.poll);
  if (input.type === 'list' && input.list) await createList(id, input.senderId, input.list.items || []);

  for (const userId of input.mentions || []) {
    await run('INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?, ?)', [id, userId]);
  }

  return id;
}

export async function editMessage(id, body, previousBody, previousAt) {
  await run('INSERT INTO message_edits (message_id, body, at) VALUES (?, ?, ?)', [
    id,
    previousBody,
    new Date(previousAt).getTime(),
  ]);
  await run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [body, now(), id]);
  // Twenty versions is plenty of history for a chat message.
  await run(
    `DELETE FROM message_edits
      WHERE message_id = ?
        AND id NOT IN (SELECT id FROM message_edits WHERE message_id = ? ORDER BY at DESC LIMIT 20)`,
    [id, id]
  );
}

export const editHistory = (id) =>
  all('SELECT body, at FROM message_edits WHERE message_id = ? ORDER BY at ASC', [id]);

export const setLinkPreview = (id, preview) =>
  run('UPDATE messages SET link_preview = ? WHERE id = ?', [toJson(preview), id]);

/**
 * Unsend. The edit history goes with it: keeping it meant the unsent text was
 * still one `/history` request away, which is not unsending anything.
 */
export async function deleteForEveryone(id) {
  await run(
    `UPDATE messages SET deleted_for_all = 1, body = '', media = NULL, link_preview = NULL, transcript = ''
      WHERE id = ?`,
    [id]
  );
  await run('DELETE FROM message_edits WHERE message_id = ?', [id]);
}

export const deleteForMe = (id, userId) =>
  run('INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)', [id, userId]);

export const clearConversationFor = (conversationId, userId) =>
  run(
    `INSERT OR IGNORE INTO message_deletions (message_id, user_id)
     SELECT id, ? FROM messages WHERE conversation_id = ?`,
    [userId, conversationId]
  );

export const deleteMessageRow = (id) => run('DELETE FROM messages WHERE id = ?', [id]);

/* ── reactions, reads, stars, views ──────────────────────────────────────── */

export async function toggleReaction(messageId, userId, emoji) {
  const existing = await one('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?', [
    messageId,
    userId,
  ]);
  if (existing?.emoji === emoji) {
    await run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [messageId, userId]);
  } else {
    await run(
      `INSERT INTO message_reactions (message_id, user_id, emoji, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji, at = excluded.at`,
      [messageId, userId, emoji, now()]
    );
  }
}

export async function toggleStar(messageId, userId) {
  const existing = await one('SELECT 1 AS x FROM message_stars WHERE message_id = ? AND user_id = ?', [
    messageId,
    userId,
  ]);
  if (existing) {
    await run('DELETE FROM message_stars WHERE message_id = ? AND user_id = ?', [messageId, userId]);
    return false;
  }
  await run('INSERT INTO message_stars (message_id, user_id, at) VALUES (?, ?, ?)', [
    messageId,
    userId,
    now(),
  ]);
  return true;
}

export const markDelivered = (messageId, userIds) =>
  Promise.all(
    userIds.map((userId) =>
      run('INSERT OR IGNORE INTO message_deliveries (message_id, user_id, at) VALUES (?, ?, ?)', [
        messageId,
        userId,
        now(),
      ])
    )
  );

/** Messages this user hasn't read yet, up to a cutoff. */
export const unreadMessagesFor = (conversationId, userId, cutoff) =>
  all(
    `SELECT id, sender_id FROM messages
      WHERE conversation_id = ? AND sender_id != ? AND created_at <= ?
        AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = id AND r.user_id = ?)`,
    [conversationId, userId, new Date(cutoff).getTime(), userId]
  );

export const markRead = (messageIds, userId) =>
  Promise.all(
    messageIds.map((id) =>
      run('INSERT OR IGNORE INTO message_reads (message_id, user_id, at) VALUES (?, ?, ?)', [
        id,
        userId,
        now(),
      ])
    )
  );

/** Anything waiting for a user who just came online. */
export const pendingDeliveriesFor = (userId, limit = 500) =>
  all(
    `SELECT m.id, m.sender_id, m.conversation_id
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
      WHERE m.sender_id != ?
        AND m.delivered = 1
        AND NOT EXISTS (SELECT 1 FROM message_deliveries d WHERE d.message_id = m.id AND d.user_id = ?)
      LIMIT ?`,
    [userId, userId, userId, limit]
  );

/**
 * Record that someone opened a snap, and return how many times they now have.
 *
 * `INSERT … ON CONFLICT DO UPDATE` rather than a read followed by a write:
 * two taps in quick succession — which a snap invites, because the whole
 * interaction is tapping — would both read the same count and both write it
 * back, spending one open and charging for two. Doing it in one statement
 * makes that impossible without a transaction wrapped around every call.
 */
export async function recordOpen(messageId, userId) {
  await run(
    `INSERT INTO message_views (message_id, user_id, at, opens) VALUES (?, ?, ?, 1)
     ON CONFLICT (message_id, user_id) DO UPDATE SET opens = opens + 1, at = excluded.at`,
    [messageId, userId, now()]
  );
  const row = await one('SELECT opens FROM message_views WHERE message_id = ? AND user_id = ?', [
    messageId,
    userId,
  ]);
  return row?.opens || 1;
}

/** How many times this person has already opened it. Zero if never. */
export async function opensBy(messageId, userId) {
  const row = await one('SELECT opens FROM message_views WHERE message_id = ? AND user_id = ?', [
    messageId,
    userId,
  ]);
  return row?.opens || 0;
}

/** Kept deliberately, against a timer or a burn. */
export const setSaved = (messageId, savedBy) =>
  run('UPDATE messages SET saved_by = ? WHERE id = ?', [savedBy, messageId]);

export const burnMessage = (id) =>
  run('UPDATE messages SET burnt_at = ?, media = NULL WHERE id = ?', [now(), id]);

/* ── threads and scheduling ──────────────────────────────────────────────── */

export const bumpThread = (rootId) =>
  run('UPDATE messages SET reply_count = reply_count + 1, thread_updated_at = ? WHERE id = ?', [
    now(),
    rootId,
  ]);

/**
 * Claim a scheduled message so two workers can't deliver it twice.
 *
 * A disappearing timer counts from delivery, not from when it was written, so
 * `expires_at` moves forward by however late the delivery actually ran.
 */
export async function claimScheduled(id) {
  const t = now();
  const result = await run(
    `UPDATE messages
        SET delivered = 1, created_at = ?,
            expires_at = CASE WHEN expires_at IS NULL THEN NULL
                              ELSE expires_at + (? - COALESCE(scheduled_for, ?)) END
      WHERE id = ? AND delivered = 0`,
    [t, t, t, id]
  );
  return (result.rowsAffected ?? 0) > 0;
}

export const cancelScheduled = (id, userId) =>
  run('DELETE FROM messages WHERE id = ? AND sender_id = ? AND delivered = 0', [id, userId]);

/* ── housekeeping ────────────────────────────────────────────────────────── */

/**
 * Disappearing messages. SQLite has no TTL index, so the scheduler sweeps.
 *
 * A message somebody kept is never swept, and that clause is the whole feature
 * rather than a refinement of it. Without it, Keep wrote a row, showed a
 * label, and changed nothing — the message vanished on schedule anyway, and
 * the only sign that anything was wrong would be someone going back for a
 * message they had explicitly saved and finding it gone. Starred messages have
 * been exempt from retention for the same reason, and this is the same
 * principle applied to the timer.
 */
export const deleteExpired = () =>
  // `delivered = 1`: a scheduled message has not happened yet, so its timer
  // has not started — sweeping it would delete it before anyone saw it.
  run(
    "DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ? AND saved_by = '' AND delivered = 1",
    [Date.now()]
  );

/* ── uploads ─────────────────────────────────────────────────────────────── */

export const recordUpload = (publicId, userId) =>
  run('INSERT OR IGNORE INTO media_uploads (public_id, user_id, created_at) VALUES (?, ?, ?)', [
    publicId,
    userId,
    now(),
  ]);

export const uploadOwner = async (publicId) =>
  (await one('SELECT user_id FROM media_uploads WHERE public_id = ?', [publicId]))?.user_id || null;

/** Retention. Starred messages are never swept — someone deliberately kept them. */
export const applyRetention = (conversationId, cutoff) =>
  run(
    `DELETE FROM messages
      WHERE conversation_id = ? AND created_at < ?
        AND NOT EXISTS (SELECT 1 FROM message_stars s WHERE s.message_id = messages.id)`,
    [conversationId, cutoff]
  );
