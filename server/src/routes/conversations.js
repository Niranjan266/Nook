import { Router } from 'express';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import * as C from '../db/conversations.js';
import * as M from '../db/messages.js';
import * as U from '../db/users.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeConversation } from '../lib/serialize.js';
import { emitToConversation, emitToUser } from '../sockets/hub.js';
import { systemMessage } from '../services/messages.js';

const router = Router();
router.use(requireAuth);

const inviteId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 8);
const MAX_PINS = 5;

const load = async (id, userId) => {
  const convo = await C.findConversationForUser(id, userId);
  if (!convo) throw httpError(404, 'That conversation is not yours, or does not exist.');
  return convo;
};

const isAdmin = (convo, userId) =>
  convo.members.find((m) => String(m.user?.id || m.user) === String(userId))?.role === 'admin';

/** Re-read and fan out to everyone, viewer-specific. */
async function broadcast(conversationId, event = 'conversation:update') {
  const fresh = await C.findConversation(conversationId);
  emitToConversation(fresh, event, null, (uid) => serializeConversation(fresh, uid));
  return fresh;
}

/* ── list ─────────────────────────────────────────────────────────────────── */

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const list = await C.listConversationsFor(req.user.id);
    res.json({ conversations: list.map((c) => serializeConversation(c, req.user.id)) });
  })
);

/* ── open (or create) a direct conversation ───────────────────────────────── */

router.post(
  '/direct',
  asyncRoute(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    if (userId === req.user.id) throw httpError(400, 'You cannot message yourself.');

    const other = await U.findUserById(userId);
    if (!other) throw httpError(404, 'No such person.');
    if (await U.blockExistsBetween(req.user.id, other.id))
      throw httpError(403, 'You cannot message this person.');

    let convo = await C.findDirectBetween(req.user.id, other.id);
    if (!convo) {
      convo = await C.createConversation({ type: 'direct', members: [req.user.id, other.id] });
      emitToUser(other.id, 'conversation:new', serializeConversation(convo, other.id));
    }

    res.json({ conversation: serializeConversation(convo, req.user.id) });
  })
);

/* ── groups ───────────────────────────────────────────────────────────────── */

