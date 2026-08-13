import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { hash as hashPassword, verify as verifyPassword } from '../services/password.js';
import * as U from '../db/users.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import {
  signAccess,
  verifyRefresh,
  clearRefreshCookie,
  attachSession,
  readRefreshToken,
} from '../services/tokens.js';
import { sendRecoveryCode, sendEmailVerification } from '../services/mail.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Give it ten minutes.' },
});

const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Usernames need at least 3 characters.')
  .max(20, 'Usernames max out at 20 characters.')
  .regex(/^[a-z0-9_.]+$/, 'Letters, numbers, dots and underscores only.');

const signupSchema = z.object({
  username: usernameRule,
  displayName: z.string().trim().min(1, 'What should people call you?').max(40),
  password: z.string().min(8, 'Passwords need at least 8 characters.').max(200),
  email: z.string().trim().email('That email looks off.').optional().or(z.literal('')),
});

async function me(user) {
  const [contacts, blocked, folders] = await Promise.all([
    U.contactIds(user.id),
    U.blockedIds(user.id),
    U.listFolders(user.id),
  ]);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    about: user.about,
    accent: user.accent,
    privacy: user.privacy,
    settings: user.settings,
    quietHours: user.quietHours,
    contacts,
    blocked,
    folders,
    createdAt: user.createdAt,
  };
}

const sixDigit = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/* ── availability ─────────────────────────────────────────────────────────── */

router.get(
  '/available/:username',
  asyncRoute(async (req, res) => {
    const parsed = usernameRule.safeParse(req.params.username);
    if (!parsed.success) return res.json({ available: false, reason: parsed.error.issues[0].message });
    const taken = await U.usernameTaken(parsed.data);
    res.json({ available: !taken, reason: taken ? 'Someone already has that one.' : '' });
  })
);

/* ── signup ───────────────────────────────────────────────────────────────── */

router.post(
  '/signup',
  limiter,
  asyncRoute(async (req, res) => {
    const { username, displayName, password, email } = signupSchema.parse(req.body);
    if (await U.usernameTaken(username)) throw httpError(409, 'Someone already has that username.');

    const user = await U.createUser({
      username,
      displayName,
      passwordHash: await hashPassword(password),
      email: email || '',
    });

    const session = attachSession(req, res, user.id);
    res.status(201).json({ user: await me(user), accessToken: signAccess(user.id), ...session });
  })
);

/* ── login ────────────────────────────────────────────────────────────────── */

router.post(
  '/login',
  limiter,
  asyncRoute(async (req, res) => {
    const { username, password } = z
      .object({ username: usernameRule, password: z.string().min(1, 'Password required.') })
      .parse(req.body);

    const user = await U.findUserByUsername(username);
    if (!user) throw httpError(401, 'No account with that username.');
    if (!(await verifyPassword(user.passwordHash, password)))
      throw httpError(401, 'That password does not match.');

    const session = attachSession(req, res, user.id);
    res.json({ user: await me(user), accessToken: signAccess(user.id), ...session });
  })
);

/* ── refresh / logout / me ────────────────────────────────────────────────── */

router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const token = readRefreshToken(req);
    if (!token) throw httpError(401, 'No session to refresh.');

    let payload;
    try {
      payload = verifyRefresh(token);
    } catch {
      clearRefreshCookie(res);
      throw httpError(401, 'Session expired. Sign in again.');
    }

    const user = await U.findUserById(payload.sub);
    if (!user) throw httpError(401, 'Account no longer exists.');

    const session = attachSession(req, res, user.id);
    res.json({ user: await me(user), accessToken: signAccess(user.id), ...session });
  })
);

router.post('/logout', (req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => res.json({ user: await me(req.user) }))
);

/* ── password change ──────────────────────────────────────────────────────── */

router.post(
  '/password',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { current, next } = z
      .object({ current: z.string().min(1), next: z.string().min(8, 'New password needs 8+ characters.') })
      .parse(req.body);

    if (!(await verifyPassword(req.user.passwordHash, current)))
      throw httpError(400, 'Current password is wrong.');

    await U.updateUser(req.user.id, { passwordHash: await hashPassword(next) });
    res.json({ ok: true });
  })
);

/* ── optional email + recovery ────────────────────────────────────────────── */

router.post(
  '/email',
  requireAuth,
  limiter,
  asyncRoute(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().email('That email looks off.') }).parse(req.body);
    const code = sixDigit();

    await U.updateUser(req.user.id, {
      email: email.toLowerCase(),
      emailVerified: false,
      recovery: { code, expiresAt: Date.now() + 15 * 60 * 1000 },
    });

    const result = await sendEmailVerification({
      to: email.toLowerCase(),
      code,
      displayName: req.user.displayName,
    });
    res.json({ ok: true, channel: result.channel });
  })
);

router.post(
  '/email/verify',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().length(6, 'Six digits, please.') }).parse(req.body);
    const user = await U.findUserById(req.user.id);

    if (!user.recovery?.code || user.recovery.code !== code) throw httpError(400, 'That code is not right.');
    if (!user.recovery.expiresAt || user.recovery.expiresAt < Date.now())
      throw httpError(400, 'That code has expired.');

    const updated = await U.updateUser(user.id, {
      emailVerified: true,
      recovery: { code: '', expiresAt: null },
    });
    res.json({ ok: true, user: await me(updated) });
  })
);

router.post(
  '/recover',
  limiter,
  asyncRoute(async (req, res) => {
    const { username } = z.object({ username: usernameRule }).parse(req.body);
    const user = await U.findUserByUsername(username);

    // Never leak whether an account or email exists.
    if (user?.email && user.emailVerified) {
      const code = sixDigit();
      await U.updateUser(user.id, { recovery: { code, expiresAt: Date.now() + 15 * 60 * 1000 } });
      await sendRecoveryCode({ to: user.email, code, displayName: user.displayName });
    }

    res.json({ ok: true, message: 'If that account has a confirmed email, a code is on its way.' });
  })
);

router.post(
  '/recover/reset',
  limiter,
  asyncRoute(async (req, res) => {
    const { username, code, password } = z
      .object({
        username: usernameRule,
        code: z.string().trim().length(6, 'Six digits, please.'),
        password: z.string().min(8, 'Passwords need at least 8 characters.'),
      })
      .parse(req.body);

    const user = await U.findUserByUsername(username);
    if (!user?.recovery?.code || user.recovery.code !== code) throw httpError(400, 'That code is not right.');
    if (!user.recovery.expiresAt || user.recovery.expiresAt < Date.now())
      throw httpError(400, 'That code has expired.');

    const updated = await U.updateUser(user.id, {
      passwordHash: await hashPassword(password),
      recovery: { code: '', expiresAt: null },
    });

    const session = attachSession(req, res, updated.id);
    res.json({ user: await me(updated), accessToken: signAccess(updated.id), ...session });
  })
);

export default router;
