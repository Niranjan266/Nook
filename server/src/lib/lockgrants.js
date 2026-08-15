/**
 * Short-lived proof that someone has entered a chat's code.
 *
 * Without this the lock would be decoration: the screen would hide the
 * messages while `GET /messages/:id` handed them to anyone with a session, so
 * a locked chat would be one devtools request away from being read. A grant
 * makes the lock mean something on the server, which is where it has to mean
 * something.
 *
 * Deliberately in memory. A grant is a statement about *this session, right
 * now* — surviving a server restart is not a feature, it is the lock quietly
 * staying open longer than the person expected. The cost is that a restart
 * re-locks everything, which is the failure direction to prefer.
 */

/** `${userId}:${conversationId}` -> expiry in ms */
const grants = new Map();

/** Long enough to read a conversation, short enough that a walk-away re-locks. */
const TTL_MS = 15 * 60 * 1000;

/** Bound on a long-lived process; entries are tiny and expire anyway. */
const MAX = 20_000;

const key = (userId, conversationId) => `${userId}:${conversationId}`;

export function grantUnlock(userId, conversationId, ttlMs = TTL_MS) {
  if (grants.size > MAX) sweep();
  grants.set(key(userId, conversationId), Date.now() + ttlMs);
}

export function hasUnlock(userId, conversationId) {
  const k = key(userId, conversationId);
  const until = grants.get(k);
  if (!until) return false;
  if (until <= Date.now()) {
    grants.delete(k);
    return false;
  }
  return true;
}

/** Locking again, changing the code, or signing out all end the grant. */
export function revokeUnlock(userId, conversationId) {
  grants.delete(key(userId, conversationId));
}

export function revokeAllFor(userId) {
  const prefix = `${userId}:`;
  for (const k of grants.keys()) if (k.startsWith(prefix)) grants.delete(k);
}

function sweep() {
  const now = Date.now();
  for (const [k, until] of grants) if (until <= now) grants.delete(k);
}

export function clearGrants() {
  grants.clear();
}
