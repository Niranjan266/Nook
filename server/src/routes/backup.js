/**
 * Chat backups to Google Drive.
 *
 * ── What this server sees ──
 *
 * An encrypted blob and nothing else. The client builds the backup, compresses
 * it and seals it with a key derived from a password that never leaves the
 * device; this router only moves those bytes between the app and the person's
 * own Drive. It could not read a backup if it wanted to, which is the point —
 * the most valuable thing in one is secret-chat keys, and those must not pass
 * through a server in the clear on their way anywhere.
 *
 * ── Why the OAuth runs here, not in the browser ──
 *
 * The Android app is a web view, and Google refuses OAuth inside web views. So,
 * exactly like sign-in (routes/google.js), the consent screen opens in the
 * system browser, Google redirects back to this API, and the API sends the
 * person home — to the website, or to `nook://backup` in the app. Doing the
 * code exchange server-side is also what lets us hold a refresh token, which is
 * what makes "back up to Drive" one tap next month instead of another consent.
 *
 * ── The scope ──
 *
 * `drive.appdata` only: a hidden folder private to Nook inside the person's
 * Drive. Nook cannot see, list or touch any of their other files, and Google's
 * consent screen says so, which is a much easier thing to agree to.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import rateLimit from 'express-rate-limit';
import { env, isProd } from '../config/env.js';
import { requireAuth, asyncRoute } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import * as D from '../db/drive.js';
import { encryptToken, decryptToken } from '../services/driveTokens.js';

const router = Router();

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Test-only: the suite points this at a local stand-in for Google so the whole
 * round trip can run offline. Ignored in production, where an environment
 * variable redirecting tokens elsewhere would be a gift to anyone who can set one.
 */
const fake = !isProd && (process.env.NOOK_GOOGLE_BASE || '').replace(/\/+$/, '');
const TOKEN_URL = fake ? `${fake}/token` : 'https://oauth2.googleapis.com/token';
const REVOKE_URL = fake ? `${fake}/revoke` : 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = fake ? `${fake}/drive/v3` : 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = fake ? `${fake}/upload/drive/v3` : 'https://www.googleapis.com/upload/drive/v3';

/** Big enough for years of text, small enough that one upload cannot sink a free instance. */
const MAX_BYTES = 50 * 1024 * 1024;
/** Older backups are deleted past this many — Drive quota is the person's, not ours. */
const KEEP = 5;
const MAGIC = Buffer.from('NOOKBAK1');

const enabled = () => Boolean(env.google.clientId && env.google.clientSecret);
const redirectUri = () => `${env.publicUrl || `http://localhost:${env.port}`}/api/backup/drive/callback`;

const notConnected = () =>
  httpError(409, 'Google Drive is not connected.', { code: 'DRIVE_NOT_CONNECTED' });
const disconnected = () =>
  httpError(409, 'Google Drive access was withdrawn. Connect it again to keep backing up there.', {
    code: 'DRIVE_DISCONNECTED',
  });

/* ── state ────────────────────────────────────────────────────────────────
   Signed, not stored, and carrying the user id: the callback arrives from the
   browser with no Nook session attached, so the state is the only thing that
   says whose Drive this is. Its own key, so a sign-in state can never be
   replayed here as a backup one or the other way round.
   ────────────────────────────────────────────────────────────────────────── */

const STATE_TTL = 10 * 60_000;
const stateKey = () => Buffer.from(crypto.hkdfSync('sha256', env.accessSecret, 'nook', 'drive-connect-state', 32));

function makeState(userId, native) {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, m: native ? 1 : 0, t: Date.now(), n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!parsed.u || typeof parsed.t !== 'number' || Date.now() - parsed.t >= STATE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── access tokens ────────────────────────────────────────────────────────
   Held in memory for their hour. A restart costs one extra refresh, which is
   cheaper than a table of short-lived secrets.
   ────────────────────────────────────────────────────────────────────────── */

const access = new Map(); // userId -> { token, expiresAt }

async function forget(userId) {
  access.delete(userId);
  await D.deleteDriveLink(userId);
}

async function accessToken(userId) {
  const hit = access.get(userId);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

  const link = await D.findDriveLink(userId);
  if (!link) throw notConnected();

  // A token sealed under a key that has since changed. Nothing to salvage;
  // asking to connect again is the honest answer.
  const refresh = decryptToken(link.refreshTokenEnc, userId);
  if (!refresh) {
    await forget(userId);
    throw disconnected();
  }

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  }).catch(() => null);

  const data = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !data.access_token) {
    // Revoked from Google's side, expired after months unused, or the password
    // changed. The link is dead either way, so stop pretending it is connected.
    if (data.error === 'invalid_grant') {
      await forget(userId);
      throw disconnected();
    }
    throw httpError(502, 'Google Drive did not answer. Try again in a moment.');
  }

  access.set(userId, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/** A Drive call, retried once with a fresh token if the cached one was refused. */
async function drive(userId, url, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(userId);
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } }).catch(
      () => null
    );
    if (!r) throw httpError(502, 'Could not reach Google Drive.');
    if (r.status === 401 && attempt === 0) {
      access.delete(userId);
      continue;
    }
    return r;
  }
  throw httpError(502, 'Google Drive refused the request.');
}

