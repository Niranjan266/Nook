/**
 * Secret chats: the key directory and the handshake relay.
 *
 * What the server does here is deliberately small. It publishes public keys,
 * binds a new secret conversation to one device on each side, and passes the
 * creator's signed handshake to the other device. It never sees a private
 * key or a shared secret, and it could not complete a handshake if it tried —
 * which is the property worth protecting, so nothing here takes one.
 */
import { Router } from 'express';
import { z } from 'zod';
import * as C from '../db/conversations.js';
import * as U from '../db/users.js';
import * as K from '../db/e2ee.js';
import { areFriends } from '../db/friends.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { serializeConversation } from '../lib/serialize.js';
import { emitToUser } from '../sockets/hub.js';

const router = Router();
router.use(requireAuth);

const b64url = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'That key is not a P-256 point.');

/**
 * A public P-256 key as JWK. Anything carrying `d` is refused outright: a
 * private key sent here by a buggy client must bounce, not be stored.
 */
const publicJwk = z
  .object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: b64url, y: b64url })
  .passthrough()
  .refine((j) => !('d' in j), 'Only public keys may be published.')
  // Stored in one canonical shape, so "did the key change?" is a string compare.
  .transform(({ kty, crv, x, y }) => ({ kty, crv, x, y }));

const deviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'That device id is not valid.');

const serializeDevice = (d) => ({
  deviceId: d.deviceId,
  identityPub: d.identityPub,
  signingPub: d.signingPub,
  createdAt: d.createdAt.toISOString(),
  lastSeen: d.lastSeen.toISOString(),
});

/* ── my devices ───────────────────────────────────────────────────────────── */

router.post(
  '/devices',
  asyncRoute(async (req, res) => {
    const body = z
      .object({ deviceId, identityPub: publicJwk, signingPub: publicJwk })
      .parse(req.body);
    const result = await K.upsertDevice(req.user.id, body);
    res.status(result.created ? 201 : 200).json({ ok: true, ...result });
  })
);

/* ── someone's devices ────────────────────────────────────────────────────── */

/**
 * Public keys are not secret, but *which devices someone uses, and when they
 * last opened one* is a small presence leak. So the same line the rest of the
 * app draws: yourself, a friend, or someone you already share a chat with —
 * and never across a block.
 */
async function mayViewDevices(viewerId, ownerId) {
  if (String(viewerId) === String(ownerId)) return true;
  if (await U.blockExistsBetween(viewerId, ownerId)) return false;
  if (await areFriends(viewerId, ownerId)) return true;
  return K.shareAConversation(viewerId, ownerId);
}

router.get(
  '/devices/:userId',
  asyncRoute(async (req, res) => {
    const owner = await U.findUserById(req.params.userId);
    // The same answer for "no such person" and "not yours to look at", so the
    // route cannot be used to test which accounts exist.
    if (!owner || !(await mayViewDevices(req.user.id, owner.id)))
      throw httpError(404, 'No keys to show for that person.');
    const devices = await K.devicesOf(owner.id);
    res.json({ devices: devices.map(serializeDevice) });
  })
);

/* ── start a secret chat ──────────────────────────────────────────────────── */

const endOf = (userId, d) => ({
  userId: String(userId),
  deviceId: d.deviceId,
  identityPub: d.identityPub,
  signingPub: d.signingPub,
});

router.post(
  '/secret',
  asyncRoute(async (req, res) => {
    const body = z
      .object({ userId: z.string().min(1), deviceId, partnerDeviceId: deviceId.optional() })
      .parse(req.body);
    if (body.userId === req.user.id) throw httpError(400, 'A secret chat needs someone else in it.');

    const other = await U.findUserById(body.userId);
    if (!other) throw httpError(404, 'No such person.');
    if (await U.blockExistsBetween(req.user.id, other.id))
      throw httpError(403, 'You cannot message this person.');
    // Stricter than an ordinary chat, which may exist before a request is
    // accepted: a secret chat is bound to someone's device the moment it is
    // made, and that should not happen to a stranger.
    if (!(await areFriends(req.user.id, other.id)))
      throw httpError(403, 'They need to accept your request before you can start a secret chat.', {
        code: 'NOT_FRIENDS',
      });

    const mine = await K.findDevice(req.user.id, body.deviceId);
    if (!mine) throw httpError(400, 'This device has not published its keys yet.');

    // The partner's device: the one asked for, or the one they used last.
    const theirs = body.partnerDeviceId
      ? await K.findDevice(other.id, body.partnerDeviceId)
      : (await K.devicesOf(other.id))[0];
    if (!theirs)
      throw httpError(409, `${other.displayName} has not opened Nook on a device that supports secret chats yet.`, {
        code: 'NO_DEVICE',
      });

    const existing = await K.findSecretBetween(req.user.id, mine.deviceId, other.id, theirs.deviceId);
    if (existing) {
      const convo = await C.findConversation(existing);
      return res.json({ conversation: serializeConversation(convo, req.user.id), existing: true });
    }

    // A snapshot of both public keys as they are now. Safety numbers are
    // computed from this, so a later change to the published keys shows up as
    // a difference instead of silently becoming the new truth.
    const convo = await C.createConversation({
      type: 'secret',
      createdBy: req.user.id,
      members: [req.user.id, other.id],
      secret: {
        v: 1,
        initiator: endOf(req.user.id, mine),
        responder: endOf(other.id, theirs),
        handshake: null,
      },
    });

    // The partner hears about it once the handshake is in; until then there is
    // nothing their device could do with it.
    res.status(201).json({ conversation: serializeConversation(convo, req.user.id) });
  })
);

/**
 * The creator's half of the handshake: an ephemeral public key and a
 * signature over it. Set once, by the creator, and relayed as-is. The server
 * does not verify the signature — the partner's device does, against the
 * signing key in the snapshot, which is the check that actually matters.
 */
router.post(
  '/secret/:id/handshake',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        ephemeralPub: publicJwk,
        signature: z.string().regex(/^[A-Za-z0-9+/=_-]{16,200}$/, 'That signature is not valid.'),
      })
      .parse(req.body);

    const convo = await C.findConversationForUser(req.params.id, req.user.id);
    if (!convo || convo.type !== 'secret' || !convo.secret) throw httpError(404, 'No such secret chat.');
    if (String(convo.secret.initiator?.userId) !== String(req.user.id))
      throw httpError(403, 'Only the person who started this chat can send its handshake.');
    // Once only. A second handshake would be a way to swap keys under a chat
    // the other person already trusts.
    if (convo.secret.handshake) throw httpError(409, 'This chat already has its handshake.');

    await K.setSecret(convo.id, {
      ...convo.secret,
      handshake: { ephemeralPub: body.ephemeralPub, signature: body.signature, at: Date.now() },
    });

    const fresh = await C.findConversation(convo.id);
    const partnerId = String(convo.secret.responder.userId);
    emitToUser(partnerId, 'conversation:new', serializeConversation(fresh, partnerId));
    emitToUser(req.user.id, 'conversation:update', serializeConversation(fresh, req.user.id));
    res.json({ conversation: serializeConversation(fresh, req.user.id) });
  })
);

export default router;
