import { Router } from 'express';
import { z } from 'zod';
import * as U from '../db/users.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { publicQuietHours } from '../services/quietHours.js';
import { emitToUser } from '../sockets/hub.js';
import { notify } from '../services/push.js';
import { warmNicknames } from '../lib/nicknames.js';

const router = Router();
router.use(requireAuth);

/**
 * `nicks` is the viewer's private rename map. Passing it here keeps these
 * responses consistent with everything `serialize.js` produces — a person you
 * have renamed reads the same in search results as in the chat header.
 */
const publicUser = (u, extra = {}, nicks = {}) => {
  const nickname = nicks[u.id] || '';
  return {
    id: u.id,
    username: u.username,
    nookId: u.nookId || '',
    displayName: nickname || u.displayName,
    realName: u.displayName,
    nickname,
    avatarUrl: u.avatarUrl,
    about: u.about,
    accent: u.accent,
    online: u.online,
    lastSeen: u.lastSeen,
    ...extra,
  };
};

/* ── search people by username, display name or Nook ID ───────────────────── */

router.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });

    const [blocked, contacts, nicks] = await Promise.all([
      U.blockedIds(req.user.id),
      U.contactIds(req.user.id),
      U.nicknameMap(req.user.id),
    ]);

    const users = await U.searchUsers({ query: q, excludeId: req.user.id, excludeIds: blocked });
    res.json({
      users: users.map((u) => publicUser(u, { isContact: contacts.includes(u.id) }, nicks)),
      // Lets the client say "that's a Nook ID and nobody has it" rather than
      // the vaguer "no results", which reads like a typo in your own code.
      exactNookId: U.looksLikeNookId(q),
    });
  })
);

/* ── change your username ─────────────────────────────────────────────────
   The Nook ID is the permanent identity and is deliberately not editable —
   there is no endpoint for it. The username is the changeable handle.

   That split is what makes changing a username safe. A freed-up username can
   be claimed by someone else, so if the username were also the identity, a
   rename would hand a stranger the ability to be mistaken for you. Because
   the Nook ID never moves, anyone who saved your code still reaches the real
   you no matter what you call yourself.
   ────────────────────────────────────────────────────────────────────────── */

const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Usernames need at least 3 characters.')
  .max(20, 'Usernames max out at 20 characters.')
  .regex(/^[a-z0-9_.]+$/, 'Letters, numbers, dots and underscores only.');

router.get(
  '/username-available/:username',
  asyncRoute(async (req, res) => {
    const parsed = usernameRule.safeParse(req.params.username);
    if (!parsed.success) return res.json({ available: false, reason: parsed.error.issues[0].message });

    // Your current username is "available" to you — otherwise the form reads
    // as an error the moment you open it.
    if (parsed.data === req.user.username) return res.json({ available: true, reason: 'This is your username.' });

    const taken = await U.usernameTaken(parsed.data);
    res.json({ available: !taken, reason: taken ? 'Someone already has that one.' : '' });
  })
);

router.patch(
  '/me/username',
  asyncRoute(async (req, res) => {
    const { username } = z.object({ username: usernameRule }).parse(req.body);

    if (username === req.user.username) {
      return res.json({ username, unchanged: true });
    }
    if (await U.usernameTaken(username)) throw httpError(409, 'Someone already has that username.');

    const updated = await U.setUsername(req.user.id, username);
    res.json({ username: updated.username, nookId: updated.nookId });
  })
);

/* ── profile ──────────────────────────────────────────────────────────────── */

router.patch(
  '/me',
  asyncRoute(async (req, res) => {
    const patch = z
      .object({
        displayName: z.string().trim().min(1).max(40).optional(),
        about: z.string().trim().max(140).optional(),
        avatarUrl: z.string().optional(),
        accent: z.enum(['terracotta', 'moss', 'ochre', 'clay-blue', 'rust']).optional(),
        privacy: z
          .object({
            lastSeen: z.enum(['everyone', 'contacts', 'nobody']).optional(),
            readReceipts: z.boolean().optional(),
            avatar: z.enum(['everyone', 'contacts', 'nobody']).optional(),
          })
          .optional(),
        settings: z
          .object({
            theme: z.enum(['light', 'dark', 'system']).optional(),
            enterToSend: z.boolean().optional(),
            soundOn: z.boolean().optional(),
            reduceMotion: z.boolean().optional(),
            swipeToReply: z.boolean().optional(),
            linkPreviews: z.boolean().optional(),
            badgeCount: z.boolean().optional(),
            voiceSpeed: z.number().min(0.5).max(3).optional(),
            skipSilence: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(req.body);

    const user = await U.updateUser(req.user.id, patch);
    res.json({
      user: publicUser(user, { privacy: user.privacy, settings: user.settings, email: user.email }),
    });
  })
);

/* ── chat folders ─────────────────────────────────────────────────────────
   Stored on the user, not the conversation: your idea of "Work" is yours.  */

const folderSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(24),
  emoji: z.string().max(8).optional(),
  conversations: z.array(z.string()).max(500).optional(),
});

router.get(
  '/me/folders',
  asyncRoute(async (req, res) => res.json({ folders: await U.listFolders(req.user.id) }))
);

router.put(
  '/me/folders',
  asyncRoute(async (req, res) => {
    const { folders } = z.object({ folders: z.array(folderSchema).max(12) }).parse(req.body);
    res.json({ folders: await U.replaceFolders(req.user.id, folders) });
  })
);

router.post(
  '/me/folders/:folderId/conversations/:conversationId',
  asyncRoute(async (req, res) => {
    if (!(await U.folderExists(req.user.id, req.params.folderId)))
      throw httpError(404, 'No folder with that id.');
    await U.addToFolder(req.user.id, req.params.folderId, req.params.conversationId);
    res.json({ folders: await U.listFolders(req.user.id) });
  })
);

router.delete(
  '/me/folders/:folderId/conversations/:conversationId',
  asyncRoute(async (req, res) => {
    await U.removeFromFolder(req.user.id, req.params.folderId, req.params.conversationId);
    res.json({ folders: await U.listFolders(req.user.id) });
  })
);

/* ── quiet hours ──────────────────────────────────────────────────────────
   A contract, not a personal mute: the people you talk to can see it.     */

router.put(
  '/me/quiet-hours',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        enabled: z.boolean(),
        start: z.number().min(0).max(1439).optional(),
        end: z.number().min(0).max(1439).optional(),
        timezone: z.string().max(64).optional(),
        allowUrgent: z.boolean().optional(),
        visible: z.boolean().optional(),
      })
      .parse(req.body);

    if (!body.timezone) body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const user = await U.updateUser(req.user.id, { quietHours: body });
    res.json({ quietHours: user.quietHours });
  })
);

