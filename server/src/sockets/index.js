import { verifyAccess } from '../services/tokens.js';
import * as U from '../db/users.js';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as Calls from '../db/misc.js';
import { serializeMessage } from '../lib/serialize.js';
import { warmNicknames } from '../lib/nicknames.js';
import { warmFriends } from '../lib/friendcache.js';
import { areFriends } from '../db/friends.js';
import { createMessage, markRead } from '../services/messages.js';
import { notify } from '../services/push.js';
import { TEMPLATES } from '../services/templates.js';
import { parseJson } from '../db/index.js';
import { parseSendPayload } from '../lib/sendPayload.js';
import {
  bindIo,
  trackConnect,
  trackDisconnect,
  emitToUser,
  emitToConversation,
  isOnline,
  setFocus,
  clearFocus,
} from './hub.js';

/** conversationId -> Map<userId, timeoutId> */
const typing = new Map();

/**
 * Every handler goes through this. A socket event is whatever the client felt
 * like sending: `emit('typing:stop')` with no payload threw inside a
 * destructure and took the whole process down, and a rejected promise from an
 * async handler had nowhere to go. Now one bad event costs that event.
 */
const safe = (name, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error(`  socket    ${name} failed: ${err?.message || err}`);
  }
};

/** A payload to destructure, whatever actually arrived. */
const obj = (v) => (v && typeof v === 'object' ? v : {});

/** An ack to call, or nothing — a client can pass anything in that slot. */
const ackOf = (fn) => (typeof fn === 'function' ? fn : () => {});

