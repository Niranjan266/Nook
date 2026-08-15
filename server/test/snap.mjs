/** Sending and viewing a snap, over both paths. */
import { suite, api, register, befriend, directChat, BASE } from './helpers.mjs';

const t = suite('snap');

const a = await register('snapa');
const b = await register('snapb');
await befriend(a, b);
const cid = await directChat(a, b);

// REST path.
let r = await api(`/messages/${cid}`, {
  method: 'POST',
  token: a.token,
  body: { type: 'snap', media: { url: 'https://example.com/s.jpg', mime: 'image/jpeg' }, viewOnce: true, viewSeconds: 10 },
});
t.ok('a snap sends over REST', r.status === 201, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t.ok('and is marked view-once', r.json.message?.viewOnce?.enabled === true, JSON.stringify(r.json.message?.viewOnce));
t.ok('with the chosen duration', r.json.message?.viewOnce?.seconds === 10, JSON.stringify(r.json.message?.viewOnce?.seconds));

const snapId = r.json.message?.id;

// The recipient sees it unopened, then burns it.
const theirs = await api(`/messages/${cid}`, { token: b.token });
const seen = theirs.json.messages?.find((m) => m.id === snapId);
t.ok('the recipient receives it', Boolean(seen), JSON.stringify(theirs.json.messages?.length));
t.ok('and it still has its media before viewing', Boolean(seen?.media?.url), JSON.stringify(seen?.media));

r = await api(`/messages/${snapId}/view`, { method: 'POST', token: b.token });
t.ok('the recipient can open it', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);

const after = await api(`/messages/${cid}`, { token: b.token });
const burnt = after.json.messages?.find((m) => m.id === snapId);
t.ok('and it burns after viewing', burnt?.viewOnce?.burnt === true || burnt?.media === null, JSON.stringify(burnt?.viewOnce));

// A snap with no duration means "until they close it".
r = await api(`/messages/${cid}`, {
  method: 'POST',
  token: a.token,
  body: { type: 'snap', media: { url: 'https://example.com/t.jpg' }, viewOnce: true, viewSeconds: 0 },
});
t.ok('a no-timer snap sends', r.status === 201, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
t.ok('and reports zero seconds', r.json.message?.viewOnce?.seconds === 0, JSON.stringify(r.json.message?.viewOnce?.seconds));

// Over 60s must be refused rather than silently clamped.
r = await api(`/messages/${cid}`, {
  method: 'POST',
  token: a.token,
  body: { type: 'snap', media: { url: 'https://example.com/u.jpg' }, viewOnce: true, viewSeconds: 600 },
});
t.ok('an absurd duration is refused', r.status === 400, `${r.status}`);

// The media upload route a snap actually uses.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);
const form = new FormData();
form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'snap.jpg');
form.append('kind', 'message');
const up = await fetch(BASE + '/media', { method: 'POST', headers: { authorization: `Bearer ${a.token}` }, body: form });
const upJson = await up.json();
t.ok('the snap image uploads', up.status === 201 && Boolean(upJson.media?.url), `${up.status} ${JSON.stringify(upJson).slice(0, 160)}`);

r = await api(`/messages/${cid}`, {
  method: 'POST',
  token: a.token,
  body: { type: 'snap', media: upJson.media, viewOnce: true, viewSeconds: 5 },
});
t.ok('and a real uploaded snap sends', r.status === 201, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);

/* ── the path the app actually uses: the socket ──────────────────────────── */

/**
 * The REST route above is the fallback. Everything the app sends goes over the
 * socket, and the two take different code paths into `createMessage` — the
 * REST one validates with zod first, the socket one hands the payload straight
 * through. A snap that works over REST and not over the socket is exactly the
 * shape of bug that reaches a user, so it has to be checked separately.
 */
const { io } = await import('../../client/node_modules/socket.io-client/build/esm/index.js');

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE.replace(/\/api$/, ''), {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket never connected')), 8000);
  });

const sock = await connect(a.token).catch((e) => {
  t.ok('a socket can connect', false, e.message);
  return null;
});

if (sock) {
  t.ok('a socket can connect', true);

  const ack = await new Promise((done) =>
    sock.emit(
      'message:send',
      {
        clientId: 'test-snap-1',
        conversationId: cid,
        type: 'snap',
        body: '',
        media: { url: 'https://example.com/sock.jpg', mime: 'image/jpeg' },
        replyTo: null,
        viewOnce: true,
        viewSeconds: 3,
      },
      done
    )
  );

  t.ok('a snap sends over the socket', ack?.ok === true, JSON.stringify(ack).slice(0, 200));
  t.ok('it arrives as a snap', ack?.message?.type === 'snap', JSON.stringify(ack?.message?.type));
  t.ok('view-once is set', ack?.message?.viewOnce?.enabled === true, JSON.stringify(ack?.message?.viewOnce));
  // The bug: the client dropped viewSeconds before it left the browser, so the
  // timer the sender picked was silently replaced by the default.
  t.ok('the chosen timer survives the trip', ack?.message?.viewOnce?.seconds === 3,
       JSON.stringify(ack?.message?.viewOnce?.seconds));

  sock.close();
}

process.exit(t.done() ? 1 : 0);
