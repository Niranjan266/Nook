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
import * as F from '../db/friends.js';
import { hash as hashSecret, verify as verifySecret } from '../services/password.js';
import { grantUnlock, hasUnlock, revokeUnlock } from '../lib/lockgrants.js';

const router = Router();
router.use(requireAuth);

const inviteId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 8);
const MAX_PINS = 5;

const load = async (id, userId) => {
  const convo = await C.findConversationForUser(id, userId);
  if (!convo) throw httpError(404, 'That conversation is not yours, or does not exist.');
  return convo;
};

/**
 * You may only add people who have accepted you.
 *
 * Friend gating covered direct chats and nothing else, which made a two-person
 * group an ungated DM: `POST /conversations/group` took an arbitrary
 * `memberIds`, and `createMessage` exempts groups from both the friendship and
 * the block check. A stranger — or someone you had blocked — could message you
 * freely by naming the room. The rule has to be about consent to be contacted,
 * so it belongs wherever someone is added to a room, not only in direct chats.
 */
async function assertMayAdd(actor, ids) {
  for (const id of ids) {
    if (String(id) === String(actor.id)) continue;
    const person = await U.findUserById(id);
    if (!person) throw httpError(404, 'No such person.');
    if (await U.blockExistsBetween(actor.id, person.id))
      throw httpError(403, `You cannot add ${person.displayName}.`);
    if (!(await F.areFriends(actor.id, person.id)))
      throw httpError(403, `${person.displayName} has to accept your request first.`, {
        code: 'NOT_FRIENDS',
      });
  }
}

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
    await assertMayAdd(req.user, unique);

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
    await assertMayAdd(req.user, added);
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
        // `locked` is deliberately NOT here. It used to be, which made the
        // whole feature a formality: PATCH /prefs {"locked":false} cleared the
        // flag while the hash stayed in the row, and every gate tests
        // `locked && lockHash`. One request, no code, full history. Locking and
        // unlocking now live only on /lock, where they have to prove the code.
        draft: z.string().max(4000).optional(),
        sound: z.enum(['default', 'knock', 'pebble', 'chime', 'wood', 'hush', 'none']).optional(),
        // -1 follow my default, 0 off, 1 on.
        notifyVibrate: z.number().int().min(-1).max(1).optional(),
        notifyPreview: z.number().int().min(-1).max(1).optional(),
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

    /**
     * `?force=1` used to skip the consent flow, which meant the flow was
     * decorative: anyone could set the shared wallpaper of a chat by adding
     * five characters to the URL. A direct chat with two people always asks;
     * "just me" is the escape hatch, and it is an honest one because it
     * changes nothing for the other person.
     */
    const force = convo.type === 'group' || convo.members.length === 1;

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


/* ── chat lock ────────────────────────────────────────────────────────────── */

/**
 * A PIN is 4-6 digits. A pattern is the sequence of dots it traces, as indices
 * 0-8 with no repeats and at least four of them — the same rule Android uses,
 * and for the same reason: a three-dot pattern has 400-odd possibilities.
 *
 * Both arrive as a short string, so everything downstream — hashing, checking,
 * counting failures — treats them identically and cannot drift apart.
 */
const PIN_RE = /^[0-9]{4,6}$/;

function normaliseCode(kind, raw) {
  const code = String(raw ?? '').trim();
  if (kind === 'pin') {
    if (!PIN_RE.test(code)) throw httpError(400, 'A PIN is 4 to 6 digits.');
    return code;
  }
  if (kind === 'pattern') {
    const dots = code.split(',').map((d) => d.trim()).filter(Boolean);
    if (dots.length < 4) throw httpError(400, 'Join at least four dots.');
    if (dots.some((d) => !/^[0-8]$/.test(d))) throw httpError(400, 'That pattern is not valid.');
    if (new Set(dots).size !== dots.length) throw httpError(400, 'That pattern reuses a dot.');
    return dots.join(',');
  }
  throw httpError(400, 'Choose a PIN or a pattern.');
}

const myMembership = (convo, userId) =>
  convo.members.find((m) => String(m.user?.id || m.user) === String(userId));

/**
 * Wrong codes are counted per person per chat, in memory.
 *
 * bcrypt on a four-digit PIN is ten thousand guesses for anyone who ever gets
 * the hash, so the honest defence is refusing to be asked quickly. This is not
 * a claim that the lock resists an attacker with the database; it is a claim
 * that it resists someone holding the unlocked phone, which is who the feature
 * is actually for.
 */
