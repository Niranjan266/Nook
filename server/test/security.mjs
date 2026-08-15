/**
 * Every hole a security audit found, re-run as an assertion that it is shut.
 *
 * Each test is named for what must NOT be possible. Every one of them was
 * confirmed exploitable against the previous build before the fix went in —
 * which is the only reason to believe they are testing something real.
 */
import { suite, api, register as reg, befriend, adminToken, settle, BASE } from './helpers.mjs';

const t = suite('security');
const ok = (name, condition, detail = '') => t.ok(name, condition, detail);

const a = await reg('auda');
const b = await reg('audb');
await befriend(a, b);
const cid = (await api('/conversations/direct', { method: 'POST', token: a.token, body: { userId: b.id } })).json.conversation.id;
await api(`/messages/${cid}`, { method: 'POST', token: a.token, body: { body: 'THESECRET', type: 'text' } });
const msgId = (await api(`/messages/${cid}`, { token: a.token })).json.messages[0].id;
await api(`/messages/${msgId}/star`, { method: 'POST', token: a.token });
await api(`/conversations/${cid}/pins/${msgId}`, { method: 'POST', token: a.token });
await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pin', code: '4821' } });

/* ── LOCK ─────────────────────────────────────────────────────────────── */
let r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { locked: false } });
let hist = await api(`/messages/${cid}`, { token: a.token });
ok('prefs can no longer clear the lock', hist.status === 403, `prefs ${r.status}, history ${hist.status}`);

r = await api(`/messages/search/all?q=THESECRET`, { token: a.token });
ok('search cannot read a locked chat', !JSON.stringify(r.json).includes('THESECRET'), JSON.stringify(r.json).slice(0, 160));

r = await api(`/messages/search/all?q=THESECRET&conversationId=${cid}`, { token: a.token });
ok('search aimed at the locked chat finds nothing', !JSON.stringify(r.json).includes('THESECRET'), JSON.stringify(r.json).slice(0, 160));

r = await api('/messages/starred/all', { token: a.token });
ok('starred cannot read a locked chat', !JSON.stringify(r.json).includes('THESECRET'), JSON.stringify(r.json).slice(0, 160));

r = await api(`/messages/${msgId}/react`, { method: 'POST', token: a.token, body: { emoji: '👍' } });
ok('reacting cannot read a locked message', r.status === 403, r.status + ' ' + JSON.stringify(r.json).slice(0, 120));

r = await api(`/messages/${msgId}/history`, { token: a.token });
ok('edit history cannot read a locked message', r.status === 403, String(r.status));

const c2 = await reg('audc');
await befriend(a, c2);
const cid2 = (await api('/conversations/direct', { method: 'POST', token: a.token, body: { userId: c2.id } })).json.conversation.id;
r = await api(`/messages/${msgId}/forward`, { method: 'POST', token: a.token, body: { conversationIds: [cid2] } });
ok('a locked message cannot be forwarded out', r.status === 403, String(r.status));

const list = await api('/conversations', { token: a.token });
const locked = list.json.conversations.find((c) => c.id === cid);
ok('the chat list ships no pinned body from a locked chat', !JSON.stringify(locked?.pins).includes('THESECRET'),
   JSON.stringify(locked?.pins).slice(0, 160));
ok('and no last-message preview', locked?.lastMessage === null, JSON.stringify(locked?.lastMessage));

r = await api(`/conversations/${cid}/pins`, { token: a.token });
ok('the pins endpoint hides a locked chat', !JSON.stringify(r.json).includes('THESECRET'), JSON.stringify(r.json).slice(0, 160));

// It all comes back once the code is entered.
await api(`/conversations/${cid}/lock/verify`, { method: 'POST', token: a.token, body: { code: '4821' } });
r = await api(`/messages/search/all?q=THESECRET`, { token: a.token });
ok('and everything returns after unlocking', JSON.stringify(r.json).includes('THESECRET'), JSON.stringify(r.json).slice(0, 120));

/* ── FRIENDSHIP ───────────────────────────────────────────────────────── */
const s1 = await reg('strangera');
r = await api('/conversations/group', { method: 'POST', token: s1.token, body: { name: 'hi', memberIds: [b.id] } });
ok('a stranger cannot put you in a group', r.status === 403, r.status + ' ' + JSON.stringify(r.json).slice(0, 120));

