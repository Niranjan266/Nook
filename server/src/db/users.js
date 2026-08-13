/**
 * Users, contacts, blocks and folders.
 *
 * Every function returns a plain object shaped like the old Mongoose document,
 * so `serialize.js` and the route handlers didn't need rewriting around a new
 * vocabulary. The database changed; the shape the rest of the app sees did not.
 */
import crypto from 'node:crypto';
import { all, one, run, newId, now, parseJson, toJson, bool, placeholders } from './index.js';

/**
 * Nook IDs — the short code you hand out instead of your username.
 *
 * The alphabet deliberately omits 0/O, 1/I/L and U. The first three are the
 * classic misreads when someone copies a code off a screen or hears it over a
 * call; U is dropped because excluding vowels makes accidental real words
 * (and accidental slurs) far less likely in a code people will read aloud.
 *
 * 26 symbols over 6 positions is ~309 million combinations. At a few thousand
 * users a collision is vanishingly unlikely, and `claimNookId` retries anyway.
 */
const NOOK_ALPHABET = '23456789abcdefghjkmnpqrstvwxyz'.replace(/[ilou]/g, '');
const NOOK_LENGTH = 6;

export function generateNookId() {
  // randomInt is uniform; `% alphabet.length` on a random byte is not, and a
  // biased ID space is a needless (if small) collision multiplier.
  let code = '';
  for (let i = 0; i < NOOK_LENGTH; i += 1) {
    code += NOOK_ALPHABET[crypto.randomInt(0, NOOK_ALPHABET.length)];
  }
  return `nook-${code}`;
}

/** Normalise anything a human might type or paste into canonical form. */
export function normaliseNookId(input) {
  const raw = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^nook[-\s]*/, '')
    .replace(/[^a-z0-9]/g, '');
  return raw ? `nook-${raw}` : '';
}

/**
 * Is this string plausibly a Nook ID rather than a name someone is searching for?
 *
 * Getting this wrong in the lenient direction is not harmless. `normaliseNookId`
 * prepends the prefix to anything, so a naive `/^nook-[a-z0-9]+$/` test on the
 * normalised value calls *every* ordinary word a Nook ID — "niranjan" included —
 * and the client would then tell the user "no account has that Nook ID" when
 * they were simply searching by name.
 *
 * Two checks make it strict: the code must be drawn entirely from the Nook
 * alphabet (which excludes i, l, o, u — so most real words are rejected on the
 * vowels alone), and a bare code with no prefix must be exactly the right
 * length.
 */
export function looksLikeNookId(input) {
  const raw = String(input || '').trim().toLowerCase();
  const hadPrefix = /^nook[-\s]/.test(raw);
  const code = normaliseNookId(raw).replace(/^nook-/, '');

  if (!code) return false;
  if (![...code].every((ch) => NOOK_ALPHABET.includes(ch))) return false;
  return hadPrefix ? code.length >= 4 && code.length <= 12 : code.length === NOOK_LENGTH;
}

export async function nookIdTaken(nookId) {
  const row = await one('SELECT 1 AS x FROM users WHERE nook_id = ?', [nookId]);
  return Boolean(row);
}

/**
 * Assign a fresh Nook ID, retrying on collision. The unique index is the real
 * guarantee — this loop just avoids surfacing the constraint error.
 */
export async function claimNookId(userId, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = generateNookId();
    try {
      await run('UPDATE users SET nook_id = ?, updated_at = ? WHERE id = ?', [candidate, now(), userId]);
      return candidate;
    } catch (err) {
      if (!/unique|constraint/i.test(err.message)) throw err;
    }
  }
  throw new Error('Could not allocate a Nook ID after several attempts.');
}

/**
 * Give a Nook ID to every account that predates the feature. Runs at boot;
 * cheap when there is nothing to do, since the WHERE clause hits the index.
 */
