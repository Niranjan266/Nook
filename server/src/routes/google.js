/**
 * Sign in with Google.
 *
 * ── Why the server-side redirect flow, not Google's JavaScript button ──
 *
 * Google Identity Services renders its own button, and its appearance is
 * barely customisable. Nook's whole design premise is that it does not look
 * like everything else, so a stock Google button dropped into the front door
 * would be the one element that does. This flow keeps the button ours: it is
 * an ordinary link to `/start`, and every pixel is in our stylesheet.
 *
 * ── Why the handoff code ──
 *
 * Google redirects back to *this API*, not to the app — they are different
 * origins. Setting the session cookie here and hoping the browser keeps it
 * would depend on COOKIE_DOMAIN being configured and on the two hosts sharing
 * a parent domain, which is not true while the API is still on onrender.com.
 * So the callback mints a single-use code, redirects to the app with it, and
 * the app trades it for tokens over a normal same-origin-rules XHR. That works
 * whatever the cookie situation, and the code in the URL is worthless once
 * used — which is a good property for something that lands in browser history.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import * as U from '../db/users.js';
import { env } from '../config/env.js';
import { asyncRoute } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { signAccess, attachSession } from '../services/tokens.js';
import { sendWelcome } from '../services/mail.js';

const router = Router();

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const enabled = () => Boolean(env.google.clientId && env.google.clientSecret);
const redirectUri = () => `${env.publicUrl || `http://localhost:${env.port}`}/api/auth/google/callback`;

/* ── single-use handoff codes ──────────────────────────────────────────────
   In memory on purpose. These live for sixty seconds and are consumed once;
   persisting them would mean a table that is empty 99.99% of the time and a
   sweeper to keep it that way. The cost is that a redeploy landing inside
   somebody's sign-in makes them press the button again.
   ────────────────────────────────────────────────────────────────────────── */

const handoffs = new Map(); // code -> { userId, expiresAt }
const HANDOFF_TTL = 60_000;

function mintHandoff(userId) {
  const code = crypto.randomBytes(32).toString('base64url');
  handoffs.set(code, { userId, expiresAt: Date.now() + HANDOFF_TTL });
  return code;
}

function claimHandoff(code) {
  const entry = handoffs.get(code);
  if (!entry) return null;
  handoffs.delete(code); // single use — deleted whether or not it had expired
  if (Date.now() > entry.expiresAt) return null;
  return entry.userId;
}

// Cheap sweep so an abandoned sign-in cannot accumulate. Unref'd so it never
// holds the process open.
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of handoffs) if (now > entry.expiresAt) handoffs.delete(code);
}, 60_000).unref();

/* ── state ────────────────────────────────────────────────────────────────
   Signed rather than stored, so the flow survives a restart between the click
   and the callback. It carries nothing secret — just a nonce and a timestamp —
   and the signature is what stops someone forging a callback.
   ────────────────────────────────────────────────────────────────────────── */

const stateSecret = () => env.accessSecret;

function makeState() {
  const payload = Buffer.from(JSON.stringify({ n: crypto.randomBytes(8).toString('hex'), t: Date.now() })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function validState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return false;

  const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  // timingSafeEqual throws on length mismatch, which is itself a signal, so
  // compare lengths first.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;

  try {
    const { t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() - t < 10 * 60_000; // ten minutes to finish signing in
  } catch {
    return false;
  }
}

/* ── 1 · start ────────────────────────────────────────────────────────────── */

router.get('/start', (req, res) => {
  if (!enabled()) throw httpError(503, 'Google sign-in is not configured on this server.');

  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state: makeState(),
    // Nook needs the identity once, not ongoing access, so no refresh token is
    // requested. Less to store, less to leak.
    access_type: 'online',
    prompt: 'select_account',
  }).toString();

  res.redirect(url.toString());
});

/* ── 2 · callback ─────────────────────────────────────────────────────────── */

/** Send the browser back to the app, with a reason when it did not work. */
const bounce = (res, params) => res.redirect(`${env.appUrl}/?${new URLSearchParams(params).toString()}`);

