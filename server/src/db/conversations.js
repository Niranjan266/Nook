/**
 * Conversations, members, pins, the wall, and wallpaper history.
 *
 * `hydrateConversation` rebuilds the nested document the serializer expects,
 * with members already joined to their user rows — the equivalent of Mongoose's
 * `.populate()`, but as one query per collection rather than one per member.
 */
import { all, one, run, newId, now, parseJson, toJson, bool, placeholders } from './index.js';
import { hydrateUser } from './users.js';

const DEFAULT_WALLPAPER = {
  url: '',
  preset: '',
  tint: '',
  dim: 0.35,
  blur: 0,
  setBy: null,
  proposal: { url: '', preset: '', tint: '', dim: 0.35, blur: 0, by: null, at: null },
};

const DEFAULT_SCHEDULE = {
  enabled: false,
  nightStart: 19 * 60,
  nightEnd: 7 * 60,
  day: null,
  night: null,
};

/* ── hydration ───────────────────────────────────────────────────────────── */

function baseConversation(row) {
  return {
    _id: row.id,
    id: row.id,
    type: row.type,
    space: row.space_id,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    wallpaper: { ...DEFAULT_WALLPAPER, ...parseJson(row.wallpaper) },
    wallpaperSchedule: { ...DEFAULT_SCHEDULE, ...parseJson(row.wallpaper_schedule) },
    roomState: parseJson(row.room_state, {}),
    disappearAfter: row.disappear_after,
    slowMode: row.slow_mode,
    retentionDays: row.retention_days,
    lastActivity: new Date(row.last_activity),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    members: [],
    pins: [],
    wallObjects: [],
    wallpaperHistory: [],
    lastMessage: null,
  };
}

/**
 * Load a set of conversations complete with members, pins, wall and history.
 *
 * Deliberately batched: five queries total regardless of how many
 * conversations, instead of five per conversation. The old Mongoose version
 * issued a populate per document, which is what made the list endpoint slow.
 */
export async function hydrateConversations(rows, { withLastMessage = true } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const map = new Map(rows.map((r) => [r.id, baseConversation(r)]));

  const memberRows = await all(
    `SELECT m.*, u.id AS u_id, u.username, u.display_name, u.avatar_url AS u_avatar,
            u.about, u.accent, u.online, u.last_seen
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id IN (${placeholders(ids)})`,
    ids
  );

  for (const m of memberRows) {
    map.get(m.conversation_id)?.members.push({
      user: hydrateUser({
        id: m.u_id,
        username: m.username,
        display_name: m.display_name,
        password_hash: '',
        email: '',
        email_verified: 0,
        recovery_code: '',
        recovery_expires: null,
        avatar_url: m.u_avatar,
        about: m.about,
        accent: m.accent,
        last_seen: m.last_seen,
        online: m.online,
        last_nudge_at: null,
        privacy: '{}',
        settings: '{}',
        quiet_hours: '{}',
        created_at: 0,
        updated_at: 0,
      }),
      role: m.role,
      joinedAt: new Date(m.joined_at),
      muted: Boolean(m.muted),
      archived: Boolean(m.archived),
      pinned: Boolean(m.pinned),
      locked: Boolean(m.locked),
      unread: m.unread,
      lastReadAt: m.last_read_at ? new Date(m.last_read_at) : null,
      draft: m.draft,
      sound: m.sound,
    });
  }

  const wallRows = await all(
    `SELECT * FROM wall_objects WHERE conversation_id IN (${placeholders(ids)}) ORDER BY at`,
    ids
  );
  for (const w of wallRows) {
    map.get(w.conversation_id)?.wallObjects.push({
      id: w.id,
      type: w.type,
      text: w.text,
      url: w.url,
      date: w.date ? new Date(w.date) : null,
      x: w.x,
      y: w.y,
      by: w.created_by,
      at: new Date(w.at),
    });
  }

  const historyRows = await all(
    `SELECT * FROM wallpaper_history WHERE conversation_id IN (${placeholders(ids)}) ORDER BY at`,
    ids
  );
  for (const h of historyRows) {
    const look = parseJson(h.look);
    map.get(h.conversation_id)?.wallpaperHistory.push({ ...look, by: h.set_by, at: new Date(h.at) });
  }

  const pinRows = await all(
    `SELECT * FROM pins WHERE conversation_id IN (${placeholders(ids)}) ORDER BY at`,
    ids
  );
  if (pinRows.length) {
    const { hydrateMessages } = await import('./messages.js');
    const pinned = await hydrateMessages(pinRows.map((p) => p.message_id));
    const byId = new Map(pinned.map((m) => [m._id, m]));
    for (const p of pinRows) {
      map.get(p.conversation_id)?.pins.push({
        message: byId.get(p.message_id) || p.message_id,
        by: p.pinned_by,
        at: new Date(p.at),
      });
    }
  }

  if (withLastMessage) {
    const lastIds = rows.map((r) => r.last_message_id).filter(Boolean);
    if (lastIds.length) {
      const { hydrateMessages } = await import('./messages.js');
      const lasts = await hydrateMessages(lastIds);
      const byId = new Map(lasts.map((m) => [m._id, m]));
      for (const r of rows) {
        if (r.last_message_id) {
          const convo = map.get(r.id);
          if (convo) convo.lastMessage = byId.get(r.last_message_id) || null;
        }
      }
    }
  }

  return rows.map((r) => map.get(r.id));
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export async function findConversation(id) {
  const row = await one('SELECT * FROM conversations WHERE id = ?', [id]);
  if (!row) return null;
  return (await hydrateConversations([row]))[0];
}

/** The membership check every route needs before touching a conversation. */
export async function findConversationForUser(id, userId) {
  const row = await one(
    `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      WHERE c.id = ?`,
    [userId, id]
  );
  if (!row) return null;
  return (await hydrateConversations([row]))[0];
}

export const isMember = async (conversationId, userId) =>
  Boolean(
    await one('SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [
      conversationId,
      userId,
    ])
  );