async function listBackups(userId) {
  const q = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,size,createdTime)',
    orderBy: 'createdTime desc',
    pageSize: '50',
    q: "name contains 'nook-backup' and trashed = false",
  });
  const r = await drive(userId, `${DRIVE_API}/files?${q}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, 'Could not list your Drive backups.');
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size) || 0,
    createdTime: f.createdTime,
  }));
}

/* ── connect ──────────────────────────────────────────────────────────────── */

/**
 * Needs a session, which a plain link cannot carry — so `?json=1` returns the
 * consent URL for the app to open itself (in a Custom Tab on Android, or by
 * navigating on the web). Without it this is an ordinary redirect.
 */
router.get('/drive/connect', requireAuth, (req, res) => {
  if (!enabled()) throw httpError(503, 'Google Drive backups are not configured on this server.');

  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    state: makeState(req.user.id, req.query.native === '1'),
    // Offline + consent: the only combination that reliably returns a refresh
    // token, including for someone reconnecting after revoking the last one.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  }).toString();

  if (req.query.json === '1') return res.json({ url: url.toString() });
  res.redirect(url.toString());
});

/** Home, with the outcome. The app route mirrors sign-in's `nook://auth`. */
const bounce = (res, params, native) => {
  const query = new URLSearchParams(params).toString();
  if (native) return res.redirect(`nook://backup?${query}`);
  return res.redirect(`${env.appUrl}/?${query}`);
};

router.get(
  '/drive/callback',
  asyncRoute(async (req, res) => {
    const state = readState(req.query.state);
    // Without a valid state we cannot trust its destination either, so a
    // forged or stale one always lands on the website, never on a scheme.
    if (!state) return bounce(res, { drive_error: 'bad_state' }, false);

    const native = Boolean(state.m);
    if (!enabled()) return bounce(res, { drive_error: 'unconfigured' }, native);
    if (req.query.error) return bounce(res, { drive_error: String(req.query.error).slice(0, 60) }, native);
    if (!req.query.code) return bounce(res, { drive_error: 'no_code' }, native);

    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: env.google.clientId,
        client_secret: env.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    }).catch(() => null);

    const tokens = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || !tokens.refresh_token) {
      console.error(`  backup    drive token exchange failed: ${String(tokens.error || r?.status || 'network')}`);
      return bounce(res, { drive_error: 'exchange_failed' }, native);
    }

    // Google's consent screen lets people untick individual scopes. Storing a
    // token that cannot reach the app folder would only fail later, less clearly.
    if (tokens.scope && !String(tokens.scope).split(' ').includes(SCOPE)) {
      return bounce(res, { drive_error: 'scope_denied' }, native);
    }

    await D.saveDriveLink(state.u, encryptToken(tokens.refresh_token, state.u));
    if (tokens.access_token) {
      access.set(state.u, {
        token: tokens.access_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      });
    } else {
      access.delete(state.u);
    }
    return bounce(res, { drive: 'connected' }, native);
  })
);

/* ── status, list ─────────────────────────────────────────────────────────── */

router.get(
  '/drive/status',
  requireAuth,
  asyncRoute(async (req, res) => {
    const link = await D.findDriveLink(req.user.id);
    res.json({
      available: enabled(),
      connected: Boolean(link),
      connectedAt: link ? new Date(link.connectedAt).toISOString() : null,
    });
  })
);

router.get(
  '/drive/list',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ files: await listBackups(req.user.id) });
  })
);

/* ── upload ───────────────────────────────────────────────────────────────── */

const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of backups for one hour. Try again later.' },
});

const NAME = /^nook-backup-\d{4}-\d{2}-\d{2}(-\d{1,3})?\.nookbak$/;

/**
 * Answer at once, then drain what is already on its way (up to a point) rather
 * than slamming the socket: a reset mid-upload reaches the client as a bare
 * "network error", and the person would retry the same oversized file forever.
 */
function refuseTooBig(req, res) {
  if (!res.headersSent) {
    res.setHeader('Connection', 'close');
    res.status(413).json({ error: 'That backup is over 50 MB — too big for Drive through Nook.', code: 'TOO_BIG' });
  }
  if (req.readableEnded) return;
  let drained = 0;
  req.on('data', (chunk) => {
    drained += chunk.length;
    if (drained > MAX_BYTES) req.destroy();
  });
  req.resume();
}