export async function backfillNookIds() {
  const rows = await all(`SELECT id FROM users WHERE nook_id = '' OR nook_id IS NULL`);
  for (const row of rows) await claimNookId(row.id);
  return rows.length;
}

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
    nookId: row.nook_id || '',
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
export const findUserByNookId = async (nookId) =>
  hydrateUser(await one(`${SELECT} WHERE nook_id = ?`, [normaliseNookId(nookId)]));

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

  // Separate write rather than an inline value in the INSERT: claimNookId
  // retries on collision, and a collision here would otherwise fail the whole
  // signup with a constraint error the user can do nothing about.
  await claimNookId(id);

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

/**
 * Find people by username, display name, or Nook ID.
 *
 * Two deliberate asymmetries:
 *
 * - Nook ID matches **exactly**, never as a substring. A code is something you
 *   were given, not something you browse for; substring matching would let
 *   anyone enumerate codes a few characters at a time.
 * - The query is lowercased before hitting `username`. Usernames are stored
 *   lowercased, and the previous `COLLATE NOCASE` bound only to the
 *   `display_name` operand — so searching "Niranjan" silently failed to match
 *   the username `niranjan` and only worked if the display name happened to
 *   agree.
 *
 * An exact Nook ID hit is returned alone: you typed a specific person's code,
 * so burying them under fuzzy name matches would be perverse.
 */
export async function searchUsers({ query, excludeId, excludeIds = [] }) {
  const skip = [excludeId, ...excludeIds].filter(Boolean);

  if (looksLikeNookId(query)) {
    const hit = await findUserByNookId(query);
    if (hit && !skip.includes(hit.id)) return [hit];
  }

  const lower = String(query).toLowerCase();
  const like = `%${lower}%`;
  const notIn = skip.length ? `AND id NOT IN (${placeholders(skip)})` : '';

  const rows = await all(
    `${SELECT}
      WHERE (username LIKE ?
             OR display_name LIKE ? COLLATE NOCASE
             OR nook_id = ?)
        ${notIn}
      ORDER BY
        CASE WHEN username = ? THEN 0 ELSE 1 END,
        username
      LIMIT 20`,
    [like, like, normaliseNookId(query), lower, ...skip]
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

/* ── nicknames ───────────────────────────────────────────────────────────────
   What *you* call someone. Never visible to them, never visible to anyone
   else. Stored on the contact edge so one rename covers every surface: direct
   chats, group member lists, message senders, the call screen.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Setting a nickname implies the contact edge exists — you can rename someone
 * in a group without having deliberately "added" them, and losing the name the
 * moment they're removed from your contacts would be baffling. So upsert.
 */
export async function setNickname(userId, contactId, nickname) {
  const clean = String(nickname || '').trim().slice(0, 40);
  await run('INSERT OR IGNORE INTO user_contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)', [
    userId,
    contactId,
    now(),
  ]);
  await run('UPDATE user_contacts SET nickname = ? WHERE user_id = ? AND contact_id = ?', [
    clean,
    userId,
    contactId,
  ]);
  return clean;
}

export const clearNickname = (userId, contactId) =>
  run(`UPDATE user_contacts SET nickname = '' WHERE user_id = ? AND contact_id = ?`, [userId, contactId]);

/**
 * Every nickname this viewer has set, as `{ [contactId]: nickname }`.
 *
 * One query per request, cached on `req` by the middleware, then handed to the
 * serialisers. The alternative — looking each name up where it is rendered —
 * would be a query per message.
 */
export async function nicknameMap(userId) {
  const rows = await all(
    `SELECT contact_id, nickname FROM user_contacts WHERE user_id = ? AND nickname <> ''`,
    [userId]
  );
  const map = Object.create(null);
  for (const row of rows) map[row.contact_id] = row.nickname;
  return map;
}

/** Contacts with their nicknames, for the contacts list. */
export async function contactRows(userId) {
  return all('SELECT contact_id, nickname, created_at FROM user_contacts WHERE user_id = ?', [userId]);
}

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
