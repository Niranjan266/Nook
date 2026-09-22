import { Router } from 'express';
import { z } from 'zod';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as R from '../db/reminders.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { MAX_ACTIVE, MAX_AHEAD_MS, whyGone, isLockedFor, serializeReminder } from '../services/reminders.js';

const router = Router();
router.use(requireAuth);

/**
 * The time arrives as an ISO instant, worked out on the client. "Tomorrow at
 * 9" only means something in the person's own timezone, and the device is the
 * one place that reliably knows it — the server only ever stores the instant.
 */
const createSchema = z.object({
  messageId: z.string().min(1).max(64),
  remindAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(200).optional().default(''),
});

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { upcoming, recent } = await R.listFor(req.user.id);
    const [up, past] = await Promise.all([
      Promise.all(upcoming.map((r) => serializeReminder(r, req.user.id))),
      Promise.all(recent.map((r) => serializeReminder(r, req.user.id))),
    ]);
    res.json({ upcoming: up, recent: past });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const { messageId, remindAt, note } = createSchema.parse(req.body);

    const at = new Date(remindAt).getTime();
    if (!(at > Date.now())) throw httpError(400, 'Pick a time that has not happened yet.');
    if (at - Date.now() > MAX_AHEAD_MS) throw httpError(400, 'Reminders can be up to a year ahead.');

    /**
     * The same doors as reading the message: a member of the chat, the chat
     * unlocked, the message still there for you. One 404 for all of them, so
     * probing ids cannot tell "not yours" apart from "does not exist".
     */
    const msg = await M.findMessage(messageId);
    const convo = msg ? await C.findConversationForUser(msg.conversation, req.user.id) : null;
    if (!msg || !convo || whyGone(msg, req.user.id)) throw httpError(404, 'That message is gone.');
    if (isLockedFor(convo, req.user.id)) throw httpError(403, 'This chat is locked.', { code: 'CHAT_LOCKED' });

    // Moving an existing reminder is not a new one, so it never hits the cap.
    const existing = await R.activeFor(req.user.id, msg.id);
    if (!existing && (await R.countActive(req.user.id)) >= MAX_ACTIVE)
      throw httpError(429, `You have ${MAX_ACTIVE} reminders waiting — clear some first.`);

    const reminder = await R.upsertReminder({
      userId: req.user.id,
      messageId: msg.id,
      conversationId: convo.id,
      remindAt: at,
      note,
    });
    res.status(existing ? 200 : 201).json({ reminder: await serializeReminder(reminder, req.user.id) });
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const result = await R.deleteReminder(req.params.id, req.user.id);
    if (!(result.rowsAffected ?? 0)) throw httpError(404, 'No reminder with that id.');
    res.json({ ok: true });
  })
);

export default router;
