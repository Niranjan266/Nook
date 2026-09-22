/**
 * Voting on polls and ticking shared lists.
 *
 * Its own router, mounted beside the messages one, because none of this is
 * about sending: it is members changing a message that already exists. Every
 * route answers with the re-serialised message and broadcasts the same thing,
 * so the client has one shape to merge whether the change was its own or
 * somebody else's.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as P from '../db/polls.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeMessage } from '../lib/serialize.js';
import { hasUnlock } from '../lib/lockgrants.js';
import { emitToConversation } from '../sockets/hub.js';

const router = Router();
router.use(requireAuth);

/**
 * The message, if this person may act on it, and the conversation it is in.
 *
 * Same rule as the messages router's `loadMessage`: a member, and past the
 * lock if they set one. A vote returns the whole poll, so voting in a locked
 * chat would otherwise be a way to read it. A scheduled poll does not exist
 * yet for anyone but its author, and an unsent one does not exist at all.
 */
async function loadTarget(id, userId, type) {
  const msg = await M.findMessage(id);
  if (!msg) throw httpError(404, 'That message is gone.');

  const convo = await C.findConversationForUser(msg.conversation, userId);
  if (!convo) throw httpError(404, 'That conversation is not yours.');
  const mine = convo.members.find((m) => String(m.user?.id || m.user) === String(userId));
  if (mine?.locked && mine?.lockHash && !hasUnlock(userId, String(convo.id)))
    throw httpError(403, 'This chat is locked.', { code: 'CHAT_LOCKED' });

  if (!msg.delivered) throw httpError(404, 'That message is gone.');
  if (msg.deletedForAll) throw httpError(410, 'That message was unsent.');
  if (msg.type !== type) throw httpError(400, type === 'poll' ? 'That is not a poll.' : 'That is not a list.');
  return { msg, convo };
}

/**
 * Tell everyone, then answer. Reuses `message:edit`, which every client
 * already merges wholesale and which the hub already withholds from members
 * who have the chat locked — a new event name would have to earn both again.
 */
async function publish(res, msgId, convo, userId) {
  const fresh = await M.findMessage(msgId);
  emitToConversation(convo, 'message:edit', null, (uid) => serializeMessage(fresh, uid));
  res.json({ message: serializeMessage(fresh, userId) });
}

const isAdmin = (convo, userId) =>
  convo.members.some((m) => String(m.user?.id || m.user) === String(userId) && m.role === 'admin');

/* ── polls ────────────────────────────────────────────────────────────────── */

/**
 * Set this person's votes. An empty list is an unvote; a single-choice poll
 * takes at most one. See `setVotes` for why this is a set, not a toggle.
 */
router.post(
  '/:id/poll/vote',
  asyncRoute(async (req, res) => {
    const { optionIds } = z
      .object({ optionIds: z.array(z.string().min(1).max(64)).max(P.POLL_MAX_OPTIONS) })
      .parse(req.body ?? {});
    const { msg, convo } = await loadTarget(req.params.id, req.user.id, 'poll');
    const poll = msg.poll;
    if (!poll) throw httpError(404, 'That poll is gone.');
    if (P.pollIsClosed(poll)) throw httpError(409, 'This poll is closed.', { code: 'POLL_CLOSED' });

    const chosen = [...new Set(optionIds)];
    if (!poll.multiple && chosen.length > 1) throw httpError(400, 'This poll takes one answer.');
    const known = new Set(poll.options.map((o) => String(o.id)));
    if (chosen.some((id) => !known.has(id))) throw httpError(400, 'That option is not in this poll.');

    await P.setVotes(msg.id, req.user.id, chosen);
    await publish(res, msg.id, convo, req.user.id);
  })
);

router.post(
  '/:id/poll/close',
  asyncRoute(async (req, res) => {
    const { msg, convo } = await loadTarget(req.params.id, req.user.id, 'poll');
    if (String(msg.sender.id) !== String(req.user.id))
      throw httpError(403, 'Only the person who asked can close this poll.');
    await P.closePoll(msg.id, req.user.id);
    await publish(res, msg.id, convo, req.user.id);
  })
);

/* ── lists ────────────────────────────────────────────────────────────────── */

const itemText = z.string().trim().min(1, 'Write something first.').max(200, 'Keep it under 200 characters.');

router.post(
  '/:id/list/items',
  asyncRoute(async (req, res) => {
    const { text } = z.object({ text: itemText }).parse(req.body ?? {});
    const { msg, convo } = await loadTarget(req.params.id, req.user.id, 'list');
    const added = await P.addListItem(msg.id, req.user.id, text);
    if (!added) throw httpError(409, `This list is full — ${P.LIST_MAX_ITEMS} items at most.`);
    res.status(201);
    await publish(res, msg.id, convo, req.user.id);
  })
);

/** Tick or untick. Anyone in the chat may — that is what makes it shared. */
router.patch(
  '/:id/list/items/:itemId',
  asyncRoute(async (req, res) => {
    const { checked } = z.object({ checked: z.boolean() }).parse(req.body ?? {});
    const { msg, convo } = await loadTarget(req.params.id, req.user.id, 'list');
    const item = await P.findListItem(msg.id, req.params.itemId);
    if (!item) throw httpError(404, 'That item is gone.');
    await P.setListItemChecked(msg.id, item.id, req.user.id, checked);
    await publish(res, msg.id, convo, req.user.id);
  })
);

/**
 * Remove an item: your own, or any if the list is yours or you run the group.
 * Ticking is shared; deleting somebody else's line is not, or one person
 * could quietly edit what everyone agreed to bring.
 */
router.delete(
  '/:id/list/items/:itemId',
  asyncRoute(async (req, res) => {
    const { msg, convo } = await loadTarget(req.params.id, req.user.id, 'list');
    const item = await P.findListItem(msg.id, req.params.itemId);
    if (!item) throw httpError(404, 'That item is gone.');

    const me = String(req.user.id);
    const allowed = String(item.added_by) === me || String(msg.sender.id) === me || isAdmin(convo, me);
    if (!allowed) throw httpError(403, 'You can only remove items you added.');

    await P.removeListItem(msg.id, item.id);
    await publish(res, msg.id, convo, req.user.id);
  })
);

export default router;
