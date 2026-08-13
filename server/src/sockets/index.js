import { verifyAccess } from '../services/tokens.js';
import * as U from '../db/users.js';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as Calls from '../db/misc.js';
import { serializeMessage } from '../lib/serialize.js';
import { warmNicknames } from '../lib/nicknames.js';
import { createMessage, markRead } from '../services/messages.js';
import { notify } from '../services/push.js';
import { parseJson } from '../db/index.js';
import {
  bindIo,
  trackConnect,
  trackDisconnect,
  emitToUser,
  emitToConversation,
  isOnline,
} from './hub.js';

/** conversationId -> Map<userId, timeoutId> */
const typing = new Map();

export function attachSockets(io) {
  bindIo(io);

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token.'));
    try {
      const { sub } = verifyAccess(token);
      const user = await U.findUserById(sub);
      if (!user) return next(new Error('Unknown user.'));
      socket.userId = String(user.id);
      socket.user = user;

      // Socket emits serialise for recipients other than the requester, so
      // each connected viewer's nicknames must be warm for the whole session.
      await warmNicknames(user.id);

      next();
    } catch {
      next(new Error('Bad token.'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.userId;
    socket.join(`user:${uid}`);
    const count = trackConnect(uid, socket.id);

    if (count === 1) {
      await U.setPresence(uid, true);
      broadcastPresence(uid, { online: true, lastSeen: new Date() });
      await flushDeliveries(uid);
    }

    socket.emit('ready', { userId: uid });

    /* ── presence lookup ────────────────────────────────────────────────── */

    socket.on('presence:who', async (userIds = [], ack) => {
      const rows = await U.presenceFor(userIds);
      const map = {};
      for (const row of rows) {
        const privacy = parseJson(row.privacy);
        map[row.id] =
          privacy?.lastSeen === 'nobody'
            ? { online: false, lastSeen: null }
            : {
                online: Boolean(row.online) || isOnline(row.id),
                lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
              };
      }
      ack?.(map);
    });

    /* ── messaging ──────────────────────────────────────────────────────── */

    socket.on('message:send', async (payload, ack) => {
      try {
        const { message } = await createMessage({
          conversationId: payload.conversationId,
          senderId: uid,
          payload,
        });
        clearTyping(payload.conversationId, uid);
        ack?.({ ok: true, message: serializeMessage(message, uid) });
      } catch (err) {
        ack?.({ ok: false, error: err.message || 'Could not send.', clientId: payload?.clientId });
      }
    });

    socket.on('message:read', async ({ conversationId, upTo }) => {
      try {
        await markRead({ conversationId, userId: uid, upTo });
      } catch {
        /* ignore */
      }
    });

    /* ── typing ─────────────────────────────────────────────────────────── */

    socket.on('typing:start', async ({ conversationId }) => {
      const convo = await C.findConversationForUser(conversationId, uid);
      if (!convo) return;
      if (!typing.has(conversationId)) typing.set(conversationId, new Map());
      const room = typing.get(conversationId);
      clearTimeout(room.get(uid));
      room.set(uid, setTimeout(() => clearTyping(conversationId, uid), 6000));
      emitToConversation(convo, 'typing:update', { conversationId, userId: uid, typing: true }, null, uid);
    });

    socket.on('typing:stop', ({ conversationId }) => clearTyping(conversationId, uid));

    /* ── WebRTC signalling ──────────────────────────────────────────────── */

    socket.on('call:offer', async ({ conversationId, calleeId, kind, sdp }, ack) => {
      const convo = await C.findConversationForUser(conversationId, uid);
      if (!convo) return ack?.({ ok: false, error: 'Not your conversation.' });
      if (convo.type !== 'direct') return ack?.({ ok: false, error: 'Group calls are not available yet.' });

      const target = calleeId || (await C.memberIdsOf(convo.id, uid))[0];
      const call = await Calls.createCall({
        conversationId: convo.id,
        callerId: uid,
        calleeId: target,
        kind,
      });

      if (!isOnline(target)) {
        notify(target, {
          title: socket.user.displayName,
          body: kind === 'video' ? 'Video call' : 'Voice call',
          tag: `call-${call.id}`,
          conversationId: String(convo.id),
          urgent: true,
        }).catch(() => {});
      }

      emitToUser(target, 'call:incoming', {
        callId: String(call.id),
        conversationId: String(convo.id),
        kind: call.kind,
        sdp,
        from: {
          id: uid,
          displayName: socket.user.displayName,
          username: socket.user.username,
          avatarUrl: socket.user.avatarUrl,
          accent: socket.user.accent,
        },
      });

      // Unanswered after 40s → missed.
      setTimeout(async () => {
        const fresh = await Calls.findCall(call.id);
        if (fresh?.status === 'ringing') {
          const ended = await Calls.updateCall(call.id, { status: 'missed', endedAt: Date.now() });
          emitToUser(uid, 'call:ended', { callId: String(call.id), reason: 'missed' });
          emitToUser(target, 'call:cancelled', { callId: String(call.id) });
          await logCall(ended);
        }
      }, 40000);

      ack?.({ ok: true, callId: String(call.id) });
    });

    socket.on('call:answer', async ({ callId, sdp }) => {
      const call = await Calls.findCall(callId);
      if (!call || String(call.callee) !== uid) return;
      await Calls.updateCall(callId, { status: 'accepted', answeredAt: Date.now() });
      emitToUser(call.caller, 'call:answered', { callId, sdp });
    });

    socket.on('call:ice', ({ callId, candidate, to }) => {
      if (to) emitToUser(to, 'call:ice', { callId, candidate });
    });

    socket.on('call:decline', async ({ callId }) => {
      const call = await Calls.findCall(callId);
      if (!call) return;
      const ended = await Calls.updateCall(callId, { status: 'declined', endedAt: Date.now() });
      emitToUser(call.caller, 'call:ended', { callId, reason: 'declined' });
      await logCall(ended);
    });

    socket.on('call:end', async ({ callId }) => {
      const call = await Calls.findCall(callId);
      if (!call || call.endedAt) return;

      const wasAccepted = call.status === 'accepted';
      const ended = await Calls.updateCall(callId, {
        status: wasAccepted ? 'ended' : 'cancelled',
        endedAt: Date.now(),
        duration: wasAccepted && call.answeredAt
          ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000)
          : 0,
      });

      const other = String(call.caller) === uid ? call.callee : call.caller;
      emitToUser(other, 'call:ended', { callId, reason: wasAccepted ? 'ended' : 'cancelled' });
      await logCall(ended);
    });

    /* ── disconnect ─────────────────────────────────────────────────────── */

    socket.on('disconnect', async () => {
      if (trackDisconnect(uid, socket.id) === 0) {
        const lastSeen = Date.now();
        await U.setPresence(uid, false, lastSeen);
        broadcastPresence(uid, { online: false, lastSeen: new Date(lastSeen) });
      }
    });
  });

  async function clearTyping(conversationId, userId) {
    const room = typing.get(conversationId);
    if (room?.has(userId)) {
      clearTimeout(room.get(userId));
      room.delete(userId);
    }
    const convo = await C.findConversation(conversationId);
    if (convo)
      emitToConversation(convo, 'typing:update', { conversationId, userId, typing: false }, null, userId);
  }

  async function broadcastPresence(userId, state) {
    const user = await U.findUserById(userId);
    if (user?.privacy?.lastSeen === 'nobody') return;

    const convos = await C.listConversationsFor(userId, 200);
    const seen = new Set();
    for (const convo of convos) {
      for (const member of convo.members) {
        const id = String(member.user?.id || member.user);
        if (id === String(userId) || seen.has(id)) continue;
        seen.add(id);
        emitToUser(id, 'presence:update', {
          userId: String(userId),
          online: state.online,
          lastSeen: state.lastSeen?.toISOString?.() || state.lastSeen,
        });
      }
    }
  }

  /** When someone comes online, mark everything waiting for them as delivered. */
  async function flushDeliveries(userId) {
    const pending = await M.pendingDeliveriesFor(userId);
    if (!pending.length) return;

    await Promise.all(pending.map((m) => M.markDelivered(m.id, [userId])));

    const bySender = new Map();
    for (const m of pending) {
      if (!bySender.has(m.sender_id)) bySender.set(m.sender_id, []);
      bySender.get(m.sender_id).push({ id: String(m.id), conversationId: String(m.conversation_id) });
    }
    for (const [sender, items] of bySender) {
      emitToUser(sender, 'receipt:delivered', {
        messageIds: items.map((i) => i.id),
        conversationId: items[0].conversationId,
        userIds: [String(userId)],
      });
    }
  }

  async function logCall(call) {
    if (!call) return;
    const id = await M.createMessageRow({
      conversationId: call.conversation,
      senderId: call.caller,
      type: 'call',
      call: {
        kind: call.kind,
        status: call.status === 'accepted' ? 'ended' : call.status,
        duration: call.duration,
      },
    });

    await C.updateConversation(call.conversation, { lastMessageId: id, lastActivity: Date.now() });
    const convo = await C.findConversation(call.conversation);
    const message = await M.findMessage(id);
    if (convo) emitToConversation(convo, 'message:new', null, (viewer) => serializeMessage(message, viewer));
  }
}
