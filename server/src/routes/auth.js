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
import { sendRecoveryCode, sendEmailVerification, sendWelcome, mailProvider } from '../services/mail.js';

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
    nookId: user.nookId || '',
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    about: user.about,
    accent: user.accent,
    privacy: user.privacy,
    settings: user.settings,
    quietHours: user.quietHours,
    passwordless: user.passwordless,
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

    /**
     * Welcome mail is a courtesy, not part of signing up. Brevo being down, a
     * rejected sender address or a typo'd domain must never turn a successful
     * account creation into an error the person cannot act on — their account
     * exists either way. So: fire it, don't await it, and swallow the failure
     * into the log where it belongs.
     */
    if (user.email) {
      sendWelcome({
        to: user.email,
        displayName: user.displayName,
        username: user.username,
        nookId: user.nookId,
      }).catch((err) => console.error(`  email     welcome failed for ${user.email}: ${err.message}`));
    }

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

    // Without this, someone who signed up through Google would be told their
    // password is wrong — and would keep trying passwords for an account that
    // has never had one.
    if (user.passwordless)
      throw httpError(401, 'This account signs in with Google. Use the Google button below.');

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

/* ── send yourself a test email ────────────────────────────────────────────
   Deliberately only to the address already on your own account. Accepting a
   recipient from the request body would turn this into an open relay: anyone
   with an account could make your server send mail to anybody, and your
   sending domain would wear the consequences.
   ────────────────────────────────────────────────────────────────────────── */

const testMailLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Five test emails an hour is plenty. Try again later.' },
});

router.post(
  '/test-email',
  requireAuth,
  testMailLimit,
  asyncRoute(async (req, res) => {
    if (!req.user.email) {
      throw httpError(400, 'Add an email address to your account first, in Settings.');
    }

    const provider = mailProvider();
    const result = await sendWelcome({
      to: req.user.email,
      displayName: req.user.displayName,
      username: req.user.username,
      nookId: req.user.nookId,
    });

    // Report what actually happened rather than a bare ok:true. "Sent" when
    // nothing left the building is exactly the kind of reassurance that costs
    // an hour of looking in the wrong place.
    res.json({
      to: req.user.email,
      provider,
      delivered: result.delivered,
      channel: result.channel,
      error: result.error || '',
      note:
        result.channel === 'console'
          ? 'No mail provider is configured, so this was printed to the server log instead of sent.'
          : result.delivered
            ? 'Handed to the provider. If it does not arrive, check their delivery log and your spam folder.'
            : 'The provider refused it. The error is above and in the server log.',
    });
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
