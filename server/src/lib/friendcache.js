/**
 * Per-viewer friendship, readable synchronously.
 *
 * `serializeConversation` has to say whether you may write in a chat, and it is
 * synchronous — the same constraint that produced `nicknames.js`, solved the
 * same way and for the same reason: threading the answer through every call
 * site is fifty chances to forget one, and the one you forget is the chat that
 * mysteriously lets you type when it shouldn't.
 *
 * This cache is *only* for deciding what the UI shows. It is never the thing
 * that stops a message: that check lives in `createMessage`, hits the database,
 * and cannot be fooled by a stale entry. A wrong answer here at worst shows a
 * composer that then refuses politely — never the reverse.
 */
import * as F from '../db/friends.js';

/** viewerId -> Set of user ids they may write to */
const cache = new Map();
const MAX_VIEWERS = 5_000;
const EMPTY = Object.freeze(new Set());

export async function warmFriends(viewerId) {
  if (!viewerId) return EMPTY;
  const id = String(viewerId);

  const set = new Set(await F.friendIds(id));

  // Re-insert so this viewer moves to the newest position for eviction order.
  cache.delete(id);
  cache.set(id, set);

  if (cache.size > MAX_VIEWERS) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  return set;
}

export function friendsOf(viewerId) {
  return (viewerId && cache.get(String(viewerId))) || EMPTY;
}

/**
 * True when the viewer may write to this person. Talking to yourself is always
 * allowed — the saved-messages chat everyone uses as a notepad would otherwise
 * lock itself.
 */
export function canWriteTo(viewerId, otherId) {
  if (!viewerId || !otherId) return false;
  if (String(viewerId) === String(otherId)) return true;
  return friendsOf(viewerId).has(String(otherId));
}

export function invalidateFriends(...viewerIds) {
  for (const id of viewerIds) if (id) cache.delete(String(id));
}

export function clearFriendCache() {
  cache.clear();
}
