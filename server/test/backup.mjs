/**
 * Backups to Google Drive.
 *
 * Google itself is played by a small server in this process — run.sh points
 * NOOK_GOOGLE_BASE at it — so the whole round trip runs offline: consent,
 * callback, sealed token, upload, pruning, download, a revoked grant, and
 * disconnecting. Only the consent URL goes to the real accounts.google.com,
 * and nothing ever follows it.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';
import { suite, api, register, BASE } from './helpers.mjs';
import { encryptToken, decryptToken, resetTokenKey } from '../src/services/driveTokens.js';

const t = suite('backup: drive link, upload, restore');

const ORIGIN = BASE.replace(/\/api$/, '');
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const MAGIC = Buffer.from('NOOKBAK1');

/* ── a stand-in for Google ─────────────────────────────────────────────── */

const google = { files: [], revoked: new Set(), refreshCalls: 0, clock: Date.now() };
const REFRESH = 'rt-very-secret-refresh-token';

const readBody = (req) =>
  new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', () => resolve(Buffer.concat(parts)));
    req.on('aborted', () => resolve(Buffer.concat(parts)));
  });

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const body = await readBody(req);
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');

  if (url.pathname === '/token') {
    const form = new URLSearchParams(body.toString());
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') === 'good')
        return json(res, 200, { access_token: 'at-first', expires_in: 3600, refresh_token: REFRESH, scope: SCOPE });
      if (form.get('code') === 'noscope')
        return json(res, 200, { access_token: 'at-x', expires_in: 3600, refresh_token: 'rt-x', scope: 'openid' });
      return json(res, 400, { error: 'invalid_grant' });
    }
    google.refreshCalls += 1;
    if (google.revoked.has(form.get('refresh_token'))) return json(res, 400, { error: 'invalid_grant' });
    return json(res, 200, { access_token: `at-${google.refreshCalls}`, expires_in: 3600 });
  }

  if (url.pathname === '/revoke') {
    google.revoked.add(new URLSearchParams(body.toString()).get('token'));
    return json(res, 200, {});
  }

  // Everything below is Drive, which wants a live access token. A revoked
  // grant makes every access token dead too, which is what real Google does.
  if (!bearer || google.revoked.has(REFRESH)) return json(res, 401, { error: { code: 401 } });

  if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
    // Google makes nothing of an upload that never finished; neither do we.
    if (!req.complete) return res.destroy();
    const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] || '')?.[1];
    const text = body.toString('latin1');
    const sections = text.split(`--${boundary}`);
    const meta = JSON.parse(sections[1].split('\r\n\r\n')[1].trim());
    const raw = sections[2].slice(sections[2].indexOf('\r\n\r\n') + 4, -2);
    google.clock += 1000;
    const file = {
      id: `file${crypto.randomBytes(6).toString('hex')}`,
      name: meta.name,
      parents: meta.parents,
      content: Buffer.from(raw, 'latin1'),
      createdTime: new Date(google.clock).toISOString(),
    };
    google.files.push(file);
    return json(res, 200, { id: file.id, name: file.name, size: String(file.content.length), createdTime: file.createdTime });
  }

  if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
    const files = [...google.files]
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
      .map((f) => ({ id: f.id, name: f.name, size: String(f.content.length), createdTime: f.createdTime }));
    return json(res, 200, { files });
  }

  const one = /^\/drive\/v3\/files\/([\w-]+)$/.exec(url.pathname);
  if (one) {
    const file = google.files.find((f) => f.id === one[1]);
    if (!file) return json(res, 404, { error: { code: 404 } });
    if (req.method === 'DELETE') {
      google.files = google.files.filter((f) => f !== file);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': file.content.length });
    return res.end(file.content);
  }

  json(res, 404, { error: 'mock has no such route' });
});

const mockPort = Number(new URL(process.env.NOOK_GOOGLE_BASE || 'http://127.0.0.1:4112').port);
await new Promise((r) => mock.listen(mockPort, '127.0.0.1', r));

/* ── helpers ──────────────────────────────────────────────────────────── */