router.post(
  '/group',
  asyncRoute(async (req, res) => {
    const { name, memberIds, description } = z
      .object({
        name: z.string().trim().min(1, 'Give the group a name.').max(50),
        description: z.string().trim().max(200).optional(),
        memberIds: z.array(z.string()).min(1, 'Add at least one person.'),
      })
      .parse(req.body);

    const unique = [...new Set(memberIds.filter((id) => id !== req.user.id))];

    const convo = await C.createConversation({
      type: 'group',
      name,
      description: description || '',
      createdBy: req.user.id,
      inviteCode: inviteId(),
      members: [{ user: req.user.id, role: 'admin' }, ...unique.map((user) => ({ user }))],
    });

    await systemMessage(convo, req.user.id, `${req.user.displayName} started this group`);
    const fresh = await C.findConversation(convo.id);
    unique.forEach((id) => emitToUser(id, 'conversation:new', serializeConversation(fresh, id)));

    res.status(201).json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.patch(
  '/:id/group',
  asyncRoute(async (req, res) => {
    const patch = z
      .object({
        name: z.string().trim().min(1).max(50).optional(),
        description: z.string().trim().max(200).optional(),
        avatarUrl: z.string().optional(),
      })
      .parse(req.body);

    const convo = await load(req.params.id, req.user.id);
    if (convo.type !== 'group') throw httpError(400, 'Not a group.');
    if (!isAdmin(convo, req.user.id)) throw httpError(403, 'Only admins can change the group.');

    await C.updateConversation(convo.id, patch);
    const fresh = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.post(
  '/:id/members',
  asyncRoute(async (req, res) => {
    const { memberIds } = z.object({ memberIds: z.array(z.string()).min(1) }).parse(req.body);
    const convo = await load(req.params.id, req.user.id);
    if (convo.type !== 'group') throw httpError(400, 'Not a group.');
    if (!isAdmin(convo, req.user.id)) throw httpError(403, 'Only admins can add people.');

    const existing = new Set(convo.members.map((m) => String(m.user?.id || m.user)));
    const added = memberIds.filter((id) => !existing.has(String(id)));
    for (const id of added) await C.addMember(convo.id, id);

    const fresh = await C.findConversation(convo.id);
    if (added.length) {
      const people = await U.findUsersByIds(added);
      await systemMessage(fresh, req.user.id, `${people.map((p) => p.displayName).join(', ')} joined`);
      added.forEach((id) => emitToUser(id, 'conversation:new', serializeConversation(fresh, id)));
    }

    const updated = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(updated, req.user.id) });
  })
);

router.delete(
  '/:id/members/:userId',
  asyncRoute(async (req, res) => {
    const convo = await load(req.params.id, req.user.id);
    const self = req.params.userId === req.user.id;
    if (!self && !isAdmin(convo, req.user.id)) throw httpError(403, 'Only admins can remove people.');

    const removed = await U.findUserById(req.params.userId);
    await C.removeMember(convo.id, req.params.userId);

    const fresh = await C.findConversation(convo.id);
    if (fresh?.members.length) {
      // Never leave a group with no admin.
      if (!fresh.members.some((m) => m.role === 'admin')) {
        await C.setMemberRole(convo.id, String(fresh.members[0].user.id), 'admin');
      }
      await systemMessage(
        fresh,
        req.user.id,
        self ? `${removed?.displayName} left` : `${removed?.displayName} was removed`
      );
    }

    emitToUser(req.params.userId, 'conversation:removed', { conversationId: String(convo.id) });
    await broadcast(convo.id);
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/members/:userId/role',
  asyncRoute(async (req, res) => {
    const { role } = z.object({ role: z.enum(['member', 'admin']) }).parse(req.body);
    const convo = await load(req.params.id, req.user.id);
    if (!isAdmin(convo, req.user.id)) throw httpError(403, 'Only admins can do that.');
    if (!convo.members.some((m) => String(m.user?.id || m.user) === req.params.userId))
      throw httpError(404, 'Not in this group.');

    await C.setMemberRole(convo.id, req.params.userId, role);
    await broadcast(convo.id);
    res.json({ ok: true });
  })
);

router.post(
  '/join/:code',
  asyncRoute(async (req, res) => {
    const convo = await C.findByInviteCode(req.params.code);
    if (!convo) throw httpError(404, 'That invite link is not valid.');

    await C.addMember(convo.id, req.user.id);
    const fresh = await C.findConversation(convo.id);
    await systemMessage(fresh, req.user.id, `${req.user.displayName} joined via invite`);

    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── per-member settings ──────────────────────────────────────────────────── */

router.patch(
  '/:id/prefs',
  asyncRoute(async (req, res) => {
    const patch = z
      .object({
        muted: z.boolean().optional(),
        archived: z.boolean().optional(),
        pinned: z.boolean().optional(),
        locked: z.boolean().optional(),
        draft: z.string().max(4000).optional(),
        sound: z.enum(['default', 'knock', 'pebble', 'chime', 'wood', 'hush', 'none']).optional(),
      })
      .parse(req.body);

    await load(req.params.id, req.user.id);
    await C.updateMemberPrefs(req.params.id, req.user.id, patch);
    const fresh = await C.findConversation(req.params.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.patch(
  '/:id/disappearing',
  asyncRoute(async (req, res) => {
    const { seconds } = z
      .object({ seconds: z.number().int().min(0).max(60 * 60 * 24 * 90) })
      .parse(req.body);

    const convo = await load(req.params.id, req.user.id);
    await C.updateConversation(convo.id, { disappearAfter: seconds });

    const label =
      seconds === 0
        ? 'turned off disappearing messages'
        : `set messages to disappear after ${
            seconds >= 86400
              ? `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
              : seconds >= 3600
                ? `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
                : `${seconds / 60} minutes`
          }`;

    const fresh = await C.findConversation(convo.id);
    await systemMessage(fresh, req.user.id, `${req.user.displayName} ${label}`);
    const updated = await broadcast(convo.id);
    res.json({ conversation: serializeConversation(updated, req.user.id) });
  })
);

/* ── wallpaper ────────────────────────────────────────────────────────────── */

const wallpaperSchema = z.object({
  url: z.string().optional(),
  preset: z.string().optional(),
  tint: z.string().optional(),
  dim: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(24).optional(),
});

// Direct chats: the other person is asked first (proposal).
// Groups: admins set it outright.
router.put(
  '/:id/wallpaper',
  asyncRoute(async (req, res) => {
    const body = wallpaperSchema.parse(req.body);
    const convo = await load(req.params.id, req.user.id);

    const look = {
      url: body.url ?? '',
      preset: body.preset ?? '',
      tint: body.tint ?? '',
      dim: body.dim ?? 0.35,
      blur: body.blur ?? 0,
    };

    /**
     * "Just me" needs no one's agreement.
     *
     * A wallpaper the other person never sees is a personal preference, like
     * muting or a notification sound — asking them to approve it was asking
     * permission for something that does not touch them. It is stored on the
     * membership, so it overrides the room's look for this viewer only.
     */
    if (req.query.scope === 'mine') {
      await C.updateMemberPrefs(convo.id, req.user.id, {
        wallpaper: look.url || look.preset ? { ...look, setBy: req.user.id } : null,
      });
      const mine = await C.findConversation(convo.id);
      return res.json({ conversation: serializeConversation(mine, req.user.id) });
    }

    const force = req.query.force === '1' || convo.type === 'group' || convo.members.length === 1;

    if (force) {
      if (convo.type === 'group' && !isAdmin(convo, req.user.id))
        throw httpError(403, 'Only admins can set the group wallpaper.');

      await C.pushWallpaperHistory(convo.id, convo.wallpaper, convo.wallpaper.setBy);
      await C.updateConversation(convo.id, {
        wallpaper: { ...look, setBy: req.user.id, proposal: { by: null, at: null } },
      });
      const fresh = await C.findConversation(convo.id);
      await systemMessage(fresh, req.user.id, `${req.user.displayName} changed the wallpaper`);
    } else {
      await C.updateConversation(convo.id, {
        wallpaper: { ...convo.wallpaper, proposal: { ...look, by: req.user.id, at: Date.now() } },
      });
    }

    const fresh = await C.findConversation(convo.id);
    emitToConversation(fresh, 'wallpaper:changed', null, (uid) => ({
      conversationId: String(fresh.id),
      wallpaper: serializeConversation(fresh, uid).wallpaper,
    }));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.post(
  '/:id/wallpaper/respond',
  asyncRoute(async (req, res) => {
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    const convo = await load(req.params.id, req.user.id);
    const proposal = convo.wallpaper.proposal;

    if (!proposal?.by) throw httpError(400, 'Nothing to respond to.');
    if (String(proposal.by) === req.user.id) throw httpError(400, 'You are the one who proposed it.');

    if (accept) {
      await C.pushWallpaperHistory(convo.id, convo.wallpaper, convo.wallpaper.setBy);
      await C.updateConversation(convo.id, {
        wallpaper: {
          url: proposal.url,
          preset: proposal.preset,
          tint: proposal.tint,
          dim: proposal.dim,
          blur: proposal.blur,
          setBy: proposal.by,
          proposal: { by: null, at: null },
        },
      });
    } else {
      await C.updateConversation(convo.id, {
        wallpaper: { ...convo.wallpaper, proposal: { by: null, at: null } },
      });
    }

    const fresh = await C.findConversation(convo.id);
    if (accept) await systemMessage(fresh, req.user.id, `${req.user.displayName} accepted the new wallpaper`);

    emitToConversation(fresh, 'wallpaper:changed', null, (uid) => ({
      conversationId: String(fresh.id),
      wallpaper: serializeConversation(fresh, uid).wallpaper,
    }));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/* ── pinned messages ──────────────────────────────────────────────────────
   Shared by everyone, capped at five. A pin board that holds fifty things
   is a second inbox.                                                      */

router.post(
  '/:id/pins/:messageId',
  asyncRoute(async (req, res) => {
    const convo = await load(req.params.id, req.user.id);
    const message = await M.findMessage(req.params.messageId);
    if (!message || String(message.conversation) !== String(convo.id))
      throw httpError(404, 'That message is not in this conversation.');

    if (await C.isPinned(convo.id, message.id)) throw httpError(409, 'Already pinned.');
    if ((await C.countPins(convo.id)) >= MAX_PINS)
      throw httpError(400, 'Five pins is the limit — unpin something first.');

    await C.addPin(convo.id, message.id, req.user.id);
    await systemMessage(convo, req.user.id, `${req.user.displayName} pinned a message`);

    const fresh = await C.findConversation(convo.id);
    emitToConversation(fresh, 'pins:changed', null, (uid) => ({
      conversationId: String(fresh.id),
      pins: serializeConversation(fresh, uid).pins,
    }));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.delete(
  '/:id/pins/:messageId',
  asyncRoute(async (req, res) => {
    const convo = await load(req.params.id, req.user.id);
    await C.removePin(convo.id, req.params.messageId);

    const fresh = await C.findConversation(convo.id);
    emitToConversation(fresh, 'pins:changed', null, (uid) => ({
      conversationId: String(fresh.id),
      pins: serializeConversation(fresh, uid).pins,
    }));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

router.get(
  '/:id/pins',
  asyncRoute(async (req, res) => {
    const convo = await load(req.params.id, req.user.id);
    res.json({ pins: serializeConversation(convo, req.user.id).pins });
  })
);

/* ── delete / clear ───────────────────────────────────────────────────────── */

router.delete(
  '/:id/messages',
  asyncRoute(async (req, res) => {
    const convo = await load(req.params.id, req.user.id);
    await M.clearConversationFor(convo.id, req.user.id);
    res.json({ ok: true });
  })
);

export default router;
