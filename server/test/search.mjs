/**
 * Message search with filters.
 *
 * Every filter is a new way to ask for rows, and every new way to ask is a new
 * way to be handed something you should not see. So most of this suite is
 * about what must NOT come back — locked chats, other people's chats, things
 * you deleted, snaps, expired messages — and only then about the filters
 * returning the right things.
 */
import { suite, api, register, befriend, directChat } from './helpers.mjs';
import { run } from '../src/db/index.js';

const t = suite('search');

const a = await register('srcha');
const b = await register('srchb');
const c = await register('srchc');
await befriend(a, b);
await befriend(a, c);
const cid = await directChat(a, b);
const group = (
  await api('/conversations/group', { method: 'POST', token: a.token, body: { name: 'search', memberIds: [b.id, c.id] } })
).json.conversation.id;

const send = async (token, conversationId, body) => {
  const r = await api(`/messages/${conversationId}`, { method: 'POST', token, body });
  if (!r.json.message) throw new Error(`send failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.message;
};
const text = (token, conversationId, body) => send(token, conversationId, { type: 'text', body });
const search = (token, params) => api(`/messages/search/all?${new URLSearchParams(params)}`, { token });
const ids = (r) => (r.json.results || []).map((m) => m.id);

/* ── fixtures ─────────────────────────────────────────────────────────── */

const photo = await send(a.token, cid, { type: 'image', body: 'harbour photo', media: { url: 'https://example.com/p.jpg', mime: 'image/jpeg' } });
const video = await send(a.token, cid, { type: 'video', media: { url: 'https://example.com/v.mp4', mime: 'video/mp4' } });
const voice = await send(b.token, cid, { type: 'voice', media: { url: 'https://example.com/n.webm', mime: 'audio/webm', duration: 3 } });
const file = await send(b.token, cid, { type: 'file', media: { url: 'https://example.com/f.pdf', name: 'harbour.pdf' } });
const link = await text(b.token, cid, 'the harbour map is at https://example.com/map');
const snap = await send(a.token, cid, { type: 'snap', body: 'harbour snap', media: { url: 'https://example.com/s.jpg' }, viewOnce: true, viewSeconds: 10 });
const onceImage = await send(a.token, cid, { type: 'image', body: 'harbour once', media: { url: 'https://example.com/o.jpg' }, viewOnce: true });

/* ── type filters ─────────────────────────────────────────────────────── */

let r = await search(a.token, { conversationId: cid, type: 'photos' });
t.ok('photos needs no text', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
t.ok('photos finds the photo', ids(r).includes(photo.id), JSON.stringify(ids(r)));
t.ok('photos finds only photos', (r.json.results || []).every((m) => m.type === 'image'), JSON.stringify(r.json.results?.map((m) => m.type)));
t.ok('a snap is never a photo', !ids(r).includes(snap.id));
t.ok('nor is a view-once image', !ids(r).includes(onceImage.id));

r = await search(a.token, { conversationId: cid, type: 'videos' });
t.ok('videos finds the video, and only it', ids(r).length === 1 && ids(r)[0] === video.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, type: 'voice' });
t.ok('voice finds the voice note', ids(r).length === 1 && ids(r)[0] === voice.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, type: 'files' });
t.ok('files finds the file', ids(r).length === 1 && ids(r)[0] === file.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, type: 'links' });
t.ok('links finds the message with a URL', ids(r).length === 1 && ids(r)[0] === link.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, q: 'harbour' });
t.ok('text search finds the captioned photo and the link', ids(r).includes(photo.id) && ids(r).includes(link.id), JSON.stringify(ids(r)));
t.ok('but never a snap, caption and all', !ids(r).includes(snap.id) && !ids(r).includes(onceImage.id), JSON.stringify(ids(r)));
t.ok('and no snap media anywhere in the response', !JSON.stringify(r.json).includes('s.jpg') && !JSON.stringify(r.json).includes('o.jpg'));

r = await search(a.token, { conversationId: cid, q: 'harbour', type: 'links' });
t.ok('text and type combine', ids(r).length === 1 && ids(r)[0] === link.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, type: 'bogus' });
t.ok('an unknown type is refused', r.status === 400, String(r.status));

r = await search(a.token, { conversationId: cid });
t.ok('no text and no filter returns nothing rather than everything', r.status === 200 && ids(r).length === 0, JSON.stringify(ids(r)));

/* ── sender and date ──────────────────────────────────────────────────── */

const fromA = await text(a.token, group, 'lantern from a');
const fromB = await text(b.token, group, 'lantern from b');
const fromC = await text(c.token, group, 'lantern from c');

r = await search(a.token, { conversationId: group, q: 'lantern', from: b.id });
t.ok('from narrows to one sender', ids(r).length === 1 && ids(r)[0] === fromB.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: group, from: c.id });
t.ok('from works with no text at all', ids(r).length === 1 && ids(r)[0] === fromC.id, JSON.stringify(ids(r)));

// Pin the three to known days so the range is not a race against the clock.
const day = 24 * 60 * 60 * 1000;
const base = Date.now() - 30 * day;
await run('UPDATE messages SET created_at = ? WHERE id = ?', [base, fromA.id]);
await run('UPDATE messages SET created_at = ? WHERE id = ?', [base + 10 * day, fromB.id]);
await run('UPDATE messages SET created_at = ? WHERE id = ?', [base + 20 * day, fromC.id]);

r = await search(a.token, { conversationId: group, q: 'lantern', after: String(base + 5 * day), before: String(base + 15 * day) });
t.ok('a date range keeps only what falls inside it', ids(r).length === 1 && ids(r)[0] === fromB.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: group, q: 'lantern', before: new Date(base + 5 * day).toISOString() });
t.ok('before takes an ISO date too', ids(r).length === 1 && ids(r)[0] === fromA.id, JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: group, q: 'lantern' });
t.ok('results come newest first', JSON.stringify(ids(r)) === JSON.stringify([fromC.id, fromB.id, fromA.id]), JSON.stringify(ids(r)));

/* ── membership ───────────────────────────────────────────────────────── */

const stranger = await register('srchx');
r = await search(stranger.token, { conversationId: cid, q: 'harbour' });
t.ok('a stranger cannot aim search at your chat', r.status === 404 && !JSON.stringify(r.json).includes('harbour'), `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

r = await search(stranger.token, { type: 'photos' });
t.ok('nor find your photos by searching everywhere', !ids(r).includes(photo.id), JSON.stringify(ids(r)));

r = await search(c.token, { q: 'harbour' });
t.ok('a friend outside the chat sees none of it', ids(r).length === 0, JSON.stringify(ids(r)));

/* ── deleted for me, deleted for everyone, expired ────────────────────── */

const gone = await text(a.token, cid, 'quartz for nobody');
const unsent = await text(a.token, cid, 'quartz unsent');
const kept = await text(a.token, cid, 'quartz kept');
const expired = await text(a.token, cid, 'quartz expired');
await api(`/messages/${gone.id}?scope=me`, { method: 'DELETE', token: b.token });
await api(`/messages/${unsent.id}?scope=everyone`, { method: 'DELETE', token: a.token });
// Past its timer but not yet swept: the sweep runs on a schedule, and search
// must not show a message in the gap before it does.
await run('UPDATE messages SET expires_at = ? WHERE id = ?', [Date.now() - 1000, expired.id]);

r = await search(b.token, { conversationId: cid, q: 'quartz' });
t.ok('deleted-for-me is gone from your search', !ids(r).includes(gone.id), JSON.stringify(ids(r)));
t.ok('unsent is gone from everyone’s search', !ids(r).includes(unsent.id), JSON.stringify(ids(r)));
t.ok('expired is gone before the sweep reaches it', !ids(r).includes(expired.id), JSON.stringify(ids(r)));
t.ok('the rest is still found', ids(r).includes(kept.id), JSON.stringify(ids(r)));

r = await search(a.token, { conversationId: cid, q: 'quartz' });
t.ok('deleting for yourself leaves it for the other person', ids(r).includes(gone.id), JSON.stringify(ids(r)));

/* ── pagination ───────────────────────────────────────────────────────── */

const paged = [];
for (let i = 0; i < 5; i++) paged.push((await text(a.token, cid, `pebble number ${i}`)).id);
// Two share a millisecond, so the id tiebreak is what keeps the pages apart.
await run('UPDATE messages SET created_at = (SELECT created_at FROM messages WHERE id = ?) WHERE id = ?', [paged[2], paged[3]]);

const seen = [];
let cursor = '';
let pages = 0;
do {
  r = await search(a.token, { conversationId: cid, q: 'pebble', limit: '2', ...(cursor ? { cursor } : {}) });
  seen.push(...ids(r));
  cursor = r.json.nextCursor || '';
  pages += 1;
} while (cursor && pages < 10);
t.ok('pages of two walk all five', seen.length === 5 && new Set(seen).size === 5, JSON.stringify(seen));
t.ok('in three pages', pages === 3, String(pages));
t.ok('with every one found', paged.every((id) => seen.includes(id)));

r = await search(a.token, { conversationId: cid, q: 'pebble', limit: '500' });
t.ok('limit is capped', r.status === 400 || ids(r).length <= 60, String(r.status));

/* ── locked chats ─────────────────────────────────────────────────────── */

await text(a.token, cid, 'obsidian secret');
await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pin', code: '4821' } });

r = await search(a.token, { conversationId: cid, q: 'obsidian' });
t.ok('search aimed at a locked chat is refused', r.status === 403 && !JSON.stringify(r.json).includes('obsidian'), `${r.status}`);

r = await search(a.token, { conversationId: cid, type: 'photos' });
t.ok('a type filter does not get past the lock', r.status === 403 && !JSON.stringify(r.json).includes('p.jpg'), `${r.status}`);

r = await search(a.token, { q: 'obsidian' });
t.ok('searching everywhere skips the locked chat', ids(r).length === 0 && !JSON.stringify(r.json).includes('obsidian'), JSON.stringify(r.json).slice(0, 160));

r = await search(a.token, { type: 'photos' });
t.ok('and so do filters with no text', !ids(r).includes(photo.id), JSON.stringify(ids(r)));

r = await search(a.token, { from: b.id });
t.ok('and the sender filter', !ids(r).some((id) => [voice.id, file.id, link.id].includes(id)), JSON.stringify(ids(r)));

r = await search(b.token, { q: 'obsidian' });
t.ok('a lock is yours alone — the other person still finds it', ids(r).length === 1, JSON.stringify(ids(r)));

await api(`/conversations/${cid}/lock/verify`, { method: 'POST', token: a.token, body: { code: '4821' } });
r = await search(a.token, { conversationId: cid, q: 'obsidian' });
t.ok('it all comes back once unlocked', r.status === 200 && ids(r).length === 1, `${r.status} ${JSON.stringify(ids(r))}`);

process.exit(t.done() ? 1 : 0);
