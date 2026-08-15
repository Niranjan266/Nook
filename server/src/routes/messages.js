import { Router } from 'express';
import { z } from 'zod';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeMessage } from '../lib/serialize.js';
import { emitToConversation, emitToUser } from '../sockets/hub.js';
import { createMessage, markRead } from '../services/messages.js';
import { destroy } from '../services/media.js';
import { hasUnlock } from '../lib/lockgrants.js';

const router = Router();
router.use(requireAuth);

const mustBeMember = async (conversationId, userId) => {
  const convo = await C.findConversationForUser(conversationId, userId);
  if (!convo) throw httpError(404, 'That conversation is not yours.');
  return convo;
};

/**
 * A locked chat must refuse to hand over its history until the code has been
 * entered. Hiding it only in the UI would make the lock decoration — the
 * messages would still be one request away, which is not a lock, it is a
 * curtain.
 */
const mustBeUnlocked = async (conversationId, userId) => {
  const convo = await mustBeMember(conversationId, userId);
  const mine = convo.members.find((m) => String(m.user?.id || m.user) === String(userId));
  if (mine?.locked && mine?.lockHash && !hasUnlock(userId, String(convo.id)))
    throw httpError(403, 'This chat is locked.', { code: 'CHAT_LOCKED' });
  return convo;
};

/**
 * Eight routes resolve a message through here — react, forward, edit, delete,
 * history, view, star, screenshot-hint — and every one of them inherited
 * membership-only access from this single line. Reacting to a message in a
 * locked chat returned its body; forwarding it copied the contents somewhere
 * readable. Requiring the unlock here fixes all eight at once, which is the
 * only way a rule like this stays true as routes are added.
 */
const loadMessage = async (id, userId) => {
  const msg = await M.findMessage(id);
  if (!msg) throw httpError(404, 'That message is gone.');
  await mustBeUnlocked(msg.conversation, userId);
  return msg;
};

/**
 * Drop messages belonging to a locked chat the viewer has not opened.
 *
 * Search, starred and scheduled all query by *membership*, which is the right
 * scope for everything except this. Rather than teach three SQL builders about
 * locks, the results are filtered once here — the lists are small, and a rule
 * applied in one place cannot be half-applied.
 */
async function dropLocked(messages, userId) {
  const byConvo = new Map();
  const keep = [];
  for (const m of messages) {
    const cid = String(m.conversation?._id || m.conversation);
    if (!byConvo.has(cid)) {
      const convo = await C.findConversationForUser(cid, userId);
      const mine = convo?.members?.find((x) => String(x.user?.id || x.user) === String(userId));
      byConvo.set(cid, Boolean(mine?.locked && mine?.lockHash) && !hasUnlock(userId, cid));
    }
    if (!byConvo.get(cid)) keep.push(m);
  }
  return keep;
}

async function broadcast(message, event) {
  const convo = await C.findConversation(message.conversation);
  emitToConversation(convo, event, null, (uid) => serializeMessage(message, uid));
}

/* ── history ──────────────────────────────────────────────────────────────── */

router.get(
  '/:conversationId',
  asyncRoute(async (req, res) => {
    await mustBeUnlocked(req.params.conversationId, req.user.id);
    const limit = Math.min(Number(req.query.limit) || 40, 100);

    const messages = await M.listMessages({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      before: req.query.before,
      limit,
    });

    res.json({
      messages: messages.reverse().map((m) => serializeMessage(m, req.user.id)),
      hasMore: messages.length === limit,
    });
  })
);

/* ── send (REST fallback — sockets are the primary path) ──────────────────── */

router.post(
  '/:conversationId',
  asyncRoute(async (req, res) => {
    const payload = z
      .object({
        type: z.enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'snap']).default('text'),
        body: z.string().max(8000).optional(),
        media: z.any().optional(),
        replyTo: z.string().nullable().optional(),
        forwardedFrom: z.string().nullable().optional(),
        mentions: z.array(z.string()).optional(),
        clientId: z.string().optional(),
        viewOnce: z.boolean().optional(),
        // How long the recipient may look at a snap. 0 means they close it
        // themselves; capped at a minute so "view once" keeps meaning something.
        viewSeconds: z.number().int().min(0).max(60).optional(),
        threadRoot: z.string().nullable().optional(),
        scheduledFor: z.string().nullable().optional(),
        transcript: z.string().max(8000).optional(),
      })
      .parse(req.body);

    const { message } = await createMessage({
      conversationId: req.params.conversationId,
      senderId: req.user.id,
      payload,
    });
    res.status(201).json({ message: serializeMessage(message, req.user.id) });
  })
);