/* ── nudge ────────────────────────────────────────────────────────────────
   Deliberately scarce: once every 24 hours. An unlimited nudge is just
   another ping — the scarcity is what makes it mean something.            */

router.post(
  '/:id/nudge',
  asyncRoute(async (req, res) => {
    const since = req.user.lastNudgeAt ? Date.now() - new Date(req.user.lastNudgeAt).getTime() : Infinity;
    if (since < 24 * 3600_000) {
      const hours = Math.ceil((24 * 3600_000 - since) / 3600_000);
      throw httpError(429, `One nudge a day. Try again in ${hours}h.`);
    }

    const target = await U.findUserById(req.params.id);
    if (!target) throw httpError(404, 'No such person.');
    if (await U.blockExistsBetween(req.user.id, target.id))
      throw httpError(403, 'You cannot nudge this person.');

    await U.updateUser(req.user.id, { lastNudgeAt: new Date() });

    emitToUser(target.id, 'nudge', {
      from: { id: req.user.id, displayName: req.user.displayName, username: req.user.username },
    });
    notify(target.id, {
      title: req.user.displayName,
      body: 'nudged you',
      tag: `nudge-${req.user.id}`,
      urgent: true,
    }).catch(() => {});

    res.json({ ok: true });
  })
);

/* ── contacts ─────────────────────────────────────────────────────────────── */

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const ids = await U.contactIds(req.user.id);
    const [contacts, nicks] = await Promise.all([U.findUsersByIds(ids), U.nicknameMap(req.user.id)]);
    res.json({ contacts: contacts.map((u) => publicUser(u, {}, nicks)) });
  })
);

/* ── nicknames — what you call someone, private to you ────────────────────── */

router.put(
  '/:id/nickname',
  asyncRoute(async (req, res) => {
    const { nickname } = z
      .object({ nickname: z.string().trim().max(40, 'Nicknames max out at 40 characters.') })
      .parse(req.body);

    if (req.params.id === req.user.id) throw httpError(400, 'Change your own name in Settings.');
    const person = await U.findUserById(req.params.id);
    if (!person) throw httpError(404, 'No such person.');

    const saved = nickname
      ? await U.setNickname(req.user.id, person.id, nickname)
      : (await U.clearNickname(req.user.id, person.id), '');

    // The serialisers read this map synchronously, so it must be refreshed
    // before the next response is built — otherwise the rename would appear
    // only after a reconnect.
    await warmNicknames(req.user.id);

    // Deliberately only to this viewer's own devices. The person renamed must
    // never learn about it, and nobody else in a shared group should either.
    emitToUser(req.user.id, 'nickname:update', { userId: person.id, nickname: saved });

    res.json({ userId: person.id, nickname: saved, realName: person.displayName });
  })
);

router.delete(
  '/:id/nickname',
  asyncRoute(async (req, res) => {
    await U.clearNickname(req.user.id, req.params.id);
    await warmNicknames(req.user.id);
    emitToUser(req.user.id, 'nickname:update', { userId: req.params.id, nickname: '' });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/contact',
  asyncRoute(async (req, res) => {
    if (req.params.id === req.user.id) throw httpError(400, 'You already know yourself.');
    if (!(await U.findUserById(req.params.id))) throw httpError(404, 'No such person.');
    await U.addContact(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/contact',
  asyncRoute(async (req, res) => {
    await U.removeContact(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);

/* ── block ────────────────────────────────────────────────────────────────── */

router.post(
  '/:id/block',
  asyncRoute(async (req, res) => {
    await U.blockUser(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/block',
  asyncRoute(async (req, res) => {
    await U.unblockUser(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);

/* ── one person's profile ─────────────────────────────────────────────────
   Kept last: `/search` and `/me/...` must not be swallowed by `/:id`.     */

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const user = await U.findUserById(req.params.id);
    if (!user) throw httpError(404, 'No such person.');

    const [contacts, blocked] = await Promise.all([
      U.contactIds(req.user.id),
      U.blockedIds(req.user.id),
    ]);
    const isContact = contacts.includes(user.id);
    const allow = (rule) => rule === 'everyone' || (rule === 'contacts' && isContact);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        about: user.about,
        accent: user.accent,
        avatarUrl: allow(user.privacy.avatar) ? user.avatarUrl : '',
        online: allow(user.privacy.lastSeen) ? user.online : false,
        lastSeen: allow(user.privacy.lastSeen) ? user.lastSeen : null,
        // The whole point of quiet hours: you see them before you send.
        quietHours: publicQuietHours(user),
        isContact,
        isBlocked: blocked.includes(user.id),
      },
    });
  })
);

export default router;
