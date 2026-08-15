import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import { findUserById, blockExistsBetween } from '../db/users.js';
import { areFriends } from '../db/friends.js';
import { serializeMessage } from '../lib/serialize.js';
import { emitToConversation, emitToUser, isOnline } from '../sockets/hub.js';
import { notify } from './push.js';
import { isQuietNow } from './quietHours.js';
import { fetchPreview, firstUrlIn } from './linkPreview.js';
import { httpError } from '../middleware/error.js';

export const preview = (m) => {
  if (m.type === 'text') return (m.body || '').slice(0, 120);
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'voice') return '🎙 Voice message';
  if (m.type === 'audio') return '🎵 Audio';
  if (m.type === 'file') return `📎 ${m.media?.name || 'File'}`;
  if (m.type === 'snap') return '🔥 Snap';
  if (m.type === 'call') return m.call?.kind === 'video' ? 'Video call' : 'Voice call';
  return m.body || '';
};

/**
 * May this person put a message in front of the others in this conversation?
 *
 * Checks EVERY other member, not just the first. `memberIdsOf` has no ORDER BY
 * and the old code tested only index [0], so a direct conversation with a
 * third member — which guest links can produce — left the real recipient
 * unchecked entirely.
 *
 * Groups are checked too. Exempting them made a two-person group an ungated
 * DM that bypassed both friendship and blocking; membership is now granted
 * only to people who accepted you, so this is consistent rather than stricter.
 */
export async function assertMayReach(convo, senderId) {
  const others = await C.memberIdsOf(convo.id, senderId);
  for (const otherId of others) {
    if (await blockExistsBetween(senderId, otherId))
      throw httpError(403, 'You cannot message this person.');
    if (convo.type === 'direct' && !(await areFriends(senderId, otherId)))
      throw httpError(403, 'They need to accept your request before you can chat.', {
        code: 'NOT_FRIENDS',
      });
  }
}

/**
 * Single entry point for creating a message — used by both the socket handler
 * and the REST fallback so behaviour can never drift between them.
 *
 * `system` is for messages the server itself sends: an admin announcement from
 * the Nook account. Those have no friendship to check, and requiring one would
 * mean nobody could be told anything until they had befriended a robot. It is
 * a named parameter rather than a special-cased sender id so the exemption is
 * visible at every call site that uses it.
 */
export async function createMessage({ conversationId, senderId, payload, system = false }) {
  const convo = await C.findConversationForUser(conversationId, senderId);
  if (!convo) throw httpError(404, 'That conversation is not yours.');

  /* ── slow mode ─────────────────────────────────────────────────────────
     Per person, not per conversation: one chatty member shouldn't be able to
     mute everyone else.                                                    */
  if (convo.slowMode > 0 && !payload.threadRoot) {
    const last = await M.lastMessageFrom(convo.id, senderId);
    if (last) {
      const waited = (Date.now() - last.created_at) / 1000;
      if (waited < convo.slowMode) {
        throw httpError(
          429,
          `Slow mode is on — ${Math.ceil(convo.slowMode - waited)}s before you can send again.`
        );
      }
    }
  }

  /**
   * Blocked either way, or not friends yet? Refuse.
   *
   * This is the single choke point every message goes through — REST, sockets,
   * scheduled sends and forwards all land here — which is exactly why the rule
   * belongs here and nowhere else. Enforcing at send rather than at creation
   * is deliberate: the conversation is allowed to exist so the recipient has
   * something to accept *from*, and so a rejected sender can still see the
   * chat they are waiting on rather than a dead end.
   */
  if (!system) await assertMayReach(convo, senderId);

  // A thread reply must belong to a real root in this same conversation, and
  // threads are one level deep on purpose — nesting turns a chat into a forum.
  let threadRoot = null;
  if (payload.threadRoot) {
    const root = await M.findMessage(payload.threadRoot);
    if (!root || String(root.conversation) !== String(convo.id))
      throw httpError(404, 'That thread no longer exists.');
    threadRoot = root.threadRoot ? await M.findMessage(root.threadRoot) : root;
  }

  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null;
  const isScheduled = Boolean(scheduledFor && scheduledFor.getTime() > Date.now() + 5000);

  const id = await M.createMessageRow({
    conversationId: convo.id,
    senderId,
    type: payload.type || 'text',
    body: payload.body,
    media: payload.media,
    replyTo: payload.replyTo || null,
    forwardedFrom: payload.forwardedFrom || null,
    mentions: payload.mentions || [],
    clientId: payload.clientId || '',
    viewOnce: Boolean(payload.viewOnce),
    viewSeconds: Number.isFinite(payload.viewSeconds) ? payload.viewSeconds : 10,
    threadRoot: threadRoot?.id || null,
    transcript: payload.transcript || '',
    scheduledFor: isScheduled ? scheduledFor : null,
    delivered: !isScheduled,
    call: payload.call,
    expiresAt: convo.disappearAfter ? new Date(Date.now() + convo.disappearAfter * 1000) : null,
  });

  const message = await M.findMessage(id);

  // A scheduled message exists but hasn't happened yet — only the author sees it.
  if (isScheduled) {
    emitToUser(senderId, 'message:scheduled', serializeMessage(message, senderId));
    return { message, conversation: convo, scheduled: true };
  }

  // `system` has to travel with it: deliver re-checks, and an admin
  // announcement would otherwise be refused at the last step.
  await deliver({ message, convo, senderId, threadRoot, system });
  return { message, conversation: convo };
}

/**
 * Everything that happens the moment a message becomes real: counters, fan-out,
 * receipts, push. Split out so the scheduler can reuse it verbatim.
 */