router.post(
  '/drive/upload',
  requireAuth,
  uploadLimit,
  asyncRoute(async (req, res) => {
    // The cheap check first: a declared length over the cap is refused before
    // anything is read, and before Google is asked for anything.
    if (Number(req.headers['content-length'] || 0) > MAX_BYTES) return refuseTooBig(req, res);

    const token = await accessToken(req.user.id); // 409 when not connected
    const name = NAME.test(String(req.headers['x-backup-name'] || ''))
      ? String(req.headers['x-backup-name'])
      : `nook-backup-${new Date().toISOString().slice(0, 10)}.nookbak`;

    const boundary = `nook${crypto.randomBytes(12).toString('hex')}`;
    const meta = { name, parents: ['appDataFolder'], mimeType: 'application/octet-stream' };

    let seen = 0;
    let failure = null; // 'big' | 'magic'

    /**
     * Streamed straight through, never buffered whole: fifty megabytes held in
     * memory per request is how a small instance falls over. The body is
     * counted as it passes, and it has to start with the backup magic — Nook's
     * Drive link is for Nook backups, not a free general-purpose uploader.
     */
    async function* multipart() {
      yield Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
          `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
      );
      let head = Buffer.alloc(0);
      let checked = false;
      // destroyOnReturn off: bailing out mid-stream must leave the request
      // open, or there is no socket left to send the refusal down.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        seen += chunk.length;
        if (seen > MAX_BYTES) {
          failure = 'big';
          throw new Error('over the cap');
        }
        if (!checked) {
          head = Buffer.concat([head, chunk]);
          if (head.length < MAGIC.length) continue;
          if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
            failure = 'magic';
            throw new Error('not a backup');
          }
          checked = true;
          yield head;
          continue;
        }
        yield chunk;
      }
      if (!checked) {
        failure = 'magic';
        throw new Error('not a backup');
      }
      yield Buffer.from(`\r\n--${boundary}--\r\n`);
    }

    let r;
    try {
      r = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,createdTime`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
        body: Readable.toWeb(Readable.from(multipart())),
        duplex: 'half',
      });
    } catch {
      if (failure === 'big') return refuseTooBig(req, res);
      if (failure === 'magic') throw httpError(400, 'That is not a Nook backup file.');
      throw httpError(502, 'Could not reach Google Drive.');
    }

    const file = await r.json().catch(() => ({}));
    if (r.status === 401) {
      access.delete(req.user.id);
      throw httpError(502, 'Google Drive refused the upload. Try again.');
    }
    if (!r.ok || !file.id) {
      const quota = r.status === 403 && /quota|storage/i.test(JSON.stringify(file));
      throw httpError(502, quota ? 'Your Google Drive is full.' : 'Google Drive did not accept the backup.');
    }

    // Keep the newest few. A failure here costs some quota, not the backup
    // that just landed, so it is logged rather than reported.
    try {
      const all = await listBackups(req.user.id);
      for (const old of all.slice(KEEP)) {
        await drive(req.user.id, `${DRIVE_API}/files/${encodeURIComponent(old.id)}`, { method: 'DELETE' });
      }
    } catch (err) {
      console.error(`  backup    pruning old Drive backups failed: ${err.message}`);
    }

    res.status(201).json({
      file: { id: file.id, name: file.name || name, size: Number(file.size) || seen, createdTime: file.createdTime },
    });
  })
);

/* ── disconnect ───────────────────────────────────────────────────────────── */

router.delete(
  '/drive/link',
  requireAuth,
  asyncRoute(async (req, res) => {
    const link = await D.findDriveLink(req.user.id);
    if (link) {
      const refresh = decryptToken(link.refreshTokenEnc, req.user.id);
      // Revoked at Google too, so "disconnect" means Nook can no longer reach
      // the folder at all — not merely that we promise not to. Best effort: the
      // row goes regardless, and the person can revoke from their Google account.
      if (refresh) {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh }),
        }).catch(() => null);
      }
    }
    await forget(req.user.id);
    res.json({ ok: true });
  })
);

/* ── download ─────────────────────────────────────────────────────────────── */

router.get(
  '/drive/:fileId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.fileId);
    if (!/^[\w-]{8,200}$/.test(id)) throw httpError(400, 'That is not a Drive file id.');

    const r = await drive(req.user.id, `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
    if (r.status === 404) throw httpError(404, 'That backup is no longer in your Drive.');
    if (!r.ok || !r.body) throw httpError(502, 'Could not fetch the backup from Drive.');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const length = r.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    Readable.fromWeb(r.body).pipe(res);
  })
);

export default router;
export { MAX_BYTES };
