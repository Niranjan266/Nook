/**
 * TURN credentials for calls.
 *
 * The route is tested over HTTP — that it demands a session, and that with
 * Cloudflare unset it serves plain STUN. The Cloudflare path is tested by
 * building the provider directly against a local mock of the API: the shared
 * test server boots once with one environment, and a provider per scenario
 * is the only way to see a fresh cache, a 404, and a 500 in one run. It is
 * still real fetch over a real socket, just not to Cloudflare.
 */
import http from 'node:http';
import { createTurnProvider } from '../src/services/turn.js';
import { suite, api, register } from './helpers.mjs';

const t = suite('turn / ice servers');

/* ── the route ─────────────────────────────────────────────────────────── */

const anon = await api('/calls/ice');
t.ok('/calls/ice refuses a stranger', anon.status === 401, anon.status + '');

const me = await register('turn');
const signedIn = await api('/calls/ice', { token: me.token });
const urls = (signedIn.json.iceServers || []).flatMap((s) => [].concat(s.urls));
t.ok('/calls/ice answers a signed-in user', signedIn.status === 200, signedIn.status + '');
t.ok(
  'without Cloudflare it serves STUN only',
  urls.length > 0 && urls.every((u) => u.startsWith('stun:')),
  urls.join(',')
);

/* ── the Cloudflare provider, against a mock ───────────────────────────── */

let mode = 'ok';
const hits = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };

    if (mode === 'fail') return send(500, { error: 'boom' });
    if (mode === 'legacy' && req.url.endsWith('/generate-ice-servers')) return send(404, {});
    if (req.url.endsWith('/generate')) {
      return send(201, {
        iceServers: { urls: ['turn:legacy.example:3478?transport=udp'], username: 'lu', credential: 'lc' },
      });
    }
    send(201, {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:5349?transport=tcp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'u',
          credential: 'c',
        },
      ],
    });
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${mock.address().port}/v1`;

const STUN = [{ urls: ['stun:stun.l.google.com:19302'] }];
const logs = [];
const make = (extra = {}) =>
  createTurnProvider({
    keyId: 'key123',
    apiToken: 'tok456',
    apiBase,
    fallback: () => STUN,
    log: (m) => logs.push(m),
    ...extra,
  });

// Happy path, and the cache.
mode = 'ok';
hits.length = 0;
let clock = 1_000_000;
const p = make({ now: () => clock });
const first = await p.iceServers();
const second = await p.iceServers();
const firstUrls = first.flatMap((s) => [].concat(s.urls));

t.ok('returns the mocked servers', firstUrls.includes('turns:turn.cloudflare.com:443?transport=tcp'), firstUrls.join(','));
t.ok('keeps the STUN fallback alongside them', firstUrls.includes('stun:stun.l.google.com:19302'));
t.ok('passes the credentials through', first.some((s) => s.username === 'u' && s.credential === 'c'));
t.ok('drops every :53 url', !firstUrls.some((u) => /:53(\?|$)/.test(u)), firstUrls.join(','));
t.ok('two calls hit Cloudflare once', hits.length === 1, hits.length + '');
t.ok('asks the new endpoint with the key id', hits[0]?.path === '/v1/turn/keys/key123/credentials/generate-ice-servers', hits[0]?.path);
t.ok('sends the bearer token', hits[0]?.auth === 'Bearer tok456', hits[0]?.auth);
t.ok('asks for a 24-hour ttl', hits[0]?.body?.ttl === 86400, JSON.stringify(hits[0]?.body));
t.ok('the second call is the same set', JSON.stringify(first) === JSON.stringify(second));

clock += 22 * 60 * 60 * 1000;
await p.iceServers();
t.ok('still cached 22 hours in', hits.length === 1, hits.length + '');
clock += 90 * 60 * 1000;
await p.iceServers();
t.ok('refreshed within the last hour before expiry', hits.length === 2, hits.length + '');

// Concurrent first requests share one fetch.
hits.length = 0;
const q = make();
await Promise.all([q.iceServers(), q.iceServers(), q.iceServers()]);
t.ok('concurrent requests mint once', hits.length === 1, hits.length + '');

// The older endpoint, when the new one 404s.
mode = 'legacy';
hits.length = 0;
const legacy = await make().iceServers();
t.ok('falls back to the older endpoint on 404', hits.length === 2 && hits[1].path.endsWith('/credentials/generate'), hits.map((h) => h.path).join(','));
t.ok(
  'reads its single-object response',
  legacy.some((s) => s.username === 'lu' && [].concat(s.urls).includes('turn:legacy.example:3478?transport=udp'))
);

// Failure: STUN, and one log line rather than one per call.
mode = 'fail';
logs.length = 0;
hits.length = 0;
let failClock = 5_000_000;
const f = make({ now: () => failClock });
const failed = await f.iceServers();
t.ok('a 500 falls back to STUN', JSON.stringify(failed) === JSON.stringify(STUN), JSON.stringify(failed));
await f.iceServers();
t.ok('does not re-ask Cloudflare straight away', hits.length === 1, hits.length + '');
failClock += 2 * 60 * 1000;
await f.iceServers();
t.ok('retries after a pause', hits.length === 2, hits.length + '');
t.ok('logs once, not on every call', logs.length === 1, logs.length + '');

// Unconfigured: never touches the network.
hits.length = 0;
const off = createTurnProvider({ keyId: '', apiToken: '', apiBase, fallback: () => STUN });
const offServers = await off.iceServers();
t.ok('unconfigured provider serves the fallback', JSON.stringify(offServers) === JSON.stringify(STUN));
t.ok('unconfigured provider makes no request', hits.length === 0, hits.length + '');

mock.close();
process.exit(t.done() ? 1 : 0);
