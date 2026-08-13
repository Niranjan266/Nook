/**
 * Users, contacts, blocks and folders.
 *
 * Every function returns a plain object shaped like the old Mongoose document,
 * so `serialize.js` and the route handlers didn't need rewriting around a new
 * vocabulary. The database changed; the shape the rest of the app sees did not.
 */
import { all, one, run, newId, now, parseJson, toJson, bool, placeholders } from './index.js';

const DEFAULT_PRIVACY = { lastSeen: 'contacts', readReceipts: true, avatar: 'everyone' };
const DEFAULT_SETTINGS = {
  theme: 'system',
  enterToSend: true,
  soundOn: true,
  reduceMotion: false,
  swipeToReply: true,
  linkPreviews: true,
  badgeCount: false,
  voiceSpeed: 1,
  skipSilence: false,
};
const DEFAULT_QUIET = {
  enabled: false,
  start: 22 * 60,
  end: 7 * 60,
  timezone: '',
  allowUrgent: true,
  visible: true,
};

/** Row → the object shape the rest of the server expects. */
export function hydrateUser(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    recovery: { code: row.recovery_code, expiresAt: row.recovery_expires },
    avatarUrl: row.avatar_url,
    about: row.about,
    accent: row.accent,
    lastSeen: row.last_seen ? new Date(row.last_seen) : null,
    online: Boolean(row.online),
    lastNudgeAt: row.last_nudge_at ? new Date(row.last_nudge_at) : null,
    privacy: { ...DEFAULT_PRIVACY, ...parseJson(row.privacy) },
    settings: { ...DEFAULT_SETTINGS, ...parseJson(row.settings) },
    quietHours: { ...DEFAULT_QUIET, ...parseJson(row.quiet_hours) },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT = 'SELECT * FROM users';

export const findUserById = async (id) => hydrateUser(await one(`${SELECT} WHERE id = ?`, [id]));
export const findUserByUsername = async (username) =>
  hydrateUser(await one(`${SELECT} WHERE username = ?`, [String(username).toLowerCase()]));

export async function usernameTaken(username) {
  const row = await one('SELECT 1 AS x FROM users WHERE username = ?', [String(username).toLowerCase()]);
  return Boolean(row);
}

export async function findUsersByIds(ids) {
  if (!ids?.length) return [];
  const rows = await all(`${SELECT} WHERE id IN (${placeholders(ids)})`, ids);
  return rows.map(hydrateUser);
}

export async function createUser({ username, displayName, passwordHash, email = '', about, accent, privacy }) {
  const id = newId();
  const t = now();
  await run(
    `INSERT INTO users
       (id, username, display_name, password_hash, email, about, accent,
        privacy, settings, quiet_hours, last_seen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(username).toLowerCase(),
      displayName,
      passwordHash,
      email || '',
      about || 'Somewhere quiet.',
      accent || 'terracotta',
      toJson({ ...DEFAULT_PRIVACY, ...(privacy || {}) }),
      toJson(DEFAULT_SETTINGS),
      toJson(DEFAULT_QUIET),
      t,
      t,
      t,
    ]
  );
  return findUserById(id);
}

const FIELD_MAP = {
  displayName: 'display_name',
  avatarUrl: 'avatar_url',
  about: 'about',
  accent: 'accent',
  email: 'email',
  emailVerified: 'email_verified',
  online: 'online',
  lastSeen: 'last_seen',
  lastNudgeAt: 'last_nudge_at',
  passwordHash: 'password_hash',
};

const JSON_FIELDS = { privacy: 'privacy', settings: 'settings', quietHours: 'quiet_hours' };

export async function updateUser(id, patch) {
  const sets = [];
  const args = [];

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (typeof value === 'boolean') value = bool(value);
    if (value instanceof Date) value = value.getTime();
    sets.push(`${column} = ?`);
    args.push(value);
  }

  // JSON columns are merged, not replaced — a partial settings update must not
  // wipe the keys it didn't mention.
  for (const [key, column] of Object.entries(JSON_FIELDS)) {
    if (patch[key] === undefined) continue;
    const current = await one(`SELECT ${column} AS v FROM users WHERE id = ?`, [id]);
    sets.push(`${column} = ?`);
    args.push(toJson({ ...parseJson(current?.v), ...patch[key] }));
  }

  if (patch.recovery !== undefined) {
    sets.push('recovery_code = ?', 'recovery_expires = ?');
    args.push(patch.recovery?.code || '', patch.recovery?.expiresAt ? new Date(patch.recovery.expiresAt).getTime() : null);
  }

  if (!sets.length) return findUserById(id);

  sets.push('updated_at = ?');
  args.push(now(), id);
  await run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args);
  return findUserById(id);
}

export async function searchUsers({ query, excludeId, excludeIds = [] }) {
  const like = `%${query}%`;
  const skip = [excludeId, ...excludeIds].filter(Boolean);
  const notIn = skip.length ? `AND id NOT IN (${placeholders(skip)})` : '';
  const rows = await all(
    `${SELECT}
      WHERE (username LIKE ? OR display_name LIKE ? COLLATE NOCASE)
        ${notIn}
      ORDER BY username
      LIMIT 20`,
    [like, like, ...skip]
  );
  return rows.map(hydrateUser);
}

/* ── contacts and blocks ─────────────────────────────────────────────────── */

export async function contactIds(userId) {
  const rows = await all('SELECT contact_id FROM user_contacts WHERE user_id = ?', [userId]);
  return rows.map((r) => r.contact_id);
}

export async function blockedIds(userId) {
  const rows = await all('SELECT blocked_id FROM user_blocks WHERE user_id = ?', [userId]);
  return rows.map((r) => r.blocked_id);
}

export const addContact = (userId, contactId) =>
  run('INSERT OR IGNORE INTO user_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)', [
    userId,
    contactId,
    now(),
  ]);

export const removeContact = (userId, contactId) =>
  run('DELETE FROM user_contacts WHERE user_id = ? AND contact_id = ?', [userId, contactId]);

export async function blockUser(userId, blockedId) {
  await run('INSERT OR IGNORE INTO user_blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)', [
    userId,
    blockedId,
    now(),
  ]);
  await removeContact(userId, blockedId);
}

export const unblockUser = (userId, blockedId) =>
  run('DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?', [userId, blockedId]);

/** Blocked in either direction — messaging is refused both ways. */
export async function blockExistsBetween(a, b) {
  const row = await one(
    `SELECT 1 AS x FROM user_blocks
      WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`,
    [a, b, b, a]
  );
  return Boolean(row);
}

/* ── folders ─────────────────────────────────────────────────────────────── */

export async function listFolders(userId) {
  const folders = await all('SELECT * FROM folders WHERE user_id = ? ORDER BY position, name', [userId]);
  if (!folders.length) return [];

  const links = await all('SELECT folder_id, conversation_id FROM folder_conversations WHERE user_id = ?', [
    userId,
  ]);

  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    conversations: links.filter((l) => l.folder_id === f.id).map((l) => l.conversation_id),
  }));
}

/** Replace the whole set — simplest correct semantics for a reorderable list. */
export async function replaceFolders(userId, folders) {
  await run('DELETE FROM folder_conversations WHERE user_id = ?', [userId]);
  await run('DELETE FROM folders WHERE user_id = ?', [userId]);

  for (const [index, folder] of folders.entries()) {
    await run('INSERT INTO folders (id, user_id, name, emoji, position) VALUES (?, ?, ?, ?, ?)', [
      folder.id,
      userId,
      folder.name,
      folder.emoji || '',
      index,
    ]);
    for (const conversationId of folder.conversations || []) {
      await run(
        'INSERT OR IGNORE INTO folder_conversations (user_id, folder_id, conversation_id) VALUES (?, ?, ?)',
        [userId, folder.id, conversationId]
      );
    }
  }
  return listFolders(userId);
}

export const addToFolder = (userId, folderId, conversationId) =>
  run(
    'INSERT OR IGNORE INTO folder_conversations (user_id, folder_id, conversation_id) VALUES (?, ?, ?)',
    [userId, folderId, conversationId]
  );

export const removeFromFolder = (userId, folderId, conversationId) =>
  run(
    'DELETE FROM folder_conversations WHERE user_id = ? AND folder_id = ? AND conversation_id = ?',
    [userId, folderId, conversationId]
  );

export const folderExists = async (userId, folderId) =>
  Boolean(await one('SELECT 1 AS x FROM folders WHERE user_id = ? AND id = ?', [userId, folderId]));

/* ── presence ────────────────────────────────────────────────────────────── */

export const setPresence = (userId, online, lastSeen = Date.now()) =>
  run('UPDATE users SET online = ?, last_seen = ? WHERE id = ?', [bool(online), lastSeen, userId]);

export async function presenceFor(ids) {
  if (!ids?.length) return [];
  return all(
    `SELECT id, online, last_seen, quiet_hours, privacy FROM users WHERE id IN (${placeholders(ids)})`,
    ids
  );
}
