/**
 * Rooms — the features that treat a conversation as a place rather than a list.
 *
 * Mood, a wall you can pin things to, a wallpaper that knows the time of day,
 * and the history of every wallpaper the room has worn.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as C from '../db/conversations.js';
import * as U from '../db/users.js';
import { areFriends } from '../db/friends.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeConversation } from '../lib/serialize.js';
import { emitToConversation } from '../sockets/hub.js';

const router = Router();
router.use(requireAuth);

/**
 * Membership is not consent.
 *
 * Anyone could open a direct conversation with anyone, which made every room
 * surface below a delivery channel that never touched the messages table: 12
 * wall notes of 200 characters each, a 120-character mood note, arbitrary
 * image and link URLs — all broadcast to the other person's client. Slow mode
 * was worse than noise, because a stranger could set it to an hour and
 * throttle the victim in their own chat.
 */
const load = async (id, userId) => {
  const convo = await C.findConversationForUser(id, userId);
  if (!convo) throw httpError(404, 'That conversation is not yours.');
  return convo;
};

/** Anything that writes something the other person will see. */
const loadWritable = async (id, userId) => {
  const convo = await load(id, userId);
  if (convo.type === 'direct') {
    for (const otherId of await C.memberIdsOf(convo.id, userId)) {
      if (await U.blockExistsBetween(userId, otherId))
        throw httpError(403, 'You cannot do that here.');
      if (!(await areFriends(userId, otherId)))
        throw httpError(403, 'They need to accept your request first.', { code: 'NOT_FRIENDS' });
    }
  }
  return convo;
};

async function broadcast(id) {
  const fresh = await C.findConversation(id);
  emitToConversation(fresh, 'conversation:update', null, (uid) => serializeConversation(fresh, uid));
  return fresh;
}

/* ── mood ─────────────────────────────────────────────────────────────────
   Not a status broadcast to 400 contacts — a signal inside the one room.  */

const MOODS = ['', 'deep-work', 'away', 'rough-week', 'celebrating', 'travelling', 'resting'];

router.put(
  '/:id/mood',
  asyncRoute(async (req, res) => {
    const { mood, note, hours } = z
      .object({
        mood: z.enum(MOODS),
        note: z.string().trim().max(120).optional(),
        hours: z.number().min(0).max(720).optional(),
      })
      .parse(req.body);

    const convo = await loadWritable(req.params.id, req.user.id);
    await C.updateConversation(convo.id, {
      roomState: {
        mood,
        note: note || '',
        by: req.user.id,
        at: Date.now(),
        until: hours ? Date.now() + hours * 3600_000 : null,
      },
    });

    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── wall objects ─────────────────────────────────────────────────────────
   Pinned to the wall, not the message list, so they never scroll away.    */

router.post(
  '/:id/wall',
  asyncRoute(async (req, res) => {
    const object = z
      .object({
        type: z.enum(['note', 'photo', 'countdown', 'link']),
        text: z.string().trim().max(200).optional(),
        url: z.string().max(2000).optional(),
        date: z.string().optional(),
        x: z.number().min(0).max(100).optional(),
        y: z.number().min(0).max(100).optional(),
      })
      .parse(req.body);

    const convo = await loadWritable(req.params.id, req.user.id);
    if ((await C.countWallObjects(convo.id)) >= 12)
      throw httpError(400, 'A wall holds twelve things. Take one down first.');

    await C.addWallObject(convo.id, { ...object, by: req.user.id });
    const fresh = await broadcast(convo.id);
    res.status(201).json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.patch(
  '/:id/wall/:objectId',
  asyncRoute(async (req, res) => {
    const patch = z
      .object({
        text: z.string().trim().max(200).optional(),
        x: z.number().min(0).max(100).optional(),
        y: z.number().min(0).max(100).optional(),
        date: z.string().optional(),
      })
      .parse(req.body);

    const convo = await loadWritable(req.params.id, req.user.id);
    if (!convo.wallObjects.some((o) => o.id === req.params.objectId))
      throw httpError(404, 'That is not on the wall.');

    await C.updateWallObject(convo.id, req.params.objectId, patch);
    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.delete(
  '/:id/wall/:objectId',
  asyncRoute(async (req, res) => {
    const convo = await loadWritable(req.params.id, req.user.id);
    await C.removeWallObject(convo.id, req.params.objectId);
    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── wallpaper schedule ───────────────────────────────────────────────────
   The room has a time of day: warm and dark in the evening, light at dawn. */

const look = z.object({
  preset: z.string().optional(),
  url: z.string().optional(),
  tint: z.string().optional(),
  dim: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(24).optional(),
});

router.put(
  '/:id/schedule',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        enabled: z.boolean(),
        nightStart: z.number().min(0).max(1439).optional(),
        nightEnd: z.number().min(0).max(1439).optional(),
        day: look.nullable().optional(),
        night: look.nullable().optional(),
      })
      .parse(req.body);

    const convo = await loadWritable(req.params.id, req.user.id);
    const current = convo.wallpaperSchedule;

    await C.updateConversation(convo.id, {
      wallpaperSchedule: {
        enabled: body.enabled,
        nightStart: body.nightStart ?? current.nightStart,
        nightEnd: body.nightEnd ?? current.nightEnd,
        day: body.day !== undefined ? body.day : current.day,
        night: body.night !== undefined ? body.night : current.night,
      },
    });

    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── restore a wallpaper from the room's history ─────────────────────────── */

router.post(
  '/:id/history/:index/restore',
  asyncRoute(async (req, res) => {
    const convo = await loadWritable(req.params.id, req.user.id);
    const entry = await C.wallpaperHistoryEntry(convo.id, Number(req.params.index));
    if (!entry) throw httpError(404, 'No wallpaper at that point in history.');

    await C.pushWallpaperHistory(convo.id, convo.wallpaper, convo.wallpaper.setBy);
    await C.updateConversation(convo.id, {
      wallpaper: {
        url: entry.url || '',
        preset: entry.preset || '',
        tint: entry.tint || '',
        dim: entry.dim ?? 0.35,
        blur: entry.blur ?? 0,
        setBy: req.user.id,
        proposal: { by: null, at: null },
      },
    });

    const fresh = await broadcast(convo.id);
    emitToConversation(fresh, 'wallpaper:changed', null, (uid) => ({
      conversationId: String(fresh.id),
      wallpaper: serializeConversation(fresh, uid).wallpaper,
    }));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── slow mode and retention ──────────────────────────────────────────────
   Slow mode is per person, so one chatty member can't mute the room.      */

router.patch(
  '/:id/pace',
  asyncRoute(async (req, res) => {
    const { slowMode, retentionDays } = z
      .object({
        slowMode: z.number().min(0).max(3600).optional(),
        retentionDays: z.number().min(0).max(3650).optional(),
      })
      .parse(req.body);

    const convo = await loadWritable(req.params.id, req.user.id);
    if (convo.type === 'group') {
      const mine = convo.members.find((m) => String(m.user?.id || m.user) === req.user.id);
      if (mine?.role !== 'admin') throw httpError(403, 'Only admins can change the pace of a group.');
    }

    await C.updateConversation(convo.id, { slowMode, retentionDays });
    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

export default router;
