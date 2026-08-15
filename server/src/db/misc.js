/** Calls, push subscriptions, spaces and guest links. */
import { all, one, run, newId, now, parseJson, toJson, bool } from './index.js';

/* ── calls ───────────────────────────────────────────────────────────────── */

const hydrateCall = (row) =>
  row && {
    _id: row.id,
    id: row.id,
    conversation: row.conversation_id,
    caller: row.caller_id,
    callee: row.callee_id,
    kind: row.kind,
    status: row.status,
    startedAt: new Date(row.started_at),
    answeredAt: row.answered_at ? new Date(row.answered_at) : null,
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    duration: row.duration,
  };

export async function createCall({ conversationId, callerId, calleeId, kind }) {
  const id = newId();
  await run(
    `INSERT INTO calls (id, conversation_id, caller_id, callee_id, kind, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'ringing', ?)`,
    [id, conversationId, callerId, calleeId, kind === 'video' ? 'video' : 'audio', now()]
  );
  return hydrateCall(await one('SELECT * FROM calls WHERE id = ?', [id]));
}

export const findCall = async (id) => hydrateCall(await one('SELECT * FROM calls WHERE id = ?', [id]));

export async function updateCall(id, patch) {
  const sets = [];
  const args = [];
  for (const [key, column] of [
    ['status', 'status'],
    ['duration', 'duration'],
  ]) {
    if (patch[key] !== undefined) (sets.push(`${column} = ?`), args.push(patch[key]));
  }
  for (const [key, column] of [
    ['answeredAt', 'answered_at'],
    ['endedAt', 'ended_at'],
  ]) {
    if (patch[key] !== undefined)
      (sets.push(`${column} = ?`), args.push(patch[key] ? new Date(patch[key]).getTime() : null));
  }
  if (!sets.length) return findCall(id);
  args.push(id);
  await run(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`, args);
  return findCall(id);
}

export async function listCalls(userId, limit = 100) {
  return all(
    `SELECT c.*,
            cu.username AS caller_username, cu.display_name AS caller_name,
            cu.avatar_url AS caller_avatar, cu.accent AS caller_accent,
            eu.username AS callee_username, eu.display_name AS callee_name,
            eu.avatar_url AS callee_avatar, eu.accent AS callee_accent
       FROM calls c
       JOIN users cu ON cu.id = c.caller_id
       JOIN users eu ON eu.id = c.callee_id
      WHERE c.caller_id = ? OR c.callee_id = ?
      ORDER BY c.started_at DESC
      LIMIT ?`,
    [userId, userId, limit]
  );
}

/* ── push subscriptions ──────────────────────────────────────────────────── */

export const upsertPushSubscription = ({ userId, endpoint, keys, userAgent }) =>
  run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id,
                                          p256dh = excluded.p256dh,
                                          auth = excluded.auth`,
    [endpoint, userId, keys.p256dh, keys.auth, userAgent || '', now()]
  );

export const pushSubscriptionsFor = (userId) =>
  all('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);

export const deletePushSubscription = (endpoint) =>
  run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);

/* ── spaces ──────────────────────────────────────────────────────────────── */

export async function createSpace({ name, kind, ownerId, accent, inviteCode }) {
  const id = newId();
  const t = now();
  await run(
    `INSERT INTO spaces (id, name, kind, owner_id, branding, invite_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, kind, ownerId, toJson({ logoUrl: '', accent: accent || 'terracotta', wallpaperPreset: '' }), inviteCode, t, t]
  );
  await run('INSERT INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [
    id,
    ownerId,
    'owner',
    t,
  ]);
  return findSpace(id);
}

export async function findSpace(id) {
  const row = await one('SELECT * FROM spaces WHERE id = ?', [id]);
  if (!row) return null;
  const members = await all('SELECT * FROM space_members WHERE space_id = ?', [id]);
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    kind: row.kind,
    owner: row.owner_id,
    branding: parseJson(row.branding),
    retentionDays: row.retention_days,
    inviteCode: row.invite_code,
    members: members.map((m) => ({ user: m.user_id, role: m.role, joinedAt: new Date(m.joined_at) })),
  };
}

export async function listSpacesFor(userId) {
  const rows = await all(
    `SELECT s.*, sm.role,
            (SELECT COUNT(*) FROM space_members x WHERE x.space_id = s.id) AS member_count
       FROM spaces s
       JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
      ORDER BY s.created_at`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    branding: parseJson(r.branding),
    retentionDays: r.retention_days,
    inviteCode: r.invite_code,
    role: r.role,
    memberCount: r.member_count,
  }));
}

export async function updateSpace(id, patch) {
  const sets = [];
  const args = [];
  if (patch.name !== undefined) (sets.push('name = ?'), args.push(patch.name));
  if (patch.retentionDays !== undefined) (sets.push('retention_days = ?'), args.push(patch.retentionDays));
  if (patch.branding !== undefined) {
    const current = await one('SELECT branding FROM spaces WHERE id = ?', [id]);
    sets.push('branding = ?');
    args.push(toJson({ ...parseJson(current?.branding), ...patch.branding }));
  }
  if (!sets.length) return findSpace(id);
  sets.push('updated_at = ?');
  args.push(now(), id);
  await run(`UPDATE spaces SET ${sets.join(', ')} WHERE id = ?`, args);
  return findSpace(id);
}

export const addSpaceMember = (spaceId, userId, role = 'member') =>
  run('INSERT OR IGNORE INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [
    spaceId,
    userId,
    role,
    now(),
  ]);

export const removeSpaceMember = (spaceId, userId) =>
  run('DELETE FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);

/**
 * Remove someone from every conversation in a space at once.
 * This is the "an employee left today" button, and it needs to be one action.
 */
export async function revokeSpaceAccess(spaceId, userId) {
  const result = await run(
    `DELETE FROM conversation_members
      WHERE user_id = ?
        AND conversation_id IN (SELECT id FROM conversations WHERE space_id = ?)`,
    [userId, spaceId]
  );
  return result.rowsAffected ?? 0;
}

export const isSpaceMember = async (spaceId, userId) =>
  Boolean(
    await one('SELECT 1 AS x FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId])
  );

export const spaceRoleOf = async (spaceId, userId) =>
  (await one('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]))
    ?.role || null;

/* ── guest links ─────────────────────────────────────────────────────────── */

export async function createGuestLink({ code, conversationId, createdBy, label, expiresAt, maxUses }) {
  await run(
    `INSERT INTO guest_links (code, conversation_id, created_by, label, expires_at, max_uses, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [code, conversationId, createdBy, label || 'Guest', expiresAt ? new Date(expiresAt).getTime() : null, maxUses || 0, now()]
  );
  return findGuestLink(code);
}

export async function findGuestLink(code) {
  const row = await one('SELECT * FROM guest_links WHERE code = ?', [code]);
  if (!row) return null;
  return {
    code: row.code,
    conversation: row.conversation_id,
    createdBy: row.created_by,
    label: row.label,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    maxUses: row.max_uses,
    uses: row.uses,
    revoked: Boolean(row.revoked),
  };
}

export const listGuestLinks = (conversationId) =>
  all('SELECT * FROM guest_links WHERE conversation_id = ? AND revoked = 0', [conversationId]);

export const useGuestLink = (code) => run('UPDATE guest_links SET uses = uses + 1 WHERE code = ?', [code]);
export const revokeGuestLink = (code) => run('UPDATE guest_links SET revoked = 1 WHERE code = ?', [code]);

/* ── native push devices (the Android app) ──────────────────────────────── */

/**
 * Keyed on the token, so re-registering the same device moves it to whichever
 * account signed in last rather than leaving a phone subscribed to both.
 */
export const saveDevice = (userId, token, platform = 'android') =>
  run(
    `INSERT INTO push_devices (token, user_id, platform, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`,
    [token, userId, platform, now()]
  );

export const devicesFor = (userId) =>
  all('SELECT token, platform FROM push_devices WHERE user_id = ?', [userId]);

export const deleteDevice = (token) => run('DELETE FROM push_devices WHERE token = ?', [token]);