export async function listConversationsFor(userId, limit = 200) {
  const rows = await all(
    `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      ORDER BY c.last_activity DESC
      LIMIT ?`,
    [userId, limit]
  );
  return hydrateConversations(rows);
}

export async function memberIdsOf(conversationId, exceptUserId) {
  const rows = await all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [
    conversationId,
  ]);
  return rows.map((r) => r.user_id).filter((id) => !exceptUserId || id !== String(exceptUserId));
}

export async function findDirectBetween(a, b) {
  const row = await one(
    `SELECT c.* FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
      WHERE c.type = 'direct'
        AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) = 2
      LIMIT 1`,
    [a, b]
  );
  if (!row) return null;
  return (await hydrateConversations([row]))[0];
}

export async function findByInviteCode(code) {
  const row = await one('SELECT * FROM conversations WHERE invite_code = ?', [code]);
  if (!row) return null;
  return (await hydrateConversations([row]))[0];
}

/* ── writes ──────────────────────────────────────────────────────────────── */

export async function createConversation({
  type,
  members,
  name = '',
  description = '',
  createdBy = null,
  inviteCode = '',
  wallpaper,
  spaceId = null,
}) {
  const id = newId();
  const t = now();

  await run(
    `INSERT INTO conversations
       (id, type, space_id, name, description, avatar_url, invite_code, created_by,
        wallpaper, wallpaper_schedule, room_state, last_activity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, '{}', ?, ?, ?)`,
    [
      id,
      type,
      spaceId,
      name,
      description,
      inviteCode,
      createdBy,
      toJson({ ...DEFAULT_WALLPAPER, ...(wallpaper || {}) }),
      toJson(DEFAULT_SCHEDULE),
      t,
      t,
      t,
    ]
  );

  for (const member of members) {
    await addMember(id, typeof member === 'string' ? member : member.user, {
      role: typeof member === 'string' ? 'member' : member.role || 'member',
    });
  }

  return findConversation(id);
}

export const addMember = (conversationId, userId, { role = 'member' } = {}) =>
  run(
    `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`,
    [conversationId, userId, role, now()]
  );

export const removeMember = (conversationId, userId) =>
  run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [
    conversationId,
    userId,
  ]);

export const setMemberRole = (conversationId, userId, role) =>
  run('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?', [
    role,
    conversationId,
    userId,
  ]);

const MEMBER_FIELDS = {
  muted: 'muted',
  archived: 'archived',
  pinned: 'pinned',
  locked: 'locked',
  draft: 'draft',
  sound: 'sound',
  unread: 'unread',
};

export async function updateMemberPrefs(conversationId, userId, patch) {
  const sets = [];
  const args = [];
  for (const [key, column] of Object.entries(MEMBER_FIELDS)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(typeof patch[key] === 'boolean' ? bool(patch[key]) : patch[key]);
  }
  if (patch.lastReadAt !== undefined) {
    sets.push('last_read_at = ?');
    args.push(patch.lastReadAt ? new Date(patch.lastReadAt).getTime() : null);
  }
  if (!sets.length) return;
  args.push(conversationId, userId);
  await run(
    `UPDATE conversation_members SET ${sets.join(', ')} WHERE conversation_id = ? AND user_id = ?`,
    args
  );
}

export const bumpUnread = (conversationId, exceptUserId) =>
  run(
    'UPDATE conversation_members SET unread = unread + 1 WHERE conversation_id = ? AND user_id != ?',
    [conversationId, exceptUserId]
  );

export const clearDraft = (conversationId, userId) =>
  run(`UPDATE conversation_members SET draft = '' WHERE conversation_id = ? AND user_id = ?`, [
    conversationId,
    userId,
  ]);

const CONVO_FIELDS = {
  name: 'name',
  description: 'description',
  avatarUrl: 'avatar_url',
  disappearAfter: 'disappear_after',
  slowMode: 'slow_mode',
  retentionDays: 'retention_days',
  spaceId: 'space_id',
  inviteCode: 'invite_code',
};

const CONVO_JSON = {
  wallpaper: 'wallpaper',
  wallpaperSchedule: 'wallpaper_schedule',
  roomState: 'room_state',
};

