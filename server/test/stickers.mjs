/**
 * Stickers: the tray, and the message type.
 *
 * The tray is private — everything here is about one person never being able
 * to read, fill or empty another's. The message type is about what a sticker
 * is allowed to point at: it renders with no bubble and no caption around it,
 * so a sticker linking anywhere but our own uploads is a picture nobody can
 * tell the origin of, and a `javascript:` one is a script in a tap.
 */
import { suite, api, register, befriend, directChat, BASE } from './helpers.mjs';

const t = suite('stickers');

const a = await register('stka');
const b = await register('stkb');
await befriend(a, b);
const cid = await directChat(a, b);

// A 1×1 transparent PNG — the smallest thing the sticker upload accepts.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

async function upload(token, bytes, { kind = 'sticker', type = 'image/png', name = 'sticker.png' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  form.append('kind', kind);
  const res = await fetch(BASE + '/media', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const keep = (user, media) =>
  api('/stickers', {
    method: 'POST',
    token: user.token,
    body: { url: media.url, publicId: media.publicId, width: 512, height: 512 },
  });

const tray = async (user) => (await api('/stickers', { token: user.token })).json.stickers || [];

/* ── the upload ────────────────────────────────────────────────────────── */

let up = await upload(a.token, png);
t.ok('a PNG sticker uploads', up.status === 201 && Boolean(up.json.media?.publicId), `${up.status} ${JSON.stringify(up.json).slice(0, 160)}`);
t.ok('into the sticker folder', String(up.json.media?.publicId).startsWith('nook/stickers/'), up.json.media?.publicId);
// A JPEG thumbnail would fill the transparent die-cut edge with black.
t.ok('served as itself, with no JPEG thumbnail', up.json.media?.thumbUrl === up.json.media?.url, up.json.media?.thumbUrl);
const first = up.json.media;

let r = await upload(a.token, jpeg, { type: 'image/jpeg', name: 'x.jpg' });
t.ok('a JPEG is refused as a sticker', r.status === 415, `${r.status}`);

r = await upload(a.token, jpeg, { type: 'image/png', name: 'x.png' });
t.ok('and so is a JPEG claiming to be a PNG', r.status === 415, `${r.status}`);

const huge = Buffer.concat([png, Buffer.alloc(500 * 1024)]);
r = await upload(a.token, huge);
t.ok('an oversized sticker is refused', r.status === 413, `${r.status}`);

/* ── the tray: create, list, own only ──────────────────────────────────── */

r = await keep(a, first);
t.ok('it can be kept in the tray', r.status === 201 && Boolean(r.json.sticker?.id), `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
const stickerA = r.json.sticker;

r = await keep(a, first);
t.ok('keeping the same upload twice is one sticker', r.status === 200 && r.json.sticker?.id === stickerA.id, `${r.status}`);

let mine = await tray(a);
t.ok('it is listed for its owner', mine.length === 1 && mine[0].id === stickerA.id, JSON.stringify(mine).slice(0, 120));
t.ok('and nobody else', (await tray(b)).length === 0);

r = await keep(b, first);
t.ok("someone else cannot put your upload in their tray", r.status === 403, `${r.status}`);

const photo = (await upload(a.token, jpeg, { kind: 'message', type: 'image/jpeg', name: 'p.jpg' })).json.media;
r = await keep(a, photo);
t.ok('an ordinary photo upload cannot be kept as a sticker', r.status === 400, `${r.status}`);

r = await api('/stickers', {
  method: 'POST',
  token: a.token,
  body: { url: 'https://evil.example/x.png', publicId: first.publicId },
});
t.ok('nor can a sticker whose link is not its upload', r.status === 400, `${r.status}`);

r = await api(`/stickers/${stickerA.id}`, { method: 'DELETE', token: b.token });
t.ok("someone else cannot delete your sticker", r.status === 404, `${r.status}`);
t.ok('and it is still there', (await tray(a)).length === 1);

r = await api(`/stickers/${stickerA.id}/use`, { method: 'POST', token: b.token });
t.ok("nor reorder your tray", r.status === 404, `${r.status}`);

/* ── recently used first ───────────────────────────────────────────────── */

const second = (await upload(a.token, png)).json.media;
const stickerB = (await keep(a, second)).json.sticker;
mine = await tray(a);
t.ok('a new sticker goes to the front', mine[0]?.id === stickerB.id, mine.map((s) => s.id).join(','));

await api(`/stickers/${stickerA.id}/use`, { method: 'POST', token: a.token });
mine = await tray(a);
t.ok('and using an older one brings it back to the front', mine[0]?.id === stickerA.id, mine.map((s) => s.id).join(','));

/* ── sending ───────────────────────────────────────────────────────────── */

const send = (body) => api(`/messages/${cid}`, { method: 'POST', token: a.token, body });
const stickerMedia = { url: stickerA.url, publicId: stickerA.publicId, mime: 'image/png', width: 512, height: 512 };

r = await send({ type: 'sticker', media: stickerMedia });
t.ok('a sticker message sends', r.status === 201 && r.json.message?.type === 'sticker', `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const sent = r.json.message;

const theirs = (await api(`/messages/${cid}`, { token: b.token })).json.messages.find((m) => m.id === sent?.id);
t.ok('and arrives as a sticker', theirs?.type === 'sticker' && theirs?.media?.url === stickerA.url, JSON.stringify(theirs).slice(0, 160));

// Unsending one sticker message must not delete the file every other copy uses.
r = await api(`/messages/${sent.id}?scope=everyone`, { method: 'DELETE', token: a.token });
const stillThere = await fetch(BASE.replace(/\/api$/, '') + stickerA.url.replace(/^https?:\/\/[^/]+/, ''));
t.ok('unsending a sticker leaves the shared file in place', stillThere.status === 200, `${r.status} ${stillThere.status}`);

r = await send({ type: 'sticker', media: { url: 'javascript:alert(1)' } });
t.ok('a javascript: sticker is refused', r.status === 400, `${r.status}`);

r = await send({ type: 'sticker', media: { url: 'https://evil.example/hotlink.png' } });
t.ok('a sticker hotlinked from elsewhere is refused', r.status === 400, `${r.status}`);

r = await send({ type: 'sticker', media: { url: '/uploads/../../etc/passwd' } });
t.ok('a sticker path that climbs out of uploads is refused', r.status === 400, `${r.status}`);

r = await send({ type: 'sticker' });
t.ok('a sticker with no picture is refused', r.status === 400, `${r.status}`);

r = await send({ type: 'sticker', media: stickerMedia, body: 'caption' });
t.ok('a sticker with a caption is refused', r.status === 400, `${r.status}`);

r = await send({ type: 'sticker', media: stickerMedia, viewOnce: true });
t.ok('a view-once sticker is refused', r.status === 400, `${r.status}`);

/* ── deleting keeps what was already sent ──────────────────────────────── */

r = await api(`/stickers/${stickerA.id}`, { method: 'DELETE', token: a.token });
t.ok('you can delete your own sticker', r.status === 200, `${r.status}`);
t.ok('and it leaves the tray', !(await tray(a)).some((s) => s.id === stickerA.id));

const file = await fetch(BASE.replace(/\/api$/, '') + stickerA.url.replace(/^https?:\/\/[^/]+/, ''));
t.ok('but the sticker already sent still loads', file.status === 200, `${file.status}`);

/* ── the cap ───────────────────────────────────────────────────────────── */

const c = await register('stkc');
let filled = 0;
for (let batch = 0; batch < 12; batch += 1) {
  const results = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const media = (await upload(c.token, png)).json.media;
      return (await keep(c, media)).status === 201;
    })
  );
  filled += results.filter(Boolean).length;
}
t.ok('a tray holds 120 stickers', filled === 120, `${filled}`);

const extra = (await upload(c.token, png)).json.media;
r = await keep(c, extra);
t.ok('the 121st is refused', r.status === 409 && r.json.code === 'STICKER_CAP', `${r.status} ${JSON.stringify(r.json)}`);

const one = (await tray(c))[0];
await api(`/stickers/${one.id}`, { method: 'DELETE', token: c.token });
r = await keep(c, extra);
t.ok('and deleting one makes room', r.status === 201, `${r.status}`);

process.exit(t.done() ? 1 : 0);
