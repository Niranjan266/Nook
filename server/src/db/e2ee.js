/**
 * Secret-chat key directory: the public half of every device's keys.
 *
 * Nothing in here can decrypt anything. The server's whole job for secret
 * chats is to hand out public keys and relay ciphertext, and keeping the key
 * table in its own small module makes that easy to check.
 */
import { all, one, run, now, parseJson, toJson } from './index.js';

/** Ten is generous for one person, and stops the table being a dumping ground. */
const MAX_DEVICES = 10;

function hydrateDevice(row) {
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    identityPub: parseJson(row.identity_pub, null),
    signingPub: parseJson(row.signing_pub, null),
    createdAt: new Date(row.created_at),
    lastSeen: new Date(row.last_seen),
  };
}

export async function devicesOf(userId) {
  const rows = await all(
    'SELECT * FROM e2ee_devices WHERE user_id = ? ORDER BY last_seen DESC',
    [userId]
  );
  return rows.map(hydrateDevice);
}

export async function findDevice(userId, deviceId) {
  const row = await one('SELECT * FROM e2ee_devices WHERE user_id = ? AND device_id = ?', [
    userId,
    deviceId,
  ]);
  return row ? hydrateDevice(row) : null;
}

/**
 * Register a device, or say it is still alive.
 *
 * Re-registering the same device id with different keys is allowed — it is
 * the owner's own row — but it is exactly what a key change looks like, and
 * the clients bound to that device will say so in the chat. Returns whether
 * the keys changed, so the route can tell the caller honestly.
 */
export async function upsertDevice(userId, { deviceId, identityPub, signingPub }) {
  const t = now();
  const existing = await findDevice(userId, deviceId);
  const identity = toJson(identityPub);
  const signing = toJson(signingPub);

  if (existing) {
    const changed =
      toJson(existing.identityPub) !== identity || toJson(existing.signingPub) !== signing;
    await run(
      `UPDATE e2ee_devices SET identity_pub = ?, signing_pub = ?, last_seen = ?
        WHERE user_id = ? AND device_id = ?`,
      [identity, signing, t, userId, deviceId]
    );
    return { created: false, changed };
  }

  await run(
    `INSERT INTO e2ee_devices (user_id, device_id, identity_pub, signing_pub, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, deviceId, identity, signing, t, t]
  );

  // Oldest out first: a device nobody has opened in the longest time is the
  // one least likely to be anyone's secret chat.
  await run(
    `DELETE FROM e2ee_devices
      WHERE user_id = ?
        AND device_id NOT IN (SELECT device_id FROM e2ee_devices WHERE user_id = ?
                               ORDER BY last_seen DESC LIMIT ?)`,
    [userId, userId, MAX_DEVICES]
  );
  return { created: true, changed: false };
}

/** Do these two people share any conversation at all? */
export const shareAConversation = async (a, b) =>
  Boolean(
    await one(
      `SELECT 1 AS x FROM conversation_members m1
         JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id AND m2.user_id = ?
        WHERE m1.user_id = ? LIMIT 1`,
      [b, a]
    )
  );

/** The secret chat already bound to exactly these two devices, if any. */
export async function findSecretBetween(a, aDevice, b, bDevice) {
  const rows = await all(
    `SELECT c.id, c.secret FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
      WHERE c.type = 'secret'`,
    [a, b]
  );
  for (const row of rows) {
    const s = parseJson(row.secret, null);
    if (!s) continue;
    const ends = [
      `${s.initiator?.userId}:${s.initiator?.deviceId}`,
      `${s.responder?.userId}:${s.responder?.deviceId}`,
    ];
    if (ends.includes(`${a}:${aDevice}`) && ends.includes(`${b}:${bDevice}`)) return row.id;
  }
  return null;
}

export const setSecret = (conversationId, secret) =>
  run('UPDATE conversations SET secret = ?, updated_at = ? WHERE id = ?', [
    toJson(secret),
    now(),
    conversationId,
  ]);