export async function updateConversation(id, patch) {
  const sets = [];
  const args = [];

  for (const [key, column] of Object.entries(CONVO_FIELDS)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(patch[key]);
  }

  // JSON columns are written whole here — callers always pass the complete
  // object, and merging a wallpaper would make "clear the proposal" impossible.
  for (const [key, column] of Object.entries(CONVO_JSON)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(toJson(patch[key]));
  }

  if (patch.lastMessageId !== undefined) {
    sets.push('last_message_id = ?');
    args.push(patch.lastMessageId);
  }
  if (patch.lastActivity !== undefined) {
    sets.push('last_activity = ?');
    args.push(new Date(patch.lastActivity).getTime());
  }

  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(now(), id);
  await run(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, args);
}

export const touchConversation = (id, at = Date.now()) =>
  run('UPDATE conversations SET last_activity = ?, updated_at = ? WHERE id = ?', [at, at, id]);

/* ── wallpaper history ───────────────────────────────────────────────────── */

export async function pushWallpaperHistory(conversationId, look, setBy) {
  if (!look?.url && !look?.preset) return;
  const last = await one(
    'SELECT look FROM wallpaper_history WHERE conversation_id = ? ORDER BY at DESC LIMIT 1',
    [conversationId]
  );
  if (last) {
    const previous = parseJson(last.look);
    if (previous.url === look.url && previous.preset === look.preset) return; // no duplicates
  }
  await run('INSERT INTO wallpaper_history (conversation_id, look, set_by, at) VALUES (?, ?, ?, ?)', [
    conversationId,
    toJson({ url: look.url || '', preset: look.preset || '', tint: look.tint || '', dim: look.dim ?? 0.35, blur: look.blur ?? 0 }),
    setBy || null,
    now(),
  ]);

  // Keep the diary to a sane length.
  await run(
    `DELETE FROM wallpaper_history
      WHERE conversation_id = ?
        AND id NOT IN (SELECT id FROM wallpaper_history WHERE conversation_id = ? ORDER BY at DESC LIMIT 40)`,
    [conversationId, conversationId]
  );
}

export async function wallpaperHistoryEntry(conversationId, index) {
  const rows = await all('SELECT * FROM wallpaper_history WHERE conversation_id = ? ORDER BY at', [
    conversationId,
  ]);
  const row = rows[index];
  return row ? { ...parseJson(row.look), at: row.at } : null;
}

/* ── the wall ────────────────────────────────────────────────────────────── */

export async function addWallObject(conversationId, object) {
  const id = object.id || newId();
  await run(
    `INSERT INTO wall_objects (id, conversation_id, type, text, url, date, x, y, created_by, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      conversationId,
      object.type || 'note',
      object.text || '',
      object.url || '',
      object.date ? new Date(object.date).getTime() : null,
      object.x ?? 50,
      object.y ?? 50,
      object.by || null,
      now(),
    ]
  );
  return id;
}

export async function updateWallObject(conversationId, objectId, patch) {
  const sets = [];
  const args = [];
  if (patch.text !== undefined) (sets.push('text = ?'), args.push(patch.text));
  if (patch.x !== undefined) (sets.push('x = ?'), args.push(patch.x));
  if (patch.y !== undefined) (sets.push('y = ?'), args.push(patch.y));
  if (patch.date !== undefined) (sets.push('date = ?'), args.push(new Date(patch.date).getTime()));
  if (!sets.length) return;
  args.push(objectId, conversationId);
  await run(`UPDATE wall_objects SET ${sets.join(', ')} WHERE id = ? AND conversation_id = ?`, args);
}

export const removeWallObject = (conversationId, objectId) =>
  run('DELETE FROM wall_objects WHERE id = ? AND conversation_id = ?', [objectId, conversationId]);

export const countWallObjects = async (conversationId) =>
  (await one('SELECT COUNT(*) AS n FROM wall_objects WHERE conversation_id = ?', [conversationId]))?.n || 0;

/* ── pins ────────────────────────────────────────────────────────────────── */

export const countPins = async (conversationId) =>
  (await one('SELECT COUNT(*) AS n FROM pins WHERE conversation_id = ?', [conversationId]))?.n || 0;

export const isPinned = async (conversationId, messageId) =>
  Boolean(
    await one('SELECT 1 AS x FROM pins WHERE conversation_id = ? AND message_id = ?', [
      conversationId,
      messageId,
    ])
  );

export const addPin = (conversationId, messageId, userId) =>
  run('INSERT OR IGNORE INTO pins (conversation_id, message_id, pinned_by, at) VALUES (?, ?, ?, ?)', [
    conversationId,
    messageId,
    userId,
    now(),
  ]);

export const removePin = (conversationId, messageId) =>
  run('DELETE FROM pins WHERE conversation_id = ? AND message_id = ?', [conversationId, messageId]);

/* ── retention ───────────────────────────────────────────────────────────── */

export const conversationsWithRetention = () =>
  all('SELECT id, retention_days FROM conversations WHERE retention_days > 0');