export function attachSockets(io) {
  bindIo(io);

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token.'));
    try {
      const { sub, iat } = verifyAccess(token);
      const user = await U.findUserById(sub);
      if (!user) return next(new Error('Unknown user.'));

      /**
       * The same two checks `requireAuth` makes. Without them the REST API
       * said 403 to a suspended account while its socket carried on sending
       * and receiving in real time, and "sign this person out everywhere" did
       * not close the connection they already had.
       */
      if (user.suspended) return next(new Error('This account has been suspended.'));
      if (user.tokenEpoch && (iat + 1) * 1000 <= user.tokenEpoch)
        return next(new Error('Signed out. Please sign in again.'));
      socket.userId = String(user.id);
      socket.user = user;

      // Socket emits serialise for recipients other than the requester, so
      // each connected viewer's nicknames must be warm for the whole session.
      await Promise.all([warmNicknames(user.id), warmFriends(user.id)]);

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
      try {
        await U.setPresence(uid, true);
        broadcastPresence(uid, { online: true, lastSeen: new Date() }).catch(() => {});
        await flushDeliveries(uid);
      } catch (err) {
        console.error(`  socket    connect bookkeeping failed: ${err?.message || err}`);
      }
    }

    socket.emit('ready', { userId: uid });

    /* ── what this person is looking at ─────────────────────────────────── */

    /**
     * The client says which conversation is on screen, and repeats it while it
     * stays there. Push uses this instead of "has a socket", which was the
     * reason messages arrived silently on a backgrounded phone.
     */
    socket.on(
      'focus:conversation',
      safe('focus:conversation', (p) => {
        const { conversationId } = obj(p);
        setFocus(uid, typeof conversationId === 'string' ? conversationId : null);
      })
    );

    /* ── presence lookup ────────────────────────────────────────────────── */

    socket.on('presence:who', safe('presence:who', async (userIds, ack) => {
      const reply = ackOf(ack);
      if (!Array.isArray(userIds)) return reply({});
      const ids = [...new Set(userIds.filter((id) => typeof id === 'string'))].slice(0, 500);
      const rows = await U.presenceFor(ids);

      /**
       * The default setting is 'contacts', and this honoured only 'nobody' —
       * so anyone could hand it a list of user ids and read online status and
       * last-seen for almost everybody, bypassing a rule the REST profile
       * route enforces correctly.
       *
       * "Contacts" means the people *they* have saved, so the question is
       * whether the viewer is in each person's list — not whether each person
       * is in the viewer's, which let anyone see you just by saving you.
       */
      const contacts = new Set((await U.contactOfIds(uid)).map(String));

      const map = {};
      for (const row of rows) {
        const privacy = parseJson(row.privacy);
        const rule = privacy?.lastSeen || 'contacts';
        const visible =
          String(row.id) === uid || rule === 'everyone' || (rule === 'contacts' && contacts.has(String(row.id)));

        map[row.id] = visible
          ? {
              online: Boolean(row.online) || isOnline(row.id),
              lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
            }
          : { online: false, lastSeen: null };
      }
      reply(map);
    }));

    /* ── messaging ──────────────────────────────────────────────────────── */

    socket.on('message:send', safe('message:send', async (raw, ack) => {
      const reply = ackOf(ack);
      const { conversationId, clientId } = obj(raw);
      try {
        if (typeof conversationId !== 'string') throw new Error('Which conversation?');
        // Validated exactly as the REST route validates — see lib/sendPayload.js.
        const payload = await parseSendPayload(raw, uid);
        const { message } = await createMessage({ conversationId, senderId: uid, payload });
        clearTyping(conversationId, uid).catch(() => {});
        reply({ ok: true, message: serializeMessage(message, uid) });
      } catch (err) {
        const error = err?.issues?.[0]?.message || err?.message || 'Could not send.';
        reply({ ok: false, error, clientId: typeof clientId === 'string' ? clientId : undefined });
      }
    }));

    socket.on('message:read', safe('message:read', async (p) => {
      const { conversationId, upTo } = obj(p);
      if (typeof conversationId !== 'string') return;
      await markRead({ conversationId, userId: uid, upTo });
    }));

    /* ── typing ─────────────────────────────────────────────────────────── */

    socket.on('typing:start', safe('typing:start', async (p) => {
      const { conversationId } = obj(p);
      if (typeof conversationId !== 'string') return;
      const convo = await C.findConversationForUser(conversationId, uid);
      if (!convo) return;
      if (!typing.has(conversationId)) typing.set(conversationId, new Map());
      const room = typing.get(conversationId);
      clearTimeout(room.get(uid));
      room.set(uid, setTimeout(() => clearTyping(conversationId, uid).catch(() => {}), 6000));
      emitToConversation(convo, 'typing:update', { conversationId, userId: uid, typing: true }, null, uid);
    }));

    socket.on('typing:stop', safe('typing:stop', async (p) => {
      const { conversationId } = obj(p);
      if (typeof conversationId === 'string') await clearTyping(conversationId, uid);
    }));

    /* ── WebRTC signalling ──────────────────────────────────────────────── */

    socket.on('call:offer', safe('call:offer', async (p, rawAck) => {
      const { conversationId, calleeId, kind, sdp } = obj(p);
      const ack = ackOf(rawAck);
      if (typeof conversationId !== 'string') return ack({ ok: false, error: 'Which conversation?' });
      const convo = await C.findConversationForUser(conversationId, uid);
      if (!convo) return ack({ ok: false, error: 'Not your conversation.' });
      if (convo.type !== 'direct') return ack({ ok: false, error: 'Group calls are not available yet.' });

      /**
       * Ringing someone's phone is louder than messaging them, and this path
       * checked neither friendship nor blocking — so a stranger could make a
       * device ring on repeat, and a blocked person could still call through
       * an old conversation. It also trusted a caller-supplied `calleeId`,
       * which need not have been in the conversation at all.
       */
      const members = await C.memberIdsOf(convo.id, uid);
      const target = calleeId ? String(calleeId) : members[0];
      if (!target || !members.includes(target))
        return ack({ ok: false, error: 'That person is not in this conversation.' });
      if (await U.blockExistsBetween(uid, target))
        return ack({ ok: false, error: 'You cannot call this person.' });
      if (!(await areFriends(uid, target)))
        return ack({ ok: false, error: 'They need to accept your request first.' });
      const call = await Calls.createCall({
        conversationId: convo.id,
        callerId: uid,
        calleeId: target,
        kind,
      });

      if (!isOnline(target)) {
        notify(
          target,
          TEMPLATES.call.push({
            sender: socket.user.displayName,
            video: kind === 'video',
            callId: call.id,
            conversationId: convo.id,
          })
        ).catch(() => {});
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

      // Unanswered after 40s → missed. A timer has no caller to catch for it.
      setTimeout(
        safe('call:missed', async () => {
          const fresh = await Calls.findCall(call.id);
          if (fresh?.status === 'ringing') {
            const ended = await Calls.updateCall(call.id, { status: 'missed', endedAt: Date.now() });
            emitToUser(uid, 'call:ended', { callId: String(call.id), reason: 'missed' });
            emitToUser(target, 'call:cancelled', { callId: String(call.id) });
            await logCall(ended);
          }
        }),
        40000
      );

      ack({ ok: true, callId: String(call.id) });
    }));

    socket.on('call:answer', safe('call:answer', async (p) => {
      const { callId, sdp } = obj(p);
      const call = await Calls.findCall(callId);
      if (!call || String(call.callee) !== uid) return;
      // Only a ringing call can be picked up. Answering one already missed or
      // declined wrote a second outcome over the first, and a second call log.
      if (call.endedAt || call.status !== 'ringing') return;
      await Calls.updateCall(callId, { status: 'accepted', answeredAt: Date.now() });
      emitToUser(call.caller, 'call:answered', { callId, sdp });
    }));

    /**
     * ICE candidates go to the other end of a call you are actually on.
     *
     * This used to forward whatever `to` said, to anyone, with no checks —
     * an arbitrary "send this socket event to any user on the platform"
     * primitive. The call row already knows both parties, so `to` is not
     * needed and is no longer trusted.
     */
    socket.on('call:ice', safe('call:ice', async (p) => {
      const { callId, candidate } = obj(p);
      const call = await Calls.findCall(callId);
      if (!call) return;
      const caller = String(call.caller);
      const callee = String(call.callee);
      if (uid !== caller && uid !== callee) return;
      emitToUser(uid === caller ? callee : caller, 'call:ice', { callId, candidate });
    }));

    socket.on('call:decline', safe('call:decline', async (p) => {
      const { callId } = obj(p);
      const call = await Calls.findCall(callId);
      if (!call) return;
      // Only the person being rung may decline. Anyone who learned a call id
      // could otherwise hang up other people's calls.
      if (String(call.callee) !== uid) return;
      if (call.endedAt || call.status !== 'ringing') return;
      const ended = await Calls.updateCall(callId, { status: 'declined', endedAt: Date.now() });
      emitToUser(call.caller, 'call:ended', { callId, reason: 'declined' });
      await logCall(ended);
    }));

    socket.on('call:end', safe('call:end', async (p) => {
      const { callId } = obj(p);
      const call = await Calls.findCall(callId);
      if (!call || call.endedAt) return;
      if (String(call.caller) !== uid && String(call.callee) !== uid) return;

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
    }));

    /* ── disconnect ─────────────────────────────────────────────────────── */

    socket.on('disconnect', safe('disconnect', async () => {
      // Their last window is gone, so nothing is on screen. Clearing this
      // matters: a stale claim would silence that chat's notifications until
      // the TTL expired.
      clearFocus(uid);

      if (trackDisconnect(uid, socket.id) === 0) {
        const lastSeen = Date.now();
        await U.setPresence(uid, false, lastSeen);
        await broadcastPresence(uid, { online: false, lastSeen: new Date(lastSeen) });
      }
    }));
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

    // One receipt per sender *and* conversation. Grouping by sender alone
    // tagged every id with the first message's conversation, so ticks for a
    // second chat with the same person landed in the wrong one.
    const groups = new Map();
    for (const m of pending) {
      const key = `${m.sender_id}:${m.conversation_id}`;
      if (!groups.has(key))
        groups.set(key, { sender: m.sender_id, conversationId: String(m.conversation_id), ids: [] });
      groups.get(key).ids.push(String(m.id));
    }
    for (const { sender, conversationId, ids } of groups.values()) {
      emitToUser(sender, 'receipt:delivered', {
        messageIds: ids,
        conversationId,
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
