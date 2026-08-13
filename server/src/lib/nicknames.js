/**
 * Per-viewer nickname resolution.
 *
 * A nickname is what *you* call someone. It has to appear on every surface
 * where you see them — chat header, chat list, group member list, message
 * sender line, call screen — and nowhere else: the person renamed never learns
 * about it, and neither does anyone else in the group.
 *
 * The natural place to apply that is `serialize.js`, because every one of
 * those surfaces is fed by `serializeUser`. The problem is that the serialisers
 * are synchronous and are called from roughly fifty places, so "just await the
 * nicknames" is not available and threading a map through every call site
 * would be fifty chances to forget one — and forgetting one produces the worst
 * kind of bug, where a person's name is right in four places and wrong in the
 * fifth.
 *
 * So: a small in-memory cache, keyed by viewer, that the serialisers can read
 * synchronously. It is warmed at exactly the two points where a viewer enters
 * the system — `requireAuth` for REST, socket authentication for real-time —
 * and invalidated whenever that viewer changes a nickname.
 *
 * The failure mode if a cache entry is somehow missing is that the person's
 * real display name is shown. Not a leak, not a crash: just the unrenamed
 * name, which is exactly what a user who has set no nicknames sees anyway.
 */
import * as U from '../db/users.js';

/** viewerId -> { [contactId]: nickname } */
const cache = new Map();

/**
 * Bound so a long-lived process serving many accounts cannot grow without
 * limit. Nickname maps are tiny, so this is generous; eviction is oldest-first
 * because Map preserves insertion order.
 */
const MAX_VIEWERS = 5_000;

export async function warmNicknames(viewerId) {
  if (!viewerId) return {};
  const id = String(viewerId);

  const map = await U.nicknameMap(id);

  // Re-insert to move this viewer to the newest position for eviction order.
  cache.delete(id);
  cache.set(id, map);

  if (cache.size > MAX_VIEWERS) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  return map;
}

/** Synchronous read for the serialisers. Empty object when not warmed. */
export function nicknamesFor(viewerId) {
  return (viewerId && cache.get(String(viewerId))) || EMPTY;
}

const EMPTY = Object.freeze(Object.create(null));

export function invalidateNicknames(viewerId) {
  if (viewerId) cache.delete(String(viewerId));
}

/** Test seam, and used when the process wants a clean slate. */
export function clearNicknameCache() {
  cache.clear();
}