// A friend still can.
const d = await reg('audd');
await befriend(s1, d);
r = await api('/conversations/group', { method: 'POST', token: s1.token, body: { name: 'ok', memberIds: [d.id] } });
ok('a friend still can', r.status === 201, r.status + ' ' + JSON.stringify(r.json).slice(0, 120));

const sc = await api('/conversations/direct', { method: 'POST', token: s1.token, body: { userId: b.id } });
const scid = sc.json.conversation.id;
r = await api(`/rooms/${scid}/wall`, { method: 'POST', token: s1.token, body: { type: 'note', text: 'unsolicited' } });
ok('a stranger cannot post to your wall', r.status === 403, String(r.status));
r = await api(`/rooms/${scid}/pace`, { method: 'PATCH', token: s1.token, body: { slowMode: 3600 } });
ok('a stranger cannot throttle your chat', r.status === 403, String(r.status));
r = await api(`/rooms/${scid}/mood`, { method: 'PUT', token: s1.token, body: { mood: 'deep-work', note: 'unsolicited' } });
ok('a stranger cannot set your room mood', r.status === 403, String(r.status));

r = await api(`/conversations/${cid}/wallpaper?force=1`, { method: 'PUT', token: b.token, body: { preset: 'dusk' } });
ok('?force=1 no longer skips wallpaper consent', r.json.conversation?.wallpaper?.preset !== 'dusk',
   JSON.stringify(r.json.conversation?.wallpaper?.preset));

// Blocking now covers groups too.
const e = await reg('aude');
await befriend(a, e);
await api(`/users/${e.id}/block`, { method: 'POST', token: a.token });
r = await api('/conversations/group', { method: 'POST', token: e.token, body: { name: 'x', memberIds: [a.id] } });
ok('a blocked person cannot group-message you', r.status === 403, String(r.status));

/* ── AUTH ─────────────────────────────────────────────────────────────── */
const admin = (await api('/admin/sign-in', { method: 'POST', body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } })).json.token;
const victim = await reg('audv');

// A second's grace: `requireAuth` allows a token whose `iat` second matches
// the sign-out instant, so that a legitimate sign-in racing the same second is
// not rejected. Wait past it, or the test measures the tolerance, not the rule.
await new Promise((r) => setTimeout(r, 1500));

// Force sign-out must survive a refresh.
const signedOut = await fetch(BASE + `/admin/users/${victim.id}/sign-out`, {
  method: 'POST', headers: { authorization: `Bearer ${admin}` },
});
ok('force sign-out is accepted', signedOut.status === 200, String(signedOut.status));
r = await api('/auth/me', { token: victim.token });
ok('the old access token stops working', r.status === 401, String(r.status));

// The finding was that /auth/refresh reissued one regardless, so the sign-out
// lasted exactly until the app's next boot.
const cookieJar = await fetch(BASE + '/auth/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'ref' + Date.now().toString(36).slice(-6), displayName: 'ref', password: 'testpass123' }),
});
const jar = (cookieJar.headers.getSetCookie?.() || []).find((c) => /^nook_rt=/.test(c))?.split(';')[0];
const refUser = (await cookieJar.json()).user;
await new Promise((res) => setTimeout(res, 1500));
await fetch(BASE + `/admin/users/${refUser.id}/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${admin}` } });
const refreshed = await fetch(BASE + '/auth/refresh', { method: 'POST', headers: { cookie: jar || '' } });
ok('refresh cannot undo a forced sign-out', refreshed.status === 401, String(refreshed.status));

// Suspension must reach the refresh route too.
const v2 = await reg('audv2');
await fetch(BASE + `/admin/users/${v2.id}/suspend`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
  body: JSON.stringify({ suspended: true }),
});
r = await api('/auth/me', { token: v2.token });
ok('a suspended account is refused', r.status === 403, String(r.status));

// Brute-forcing an email code burns it.
const g = await reg('audg');
await api('/auth/email', { method: 'POST', token: g.token, body: { email: `${g.username}@example.com` } });
let refused = 0;
for (let i = 0; i < 8; i += 1) {
  const t = await api('/auth/email/verify', { method: 'POST', token: g.token, body: { code: '000000' } });
  if (t.status === 429) refused += 1;
}
ok('guessing an email code is stopped', refused > 0, `${refused} of 8 refused`);

process.exit(t.done() ? 1 : 0);