export async function deliver({ message, convo, senderId, threadRoot, system = false }) {
  /**
   * Re-checked here, not only at creation.
   *
   * The scheduler calls `deliver` directly, so a message scheduled a month
   * ahead was delivered no matter what happened in between — unfriending or
   * blocking the sender did not stop it. The check has to sit where the
   * message actually reaches someone, which is here.
   */
  if (!system) await assertMayReach(convo, senderId);

  if (threadRoot) {
    // Thread replies bump the thread, not the main stream.
    await M.bumpThread(threadRoot.id);
    await C.touchConversation(convo.id);
  } else {
    await C.updateConversation(convo.id, { lastMessageId: message.id, lastActivity: Date.now() });
  }

  await C.bumpUnread(convo.id, senderId);
  await C.clearDraft(convo.id, senderId);

  if (threadRoot) {
    const updatedRoot = await M.findMessage(threadRoot.id);
    emitToConversation(convo, 'thread:new', null, (uid) => ({
      rootId: String(threadRoot.id),
      message: serializeMessage(message, uid),
      root: serializeMessage(updatedRoot, uid),
    }));
  } else {
    emitToConversation(convo, 'message:new', null, (uid) => serializeMessage(message, uid));
  }

  // Link previews are fetched after the message lands, then patched in — the
  // message must never wait on a third-party server.
  maybeAttachPreview(message, convo).catch(() => {});

  // Delivery receipts for anyone currently connected.
  const recipients = await C.memberIdsOf(convo.id, senderId);
  const connected = recipients.filter(isOnline);
  if (connected.length) {
    await M.markDelivered(message.id, connected);
    emitToUser(senderId, 'receipt:delivered', {
      conversationId: String(convo.id),
      messageIds: [String(message.id)],
      userIds: connected,
    });
  }

  // Push for everyone else — unless muted, or it's their quiet hours.
  const sender = await findUserById(senderId);
  for (const member of convo.members) {
    const uid = String(member.user?.id || member.user);
    if (uid === String(senderId) || member.muted || isOnline(uid)) continue;

    /**
     * A locked chat gets no push at all.
     *
     * This was the worst of the lock's leaks, because it fires precisely when
     * the person is *not* looking — the message text landing on a lock screen
     * in front of whoever else is in the room, which is the exact situation
     * the feature exists to prevent. Sending a contentless "New message" was
     * tempting, but even that tells a bystander the locked chat is active.
     */
    if (member.locked && member.lockHash) continue;

    const recipient = await findUserById(uid);
    if (isQuietNow(recipient?.quietHours)) continue; // it'll be there in the morning

    const prefs = recipient?.settings || {};
    if (convo.type === 'group' && prefs.notifyGroups === false) continue;

    /**
     * Previews off means the notification says who, not what.
     *
     * The alternative — dropping the notification entirely — would be a worse
     * reading of the setting: people turn previews off because a message can
     * appear on a lock screen in front of other people, not because they stop
     * wanting to know someone wrote to them.
     */
    const showPreview = prefs.notifyPreview !== false;

    notify(uid, {
      title: convo.type === 'group' ? `${sender.displayName} · ${convo.name}` : sender.displayName,
      body: showPreview ? preview(message) : 'New message',
      tag: `convo-${convo.id}`,
      conversationId: String(convo.id),
      messageId: String(message.id),
      icon: sender.avatarUrl || '/logo.svg',
      sound: member.sound || 'default',
    }).catch(() => {});
  }

  return { message, conversation: convo };
}

/**
 * Fetch a link preview and patch it into the message. Deliberately fire-and-
 * forget: a slow third-party site must never delay a message.
 */
async function maybeAttachPreview(message, convo) {
  if (message.type !== 'text' || message.linkPreview?.url) return;
  const url = firstUrlIn(message.body);
  if (!url) return;

  try {
    const data = await fetchPreview(url);
    await M.setLinkPreview(message.id, data);
    const fresh = await M.findMessage(message.id);
    emitToConversation(convo, 'message:preview', null, (uid) => serializeMessage(fresh, uid));
  } catch {
    /* no preview is a perfectly fine outcome */
  }
}

export async function markRead({ conversationId, userId, upTo }) {
  const convo = await C.findConversationForUser(conversationId, userId);
  if (!convo) return null;

  const user = await findUserById(userId);
  const cutoff = upTo ? new Date(upTo) : new Date();

  const unread = await M.unreadMessagesFor(convo.id, userId, cutoff);
  if (unread.length) await M.markRead(unread.map((m) => m.id), userId);

  await C.updateMemberPrefs(convo.id, userId, { unread: 0, lastReadAt: cutoff });

  // Respect the reader's "send read receipts" setting.
  if (user?.privacy?.readReceipts !== false && unread.length) {
    const bySender = new Map();
    for (const { id, sender_id } of unread) {
      if (!bySender.has(sender_id)) bySender.set(sender_id, []);
      bySender.get(sender_id).push(String(id));
    }
    for (const [sender, messageIds] of bySender) {
      emitToUser(sender, 'receipt:read', {
        conversationId: String(convo.id),
        messageIds,
        userId: String(userId),
      });
    }
  }

  emitToUser(userId, 'conversation:read', { conversationId: String(convo.id) });
  return convo;
}

/** A system line in the stream: "X pinned a message", "Y joined". */
export async function systemMessage(convo, senderId, body) {
  const id = await M.createMessageRow({
    conversationId: convo.id,
    senderId,
    type: 'system',
    body,
  });
  await C.updateConversation(convo.id, { lastMessageId: id, lastActivity: Date.now() });
  const message = await M.findMessage(id);
  emitToConversation(convo, 'message:new', null, (uid) => serializeMessage(message, uid));
  return message;
}
