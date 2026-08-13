/**
 * Spaces (workspaces) and guest links.
 *
 * A space groups conversations — personal life in one, a business in another —
 * with its own branding, roles and retention. Guest links let a customer join a
 * single conversation with no account and no install, which is the difference
 * between a business actually using this and not.
 */
import { Router } from 'express';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import * as S from '../db/misc.js';
import * as C from '../db/conversations.js';
import * as U from '../db/users.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeConversation } from '../lib/serialize.js';
import { signAccess, signRefresh, setRefreshCookie } from '../services/tokens.js';
import { hash as hashPassword } from '../services/password.js';

const router = Router();
const code = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 10);

/* ── public: redeem a guest link (no auth) ────────────────────────────────
   Kept above requireAuth on purpose — a guest has no account yet.         */

async function usableLink(codeValue) {
  const link = await S.findGuestLink(codeValue);
  if (!link || link.revoked) throw httpError(404, 'That link is not valid any more.');
  if (link.expiresAt && link.expiresAt < new Date()) throw httpError(410, 'That link has expired.');
  if (link.maxUses && link.uses >= link.maxUses) throw httpError(410, 'That link has been used up.');
  return link;
}

router.get(
  '/guest/:code',
  asyncRoute(async (req, res) => {
    const link = await usableLink(req.params.code);
    const convo = await C.findConversation(link.conversation);
    res.json({
      invite: {
        label: link.label,
        conversationName: convo?.name || 'a conversation',
        expiresAt: link.expiresAt,
      },
    });
  })
);

router.post(
  '/guest/:code/join',
  asyncRoute(async (req, res) => {
    const { displayName } = z
      .object({ displayName: z.string().trim().min(1, 'What should we call you?').max(40) })
      .parse(req.body);

    const link = await usableLink(req.params.code);
    const convo = await C.findConversation(link.conversation);
    if (!convo) throw httpError(404, 'That conversation no longer exists.');

    // A throwaway account: no password anyone can use, no email, no discovery.
    const guest = await U.createUser({
      username: `guest.${code().slice(0, 8)}`,
      displayName,
      passwordHash: await hashPassword(code() + code()),
      about: 'Joined as a guest.',
      privacy: { lastSeen: 'nobody', readReceipts: true, avatar: 'contacts' },
    });

    await C.addMember(convo.id, guest.id);
    await S.useGuestLink(link.code);

    setRefreshCookie(res, signRefresh(guest.id));
    res.status(201).json({
      accessToken: signAccess(guest.id),
      user: { id: guest.id, username: guest.username, displayName: guest.displayName, guest: true },
      conversationId: String(convo.id),
    });
  })
);

router.use(requireAuth);

/* ── spaces ───────────────────────────────────────────────────────────────── */

router.get(
  '/',
  asyncRoute(async (req, res) => res.json({ spaces: await S.listSpacesFor(req.user.id) }))
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1, 'Give the space a name.').max(40),
        kind: z.enum(['personal', 'business']).default('business'),
        accent: z.string().optional(),
      })
      .parse(req.body);

    const space = await S.createSpace({
      name: body.name,
      kind: body.kind,
      ownerId: req.user.id,
      accent: body.accent,
      inviteCode: code(),
    });
    res.status(201).json({ space: { id: space.id, name: space.name, role: 'owner' } });
  })
);

const canAdmin = async (spaceId, userId) =>
  ['owner', 'admin'].includes(await S.spaceRoleOf(spaceId, userId));

router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        retentionDays: z.number().min(0).max(3650).optional(),
        branding: z
          .object({
            logoUrl: z.string().optional(),
            accent: z.string().optional(),
            wallpaperPreset: z.string().optional(),
          })
          .optional(),
      })
      .parse(req.body);

    if (!(await S.findSpace(req.params.id))) throw httpError(404, 'No such space.');
    if (!(await canAdmin(req.params.id, req.user.id)))
      throw httpError(403, 'Only owners and admins can change a space.');

    const space = await S.updateSpace(req.params.id, body);
    res.json({ space: { id: space.id, name: space.name, branding: space.branding } });
  })
);

