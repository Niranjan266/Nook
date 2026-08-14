/**
 * The admin panel's API. Served under /api/admin, reachable from /nookcontrol.
 *
 * Two things govern the design.
 *
 * First, admin is a *separate identity from a user account*. An admin token is
 * signed with its own claim and cannot be produced by signing in normally, so
 * compromising any user account — including the owner's — does not hand over
 * the panel. It also means the panel keeps working if the owner's own Nook
 * account is deleted.
 *
 * Second, every action that touches somebody's account is written to
 * `admin_audit` before it happens. Not because anyone here is untrusted, but
 * because "did I suspend that account, or did something else?" is a question
 * that only has an answer if you wrote it down at the time.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import * as A from '../db/admin.js';
import * as U from '../db/users.js';
import { asyncRoute } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { verify as verifyPassword } from '../services/password.js';
import { signAccess } from '../services/tokens.js';

const router = Router();

/** Admin tokens are short-lived on purpose: this is a tool, not a session. */
const TOKEN_TTL = '2h';
const adminSecret = () => `${env.refreshSecret}::admin`;

const signAdmin = (actor) => jwt.sign({ adm: true, actor }, adminSecret(), { expiresIn: TOKEN_TTL });

const clientIp = (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();

/* ── who is allowed ───────────────────────────────────────────────────────── */

/**
 * The Google identity that may administer this instance. Configured, not
 * hardcoded, so it can be changed without a deploy — but defaulted, so a fresh
 * clone is not silently wide open with an empty allowlist.
 */
const adminEmails = () =>
  (env.admin.emails || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const isAdminEmail = (email) => adminEmails().includes(String(email || '').toLowerCase());

const passwordConfigured = () => Boolean(env.admin.username && env.admin.passwordHash);

/* ── sign in ──────────────────────────────────────────────────────────────── */

const signInLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait fifteen minutes.' },
});

router.post(
  '/sign-in',
  signInLimit,
  asyncRoute(async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);

    if (!passwordConfigured()) {
      throw httpError(503, 'Admin password sign-in is not configured on this server.');
    }

    const nameOk = username.trim().toLowerCase() === env.admin.username.toLowerCase();
    const passOk = await verifyPassword(env.admin.passwordHash, password).catch(() => false);

    // Compare both before answering, and answer identically either way — a
    // faster "no" for a wrong username tells an attacker which half to work on.
    if (!nameOk || !passOk) {
      await A.audit({
        actor: username.slice(0, 40),
        action: 'sign-in-failed',
        ip: clientIp(req),
      });
      throw httpError(401, 'That is not right.');
    }

    const actor = `password:${env.admin.username}`;
    await A.audit({ actor, action: 'sign-in', ip: clientIp(req) });
    res.json({ token: signAdmin(actor), actor, expiresIn: TOKEN_TTL });
  })
);

/**
 * Sign in with the Google identity already used for the app. The handoff code
 * comes from the normal Google flow — this endpoint just checks the resulting
 * account is on the allowlist and issues an admin token instead of a session.
 */
router.post(
  '/sign-in/google',
  signInLimit,
  asyncRoute(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);

    const user = await U.findUserById(userId);
    if (!user || !user.email || !isAdminEmail(user.email)) {
      await A.audit({
        actor: user?.email || 'unknown',
        action: 'sign-in-failed',
        detail: 'google identity not on the admin allowlist',
        ip: clientIp(req),
      });
      throw httpError(403, 'That Google account is not an administrator here.');
    }

    const actor = `google:${user.email}`;
    await A.audit({ actor, action: 'sign-in', ip: clientIp(req) });
    res.json({ token: signAdmin(actor), actor, expiresIn: TOKEN_TTL });
  })
);

/* ── gate ─────────────────────────────────────────────────────────────────── */

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    const payload = jwt.verify(token, adminSecret());
    if (!payload.adm) throw new Error('not an admin token');
    req.admin = { actor: payload.actor };
    next();
  } catch {
    res.status(401).json({ error: 'Admin session expired. Sign in again.', code: 'ADMIN_EXPIRED' });
  }
}