/* ── side-threads ─────────────────────────────────────────────────────────
   One level deep, deliberately. Nesting turns a conversation into a forum. */

router.get(
  '/thread/:rootId',
  asyncRoute(async (req, res) => {
    const root = await M.findMessage(req.params.rootId);
    if (!root) throw httpError(404, 'That thread is gone.');
    await mustBeMember(root.conversation, req.user.id);

    const replies = await M.listThread({ rootId: root.id, userId: req.user.id });
    res.json({
      root: serializeMessage(root, req.user.id),
      replies: replies.map((m) => serializeMessage(m, req.user.id)),
    });
  })
);

/* ── edit history ─────────────────────────────────────────────────────────
   Trust through transparency: anyone in the conversation can see what a
   message said before it was edited.                                      */

router.get(
  '/:id/history',
  asyncRoute(async (req, res) => {
    const msg = await loadMessage(req.params.id, req.user.id);
    const previous = await M.editHistory(msg.id);
    res.json({
      history: [
        ...previous.map((e) => ({ body: e.body, at: new Date(e.at).toISOString() })),
        {
          body: msg.body,
          at: (msg.editedAt || msg.createdAt).toISOString(),
          current: true,
        },
      ],
    });
  })
);

/* ── scheduled messages ─────────────────────────────────────────────────── */

router.get(
  '/scheduled/all',
  asyncRoute(async (req, res) => {
    const pending = await dropLocked(await M.listScheduled(req.user.id), req.user.id);
    res.json({ messages: pending.map((m) => serializeMessage(m, req.user.id)) });
  })
);

router.delete(
  '/scheduled/:id',
  asyncRoute(async (req, res) => {
    const result = await M.cancelScheduled(req.params.id, req.user.id);
    if (!(result.rowsAffected ?? 0)) throw httpError(404, 'Nothing scheduled with that id.');
    res.json({ ok: true });
  })
);

/* ── read ─────────────────────────────────────────────────────────────────── */

router.post(
  '/:conversationId/read',
  asyncRoute(async (req, res) => {
    await markRead({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      upTo: req.body?.upTo,
    });
    res.json({ ok: true });
  })
);

/* ── search ───────────────────────────────────────────────────────────────
   FTS5: ranked, prefix-matched, index-backed. The old version was a regex
   scan over every message body.                                           */

router.get(
  '/search/all',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });

    const found = await M.searchMessages({
      userId: req.user.id,
      query: q,
      conversationId: req.query.conversationId || null,
    });
    // Search was the easiest way past the lock: point it at the locked
    // conversation with `?conversationId=` and page the contents out by
    // guessing common words.
    const results = await dropLocked(found, req.user.id);
    res.json({ results: results.map((m) => serializeMessage(m, req.user.id)) });
  })
);

router.get(
  '/starred/all',
  asyncRoute(async (req, res) => {
    const starred = await dropLocked(await M.listStarred(req.user.id), req.user.id);
    res.json({ messages: starred.map((m) => serializeMessage(m, req.user.id)) });
  })
);

router.get(
  '/media/:conversationId',
  asyncRoute(async (req, res) => {
    await mustBeUnlocked(req.params.conversationId, req.user.id);
    const messages = await M.listMediaFor(req.params.conversationId);
    res.json({ messages: messages.map((m) => serializeMessage(m, req.user.id)) });
  })
);

/* ── edit ─────────────────────────────────────────────────────────────────── */

router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(8000) }).parse(req.body);
    const msg = await loadMessage(req.params.id, req.user.id);

    if (String(msg.sender.id) !== req.user.id) throw httpError(403, 'You can only edit your own messages.');
    if (msg.type !== 'text') throw httpError(400, 'Only text messages can be edited.');
    if (Date.now() - new Date(msg.createdAt).getTime() > 15 * 60 * 1000)
      throw httpError(400, 'Too late to edit — 15 minute window.');

    await M.editMessage(msg.id, body, msg.body, msg.editedAt || msg.createdAt);
    const fresh = await M.findMessage(msg.id);
    await broadcast(fresh, 'message:edit');
    res.json({ message: serializeMessage(fresh, req.user.id) });
  })
);