const hop = async (path, token) => {
  const r = await fetch(ORIGIN + path, {
    redirect: 'manual',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  // Drain the unread redirect body. Left dangling, its socket is still closing
  // when the suite exits, and Node on Windows can abort on that (libuv assert).
  await r.body?.cancel();
  return { status: r.status, location: r.headers.get('location') || '' };
};

const upload = async (token, bytes, name) => {
  const r = await fetch(`${BASE}/backup/drive/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      ...(name ? { 'x-backup-name': name } : {}),
    },
    body: bytes,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const backupBytes = (n) => Buffer.concat([MAGIC, crypto.randomBytes(200 + n)]);

/** A raw request, so the declared length can be a lie the server must catch. */
const rawPost = (path, token, headers, chunks, { finish = true } = {}) =>
  new Promise((resolve) => {
    const u = new URL(BASE + path);
    let done = false;
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers } },
      async (res) => {
        const text = (await readBody(res)).toString();
        done = true;
        resolve({ status: res.statusCode, text });
        if (!finish) req.destroy();
      }
    );
    req.on('error', (err) => !done && resolve({ status: 0, text: err.message }));
    (async () => {
      for (const c of chunks) {
        if (done) return;
        if (!req.write(c)) await new Promise((r) => req.once('drain', r));
      }
      // A lying Content-Length is never finished — the point is that the
      // server answers without waiting for bytes that are not coming.
      if (finish) req.end();
    })().catch(() => {});
  });

/** Sign a state the way the server does, for the expiry case. */
const signState = (payload) => {
  const key = Buffer.from(
    crypto.hkdfSync('sha256', process.env.JWT_ACCESS_SECRET, 'nook', 'drive-connect-state', 32)
  );
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', key).update(p).digest('base64url')}`;
};

const me = await register('bak');
const other = await register('bako');

/* ── connect ──────────────────────────────────────────────────────────── */

let r = await hop('/api/backup/drive/connect');
t.ok('connect needs a session', r.status === 401, `${r.status}`);

r = await hop('/api/backup/drive/connect', me.token);
t.ok('connect redirects to Google', r.status === 302 && r.location.startsWith('https://accounts.google.com/'), r.location.slice(0, 80));
const consent = new URL(r.location);
t.ok('asking only for the app folder', consent.searchParams.get('scope') === SCOPE, consent.searchParams.get('scope'));
t.ok('offline, with consent, so a refresh token comes back',
  consent.searchParams.get('access_type') === 'offline' && consent.searchParams.get('prompt') === 'consent');
t.ok('with a signed state', (consent.searchParams.get('state') || '').includes('.'));
t.ok('returning to the backup callback', (consent.searchParams.get('redirect_uri') || '').endsWith('/api/backup/drive/callback'));

const jsonConnect = await api('/backup/drive/connect?json=1', { token: me.token });
t.ok('the app can ask for the URL as data', jsonConnect.json.url?.startsWith('https://accounts.google.com/'), JSON.stringify(jsonConnect.json).slice(0, 80));

/* ── callback refusals ────────────────────────────────────────────────── */

r = await hop('/api/backup/drive/callback?code=good&state=nonsense');
t.ok('a bad state is refused', r.location.includes('drive_error=bad_state'), r.location);
t.ok('and never sent to the app scheme', !r.location.startsWith('nook://'), r.location);

const goodState = consent.searchParams.get('state');
const forged = goodState.split('.')[0] + '.' + 'x'.repeat(43);
r = await hop(`/api/backup/drive/callback?code=good&state=${encodeURIComponent(forged)}`);
t.ok('a forged signature is refused', r.location.includes('drive_error=bad_state'), r.location);

const stale = signState({ u: me.id, m: 0, t: Date.now() - 11 * 60_000, n: 'x' });
r = await hop(`/api/backup/drive/callback?code=good&state=${encodeURIComponent(stale)}`);
t.ok('an expired state is refused', r.location.includes('drive_error=bad_state'), r.location);

const fresh = signState({ u: me.id, m: 0, t: Date.now(), n: 'y' });

r = await hop(`/api/backup/drive/callback?error=access_denied&state=${encodeURIComponent(fresh)}`);
t.ok('cancelling at Google comes home with the reason', r.location.includes('drive_error=access_denied'), r.location);

/* ── not connected ────────────────────────────────────────────────────── */

let s = await api('/backup/drive/status', { token: me.token });
t.ok('status says not connected', s.json.connected === false && s.json.available === true, JSON.stringify(s.json));

let u = await upload(me.token, backupBytes(1));
t.ok('upload refuses when not connected', u.status === 409 && u.json.code === 'DRIVE_NOT_CONNECTED', `${u.status} ${JSON.stringify(u.json)}`);
let l = await api('/backup/drive/list', { token: me.token });
t.ok('list refuses when not connected', l.status === 409, `${l.status}`);
let d = await api('/backup/drive/fileabcdefgh', { token: me.token });
t.ok('download refuses when not connected', d.status === 409, `${d.status}`);
r = await fetch(`${BASE}/backup/drive/upload`, { method: 'POST', body: backupBytes(1) });
t.ok('upload needs a session', r.status === 401, `${r.status}`);

const big = await rawPost(
  '/backup/drive/upload',
  me.token,
  { 'content-type': 'application/octet-stream', 'content-length': String(60 * 1024 * 1024) },
  [MAGIC],
  { finish: false }
);
t.ok('a declared size over 50 MB is refused up front', big.status === 413, `${big.status} ${big.text.slice(0, 80)}`);

/* ── connecting ───────────────────────────────────────────────────────── */

r = await hop(`/api/backup/drive/callback?code=noscope&state=${encodeURIComponent(signState({ u: me.id, m: 0, t: Date.now(), n: 'z' }))}`);
t.ok('a grant without the app folder scope is refused', r.location.includes('drive_error=scope_denied'), r.location);

r = await hop(`/api/backup/drive/callback?code=good&state=${encodeURIComponent(goodState)}`);
t.ok('a good callback returns to the website', /\/\?drive=connected$/.test(r.location) && r.location.startsWith('http'), r.location);

const nativeUrl = new URL((await hop('/api/backup/drive/connect?native=1', me.token)).location);
r = await hop(`/api/backup/drive/callback?code=good&state=${encodeURIComponent(nativeUrl.searchParams.get('state'))}`);
t.ok('from the app it returns to the app', r.location === 'nook://backup?drive=connected', r.location);

s = await api('/backup/drive/status', { token: me.token });
t.ok('status now says connected', s.json.connected === true && Boolean(s.json.connectedAt), JSON.stringify(s.json));
s = await api('/backup/drive/status', { token: other.token });
t.ok('and only for that account', s.json.connected === false, JSON.stringify(s.json));

// The stored token must be ciphertext, bound to its owner.
const db = createClient({ url: process.env.TURSO_DATABASE_URL });
const row = (await db.execute({ sql: 'SELECT * FROM drive_links WHERE user_id = ?', args: [me.id] })).rows[0];
t.ok('the refresh token is not stored in the clear', row && !String(row.refresh_token_enc).includes(REFRESH), String(row?.refresh_token_enc).slice(0, 30));
t.ok('it opens with the server key for its owner', decryptToken(row.refresh_token_enc, me.id) === REFRESH);
t.ok('and not for anyone else', decryptToken(row.refresh_token_enc, other.id) === null);

/* ── upload, prune, list, download ────────────────────────────────────── */

u = await upload(me.token, Buffer.from('this is not a backup, just some bytes'));
t.ok('a file without the backup magic is refused', u.status === 400, `${u.status} ${JSON.stringify(u.json)}`);

const sent = [];
for (let i = 0; i < 7; i++) {
  const bytes = backupBytes(i);
  sent.push(bytes);
  u = await upload(me.token, bytes, `nook-backup-2026-09-${String(10 + i).padStart(2, '0')}.nookbak`);
  if (u.status !== 201) break;
}
t.ok('backups upload', u.status === 201 && Boolean(u.json.file?.id), `${u.status} ${JSON.stringify(u.json)}`);
t.ok('into the hidden app folder', google.files.every((f) => f.parents?.[0] === 'appDataFolder'));
t.ok('under the name the app chose', u.json.file?.name === 'nook-backup-2026-09-16.nookbak', u.json.file?.name);

l = await api('/backup/drive/list', { token: me.token });
t.ok('only the newest five are kept', l.json.files?.length === 5, `${l.json.files?.length}`);
t.ok('newest first', l.json.files?.[0]?.id === u.json.file?.id);

const got = await fetch(`${BASE}/backup/drive/${l.json.files[0].id}`, { headers: { authorization: `Bearer ${me.token}` } });
const gotBytes = Buffer.from(await got.arrayBuffer());
t.ok('download returns the exact bytes', got.status === 200 && gotBytes.equals(sent[6]), `${got.status} ${gotBytes.length}/${sent[6].length}`);

d = await api(`/backup/drive/${l.json.files[0].id}`, { token: other.token });
t.ok("another account cannot reach this person's Drive", d.status === 409, `${d.status}`);

d = await api('/backup/drive/bad%20id!', { token: me.token });
t.ok('a malformed file id is refused', d.status === 400, `${d.status}`);

// Streamed with no length declared: the counter has to catch it on the way.
const chunk = Buffer.alloc(1024 * 1024, 7);
const chunks = [MAGIC, ...Array.from({ length: 51 }, () => chunk)];
const over = await rawPost('/backup/drive/upload', me.token, { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }, chunks);
t.ok('a stream that runs past 50 MB is refused', over.status === 413, `${over.status} ${over.text.slice(0, 80)}`);
l = await api('/backup/drive/list', { token: me.token });
t.ok('and nothing half-written is left behind as the newest', l.json.files?.[0]?.id === u.json.file?.id);

/* ── a grant revoked at Google ────────────────────────────────────────── */

google.revoked.add(REFRESH);
l = await api('/backup/drive/list', { token: me.token });
t.ok('a revoked grant says so', l.status === 409 && l.json.code === 'DRIVE_DISCONNECTED', `${l.status} ${JSON.stringify(l.json)}`);
s = await api('/backup/drive/status', { token: me.token });
t.ok('and the account is marked disconnected', s.json.connected === false, JSON.stringify(s.json));
google.revoked.clear();

/* ── disconnecting ────────────────────────────────────────────────────── */

const again = new URL((await hop('/api/backup/drive/connect', me.token)).location);
await hop(`/api/backup/drive/callback?code=good&state=${encodeURIComponent(again.searchParams.get('state'))}`);
s = await api('/backup/drive/status', { token: me.token });
t.ok('reconnecting works', s.json.connected === true);

r = await api('/backup/drive/link', { method: 'DELETE', token: me.token });
t.ok('disconnect succeeds', r.status === 200, `${r.status}`);
t.ok('and revokes the token at Google', google.revoked.has(REFRESH));
s = await api('/backup/drive/status', { token: me.token });
t.ok('leaving the account disconnected', s.json.connected === false);
const gone = (await db.execute({ sql: 'SELECT COUNT(*) AS n FROM drive_links WHERE user_id = ?', args: [me.id] })).rows[0];
t.ok('with no token row left behind', Number(gone.n) === 0);

/* ── the sealing helper on its own ────────────────────────────────────── */

const sealed = encryptToken('hello-token', 'user-1');
t.ok('sealing round-trips', decryptToken(sealed, 'user-1') === 'hello-token');
t.ok('two seals of one token differ (fresh IV)', encryptToken('hello-token', 'user-1') !== sealed);
const [v, iv, body] = sealed.split('.');
const flipped = Buffer.from(body, 'base64url');
flipped[0] ^= 1;
t.ok('a tampered seal does not open', decryptToken(`${v}.${iv}.${flipped.toString('base64url')}`, 'user-1') === null);
t.ok('garbage does not throw', decryptToken('not.a.token', 'user-1') === null && decryptToken(null, 'x') === null);

process.env.BACKUP_TOKEN_KEY = 'a-different-dedicated-key';
resetTokenKey();
t.ok('BACKUP_TOKEN_KEY is a different key from the fallback', decryptToken(sealed, 'user-1') === null);
t.ok('and round-trips under itself', decryptToken(encryptToken('abc', 'u'), 'u') === 'abc');
delete process.env.BACKUP_TOKEN_KEY;
resetTokenKey();

mock.close();
db.close();
// exitCode, not exit(): exiting mid-teardown of fetch's sockets trips a libuv
// assertion on Windows now and then, which reads as a failed suite.
process.exitCode = t.done() ? 1 : 0;