router.get(
  '/callback',
  asyncRoute(async (req, res) => {
    if (!enabled()) return bounce(res, { google_error: 'unconfigured' });

    // The user pressed Cancel, or Google refused.
    if (req.query.error) return bounce(res, { google_error: String(req.query.error) });
    if (!validState(req.query.state)) return bounce(res, { google_error: 'bad_state' });
    if (!req.query.code) return bounce(res, { google_error: 'no_code' });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: env.google.clientId,
        client_secret: env.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.id_token) {
      console.error(`  google    token exchange failed: ${JSON.stringify(tokens).slice(0, 300)}`);
      return bounce(res, { google_error: 'exchange_failed' });
    }

    /**
     * The ID token came straight from Google's token endpoint over TLS, in
     * response to a code only we could redeem. That is the documented case
     * where signature verification is not required — the channel is the proof.
     * (It would be required if the token arrived from the browser instead.)
     * The claims are still checked below.
     */
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());

    if (claims.aud !== env.google.clientId) return bounce(res, { google_error: 'wrong_audience' });
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss))
      return bounce(res, { google_error: 'wrong_issuer' });
    if (!claims.sub) return bounce(res, { google_error: 'no_subject' });

    const user = await findOrCreate(claims);
    return bounce(res, { g: mintHandoff(user.id) });
  })
);

/**
 * Find the account this Google identity belongs to, or make one.
 *
 * The linking rule is the part that matters. Matching on email alone would be
 * a takeover: Nook emails are optional and unverified by default, so anyone
 * could type a stranger's address into their profile, wait for that person to
 * sign in with Google, and have them dropped into the attacker's account.
 *
 * So a link happens only when **both** sides have proven the address — Google
 * says `email_verified`, and the Nook account confirmed it through the code
 * flow. Anything less gets a fresh account, which is recoverable; a wrong link
 * is not.
 */
async function findOrCreate(claims) {
  const bySub = await U.findUserByGoogleSub(claims.sub);
  if (bySub) return bySub;

  const email = String(claims.email || '').toLowerCase();

  if (email && claims.email_verified === true) {
    const existing = await U.findUserByVerifiedEmail(email);
    if (existing) {
      await U.linkGoogle(existing.id, claims.sub);
      return U.findUserById(existing.id);
    }
  }

  const username = await U.uniqueUsernameFrom(email.split('@')[0] || claims.given_name || 'friend');

  /**
   * A password hash is required by the schema and this account has no
   * password. Storing a hash of random bytes means every password check fails
   * — which is correct — while keeping the column's shape honest. `passwordless`
   * is what the UI reads to say something useful instead of "wrong password".
   */
  const { hash } = await import('../services/password.js');
  const unusable = await hash(crypto.randomBytes(48).toString('base64'));

  const user = await U.createUser({
    username,
    displayName: (claims.name || claims.given_name || username).slice(0, 40),
    passwordHash: unusable,
    passwordless: true,
    email,
    emailVerified: claims.email_verified === true,
    googleSub: claims.sub,
    // Google's picture URLs are stable and hotlinkable; `=s96-c` asks for a
    // sensible size rather than whatever the default happens to be.
    avatarUrl: claims.picture ? String(claims.picture).replace(/=s\d+-c$/, '=s256-c') : '',
  });

  if (user.email) {
    sendWelcome({
      to: user.email,
      displayName: user.displayName,
      username: user.username,
      nookId: user.nookId,
    }).catch((err) => console.error(`  email     welcome failed for ${user.email}: ${err.message}`));
  }

  return user;
}

/* ── 3 · exchange ─────────────────────────────────────────────────────────── */

const exchangeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Give it ten minutes.' },
});

router.post(
  '/exchange',
  exchangeLimit,
  asyncRoute(async (req, res) => {
    const { code } = z.object({ code: z.string().min(10) }).parse(req.body);

    const userId = claimHandoff(code);
    if (!userId) throw httpError(401, 'That sign-in link has expired. Try again.');

    const user = await U.findUserById(userId);
    if (!user) throw httpError(401, 'Account no longer exists.');

    const session = attachSession(req, res, user.id);
    res.json({ user: await meShape(user), accessToken: signAccess(user.id), ...session });
  })
);

/** Same shape `/auth/me` returns, so the client stores can be reused as-is. */
async function meShape(user) {
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

/** So the front door only shows the button when it would actually work. */
router.get('/available', (req, res) => res.json({ available: enabled() }));

export default router;
