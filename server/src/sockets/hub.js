/**
 * A tiny registry so HTTP routes can push over sockets without importing the
 * whole socket layer (and creating a cycle).
 *
 * Rooms: every socket joins `user:<id>`. We fan out per user rather than per
 * conversation room, because most payloads are viewer-specific (unread counts,
 * "deleted for me", view-once state).
 */

let io = null;

/** userId -> Set<socketId> */
const online = new Map();

export function bindIo(instance) {
  io = instance;
}

export const getIo = () => io;

export function trackConnect(userId, socketId) {
  const key = String(userId);
  if (!online.has(key)) online.set(key, new Set());
  online.get(key).add(socketId);
  return online.get(key).size;
}

export function trackDisconnect(userId, socketId) {
  const key = String(userId);
  const set = online.get(key);
  if (!set) return 0;
  set.delete(socketId);
  if (!set.size) online.delete(key);
  return set.size;
}

export const isOnline = (userId) => online.has(String(userId));
export const onlineUserIds = () => [...online.keys()];

export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
}

/**
 * @param conversation  a Conversation doc (members may be populated or not)
 * @param event         socket event name
 * @param payload       shared payload, or null when using perUser
 * @param perUser       (userId) => payload — for viewer-specific shapes
 * @param exceptUserId  skip this member
 */
export function emitToConversation(conversation, event, payload, perUser, exceptUserId) {
  if (!io || !conversation?.members) return;
  for (const member of conversation.members) {
    const uid = String(member.user?._id || member.user);
    if (exceptUserId && uid === String(exceptUserId)) continue;
    emitToUser(uid, event, perUser ? perUser(uid) : payload);
  }
}

export function memberIds(conversation, exceptUserId) {
  return (conversation?.members || [])
    .map((m) => String(m.user?._id || m.user))
    .filter((id) => !exceptUserId || id !== String(exceptUserId));
}