router.post(
  '/:id/members',
  asyncRoute(async (req, res) => {
    const { userId, role } = z
      .object({ userId: z.string(), role: z.enum(['admin', 'member', 'guest']).default('member') })
      .parse(req.body);

    if (!(await S.findSpace(req.params.id))) throw httpError(404, 'No such space.');
    if (!(await canAdmin(req.params.id, req.user.id)))
      throw httpError(403, 'Only owners and admins can add people.');

    await S.addSpaceMember(req.params.id, userId, role);
    res.json({ ok: true });
  })
);

/**
 * Revoke everything in one action. This is the feature a business owner
 * actually wants on the day someone leaves.
 */
router.delete(
  '/:id/members/:userId',
  asyncRoute(async (req, res) => {
    const space = await S.findSpace(req.params.id);
    if (!space) throw httpError(404, 'No such space.');
    if (!(await canAdmin(req.params.id, req.user.id)))
      throw httpError(403, 'Only owners and admins can remove people.');
    if (String(space.owner) === req.params.userId) throw httpError(400, 'The owner cannot be removed.');

    await S.removeSpaceMember(space.id, req.params.userId);
    const revoked = await S.revokeSpaceAccess(space.id, req.params.userId);
    res.json({ ok: true, conversationsRevoked: revoked });
  })
);

/* ── guest links ──────────────────────────────────────────────────────────── */

router.post(
  '/conversations/:conversationId/guest-link',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        label: z.string().trim().max(40).optional(),
        expiresInHours: z.number().min(1).max(24 * 90).optional(),
        maxUses: z.number().min(0).max(500).optional(),
      })
      .parse(req.body);

    const convo = await C.findConversationForUser(req.params.conversationId, req.user.id);
    if (!convo) throw httpError(404, 'That conversation is not yours.');

    const link = await S.createGuestLink({
      code: code(),
      conversationId: convo.id,
      createdBy: req.user.id,
      label: body.label || 'Guest',
      expiresAt: body.expiresInHours ? Date.now() + body.expiresInHours * 3600_000 : null,
      maxUses: body.maxUses ?? 0,
    });

    res.status(201).json({
      link: { code: link.code, label: link.label, expiresAt: link.expiresAt, maxUses: link.maxUses },
    });
  })
);

router.get(
  '/conversations/:conversationId/guest-links',
  asyncRoute(async (req, res) => {
    const convo = await C.findConversationForUser(req.params.conversationId, req.user.id);
    if (!convo) throw httpError(404, 'That conversation is not yours.');

    const links = await S.listGuestLinks(convo.id);
    res.json({
      links: links.map((l) => ({
        code: l.code,
        label: l.label,
        expiresAt: l.expires_at ? new Date(l.expires_at).toISOString() : null,
        maxUses: l.max_uses,
        uses: l.uses,
      })),
    });
  })
);

router.delete(
  '/guest-links/:code',
  asyncRoute(async (req, res) => {
    const link = await S.findGuestLink(req.params.code);
    if (!link) throw httpError(404, 'No such link.');
    if (!(await C.findConversationForUser(link.conversation, req.user.id)))
      throw httpError(403, 'Not yours to revoke.');

    await S.revokeGuestLink(link.code);
    res.json({ ok: true });
  })
);

/* ── move a conversation into a space ─────────────────────────────────────── */

router.patch(
  '/conversations/:conversationId/space',
  asyncRoute(async (req, res) => {
    const { spaceId } = z.object({ spaceId: z.string().nullable() }).parse(req.body);

    const convo = await C.findConversationForUser(req.params.conversationId, req.user.id);
    if (!convo) throw httpError(404, 'That conversation is not yours.');

    if (spaceId) {
      if (!(await S.isSpaceMember(spaceId, req.user.id))) throw httpError(404, 'No such space.');
      const space = await S.findSpace(spaceId);
      await C.updateConversation(convo.id, {
        spaceId,
        retentionDays: space.retentionDays && !convo.retentionDays ? space.retentionDays : undefined,
      });
    } else {
      await C.updateConversation(convo.id, { spaceId: null });
    }

    const fresh = await C.findConversation(convo.id);
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

export default router;