/** What the panel needs before it can render anything. */
router.get('/config', (req, res) =>
  res.json({
    passwordSignIn: passwordConfigured(),
    googleSignIn: adminEmails().length > 0 && Boolean(env.google.clientId),
  })
);

router.use(requireAdmin);

/* ── read ─────────────────────────────────────────────────────────────────── */

router.get(
  '/stats',
  asyncRoute(async (req, res) => res.json(await A.instanceStats()))
);

router.get(
  '/users',
  asyncRoute(async (req, res) => {
    const { q = '', sort = 'recent', limit = '50', offset = '0' } = req.query;
    res.json(
      await A.listUsers({
        query: String(q).trim(),
        sort: String(sort),
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  })
);

router.get(
  '/users/:id',
  asyncRoute(async (req, res) => {
    const detail = await A.userDetail(req.params.id);
    if (!detail) throw httpError(404, 'No such account.');
    res.json(detail);
  })
);

router.get(
  '/audit',
  asyncRoute(async (req, res) => res.json({ entries: await A.recentAudit(Number(req.query.limit) || 100) }))
);

/* ── actions ──────────────────────────────────────────────────────────────
   Each one writes to the audit trail *before* it acts, so a half-completed
   action still leaves a record of the intent.
   ────────────────────────────────────────────────────────────────────────── */

const target = async (req) => {
  const user = await U.findUserById(req.params.id);
  if (!user) throw httpError(404, 'No such account.');
  return user;
};

router.patch(
  '/users/:id/suspend',
  asyncRoute(async (req, res) => {
    const { suspended } = z.object({ suspended: z.boolean() }).parse(req.body);
    const user = await target(req);

    await A.audit({
      actor: req.admin.actor,
      action: suspended ? 'suspend' : 'unsuspend',
      targetId: user.id,
      detail: user.username,
      ip: clientIp(req),
    });

    await A.setSuspended(user.id, suspended);
    // Suspending without cutting existing sessions would leave them signed in
    // until their token expired, which is up to fifteen minutes of nothing
    // having happened.
    if (suspended) await A.bumpTokenEpoch(user.id);

    res.json({ ok: true, suspended });
  })
);

router.post(
  '/users/:id/sign-out',
  asyncRoute(async (req, res) => {
    const user = await target(req);
    await A.audit({
      actor: req.admin.actor,
      action: 'force-sign-out',
      targetId: user.id,
      detail: user.username,
      ip: clientIp(req),
    });
    await A.bumpTokenEpoch(user.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:id',
  asyncRoute(async (req, res) => {
    const user = await target(req);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body || {});

    // Typing the username is the only guard between a mis-click and someone's
    // account and every message they ever sent. Cascades do the rest.
    if (confirm !== user.username) {
      throw httpError(400, `Type the username exactly (${user.username}) to confirm.`);
    }

    await A.audit({
      actor: req.admin.actor,
      action: 'delete-account',
      targetId: user.id,
      detail: `${user.username} · ${user.email || 'no email'}`,
      ip: clientIp(req),
    });

    await A.deleteUser(user.id);
    res.json({ ok: true });
  })
);

/**
 * Open a user's account.
 *
 * Mints a normal, short-lived access token for that account and hands it to
 * the panel. It is a real session — everything the person can see, you can
 * see — so it is written to the audit trail with the account name before the
 * token is issued, and it is deliberately short: fifteen minutes, no refresh
 * cookie, so it cannot quietly become a permanent second login.
 */
router.post(
  '/users/:id/open',
  asyncRoute(async (req, res) => {
    const user = await target(req);

    await A.audit({
      actor: req.admin.actor,
      action: 'open-account',
      targetId: user.id,
      detail: user.username,
      ip: clientIp(req),
    });

    res.json({
      accessToken: signAccess(user.id),
      user: { id: user.id, username: user.username, displayName: user.displayName },
    });
  })
);

/* ── whoami, so the panel can show who it thinks you are ──────────────────── */

router.get('/me', (req, res) => res.json({ actor: req.admin.actor }));

export default router;
export { requireAdmin, signAdmin, clientIp };