/* ── delete ───────────────────────────────────────────────────────────────── */

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
    const msg = await loadMessage(req.params.id, req.user.id);

    if (scope === 'everyone') {
      if (String(msg.sender.id) !== req.user.id)
        throw httpError(403, 'You can only unsend your own messages.');
      if (msg.media?.publicId) await destroy(msg.media.publicId, msg.media.mime);
      await M.deleteForEveryone(msg.id);
      const fresh = await M.findMessage(msg.id);
      await broadcast(fresh, 'message:delete');
    } else {
      await M.deleteForMe(msg.id, req.user.id);
      const fresh = await M.findMessage(msg.id);
      emitToUser(req.user.id, 'message:delete', {
        ...serializeMessage(fresh, req.user.id),
        deletedForMe: true,
      });
    }
    res.json({ ok: true });
  })
);

/* ── reactions ────────────────────────────────────────────────────────────── */

router.post(
  '/:id/react',
  asyncRoute(async (req, res) => {
    const { emoji } = z.object({ emoji: z.string().min(1).max(8) }).parse(req.body);
    const msg = await loadMessage(req.params.id, req.user.id);

    await M.toggleReaction(msg.id, req.user.id, emoji);
    const fresh = await M.findMessage(msg.id);
    await broadcast(fresh, 'message:react');
    res.json({ message: serializeMessage(fresh, req.user.id) });
  })
);

/* ── star ─────────────────────────────────────────────────────────────────── */

router.post(
  '/:id/star',
  asyncRoute(async (req, res) => {
    const msg = await loadMessage(req.params.id, req.user.id);
    const starred = await M.toggleStar(msg.id, req.user.id);
    res.json({ starred });
  })
);

/* ── forward ──────────────────────────────────────────────────────────────── */

router.post(
  '/:id/forward',
  asyncRoute(async (req, res) => {
    const { conversationIds } = z.object({ conversationIds: z.array(z.string()).min(1) }).parse(req.body);
    const source = await loadMessage(req.params.id, req.user.id);

    const created = [];
    for (const conversationId of conversationIds) {
      const { message } = await createMessage({
        conversationId,
        senderId: req.user.id,
        payload: {
          // A forwarded snap becomes an ordinary photo — forwarding something
          // designed to be seen once and vanish would defeat the point.
          type: source.type === 'snap' ? 'image' : source.type,
          body: source.body,
          media: source.media,
          forwardedFrom: source.sender.id,
        },
      });
      created.push(serializeMessage(message, req.user.id));
    }
    res.json({ messages: created });
  })
);

/* ── view-once (Snap) ─────────────────────────────────────────────────────── */

router.post(
  '/:id/view',
  asyncRoute(async (req, res) => {
    const msg = await loadMessage(req.params.id, req.user.id);
    if (!msg.viewOnce?.enabled) throw httpError(400, 'Not a snap.');
    if (String(msg.sender.id) === req.user.id) return res.json({ ok: true });

    if (!msg.viewOnce.viewedBy.some((u) => String(u) === req.user.id)) {
      await M.recordView(msg.id, req.user.id);

      const others = await C.memberIdsOf(msg.conversation, msg.sender.id);
      const fresh = await M.findMessage(msg.id);
      const allSeen = others.every((id) => fresh.viewOnce.viewedBy.some((u) => String(u) === id));

      if (allSeen) {
        if (msg.media?.publicId) await destroy(msg.media.publicId, msg.media.mime);
        await M.burnMessage(msg.id);
      }
      await broadcast(await M.findMessage(msg.id), 'message:snap-viewed');
    }
    res.json({ ok: true });
  })
);

// Courtesy signal — browsers cannot actually block screenshots.
router.post(
  '/:id/screenshot-hint',
  asyncRoute(async (req, res) => {
    const msg = await loadMessage(req.params.id, req.user.id);
    emitToUser(msg.sender.id, 'snap:peeked', {
      messageId: String(msg.id),
      by: req.user.id,
      byName: req.user.displayName,
    });
    res.json({ ok: true });
  })
);

export default router;