const failures = new Map();
const FAIL_LIMIT = 5;
const FAIL_WINDOW = 5 * 60 * 1000;

function noteFailure(userId, convoId) {
  const k = `${userId}:${convoId}`;
  const now = Date.now();
  const rec = failures.get(k);
  if (!rec || now > rec.until) failures.set(k, { n: 1, until: now + FAIL_WINDOW });
  else rec.n += 1;
}

function tooManyFailures(userId, convoId) {
  const rec = failures.get(`${userId}:${convoId}`);
  if (!rec) return 0;
  if (Date.now() > rec.until) {
    failures.delete(`${userId}:${convoId}`);
    return 0;
  }
  return rec.n >= FAIL_LIMIT ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}

const clearFailures = (userId, convoId) => failures.delete(`${userId}:${convoId}`);

/** Turn the lock on, or change the code. Changing it requires the old one. */
router.put(
  '/:id/lock',
  asyncRoute(async (req, res) => {
    const { kind, code, currentCode } = z
      .object({
        kind: z.enum(['pin', 'pattern']),
        code: z.string().min(1),
        currentCode: z.string().optional(),
      })
      .parse(req.body);

    const convo = await load(req.params.id, req.user.id);
    const mine = myMembership(convo, req.user.id);

    // Already locked? Prove you can open it before you can change it.
    if (mine?.lockHash) {
      const wait = tooManyFailures(req.user.id, convo.id);
      if (wait) throw httpError(429, `Too many tries. Wait ${wait}s.`);
      const okOld = await verifySecret(mine.lockHash, String(currentCode || '')).catch(() => false);
      if (!okOld) {
        noteFailure(req.user.id, convo.id);
        throw httpError(403, 'That is not the current code.');
      }
    }

    const normalised = normaliseCode(kind, code);
    await C.updateMemberPrefs(convo.id, req.user.id, {
      locked: true,
      lockKind: kind,
      lockHash: await hashSecret(normalised),
    });

    clearFailures(req.user.id, convo.id);
    // Setting a code closes the chat now, rather than leaving it open until
    // the old grant runs out — which would look like the lock did nothing.
    revokeUnlock(req.user.id, convo.id);

    const fresh = await C.findConversation(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/** Take the lock off. Needs the code — otherwise it is not a lock. */
router.delete(
  '/:id/lock',
  asyncRoute(async (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body || {});
    const convo = await load(req.params.id, req.user.id);
    const mine = myMembership(convo, req.user.id);
    if (!mine?.lockHash) return res.json({ conversation: serializeConversation(convo, req.user.id) });

    const wait = tooManyFailures(req.user.id, convo.id);
    if (wait) throw httpError(429, `Too many tries. Wait ${wait}s.`);

    const ok = await verifySecret(mine.lockHash, String(code)).catch(() => false);
    if (!ok) {
      noteFailure(req.user.id, convo.id);
      throw httpError(403, 'That code is not right.');
    }

    await C.updateMemberPrefs(convo.id, req.user.id, { locked: false, lockKind: '', lockHash: '' });
    clearFailures(req.user.id, convo.id);
    revokeUnlock(req.user.id, convo.id);

    const fresh = await C.findConversation(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

/** Enter the code to read the chat. Grants a short-lived unlock. */
router.post(
  '/:id/lock/verify',
  asyncRoute(async (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body || {});
    const convo = await load(req.params.id, req.user.id);
    const mine = myMembership(convo, req.user.id);
    if (!mine?.lockHash) {
      grantUnlock(req.user.id, convo.id);
      return res.json({ ok: true, conversation: serializeConversation(convo, req.user.id) });
    }

    const wait = tooManyFailures(req.user.id, convo.id);
    if (wait) throw httpError(429, `Too many tries. Wait ${wait}s.`);

    const ok = await verifySecret(mine.lockHash, String(code)).catch(() => false);
    if (!ok) {
      noteFailure(req.user.id, convo.id);
      throw httpError(403, 'That code is not right.');
    }

    clearFailures(req.user.id, convo.id);
    grantUnlock(req.user.id, convo.id);
    const fresh = await C.findConversation(convo.id);
    res.json({ ok: true, conversation: serializeConversation(fresh, req.user.id) });
  })
);

/** Close it again by hand, without waiting for the grant to lapse. */
router.post(
  '/:id/lock/close',
  asyncRoute(async (req, res) => {
    revokeUnlock(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);


export default router;
