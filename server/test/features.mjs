/**
 * The features, checked end to end.
 *
 * Separate from `security.mjs`, which asserts what must *not* be possible.
 * This one asserts what must still work — the two drift apart easily, because
 * every security fix is a chance to break the thing it was protecting.
 */
import { suite, api, register, befriend, directChat, say, adminToken } from './helpers.mjs';

const t = suite('features');

/* ── friend requests ──────────────────────────────────────────────────── */

const a = await register('alice');
const b = await register('bob', { withEmail: true });
const cid = await directChat(a, b);

let r = await say(a.token, cid, 'before accepting');
t.ok('a stranger cannot send', r.status === 403, `${r.status}`);
t.ok('and is told why in a way the UI can branch on', r.json.code === 'NOT_FRIENDS', JSON.stringify(r.json));

r = await api(`/users/${b.id}/friend`, { method: 'POST', token: a.token, body: { note: 'met at work' } });
t.ok('a request can be sent', r.status === 201 && r.json.friendship === 'sent', JSON.stringify(r.json));

r = await api('/users/friends/requests', { token: b.token });
t.ok('it arrives with its note intact', r.json.incoming?.[0]?.note === 'met at work', JSON.stringify(r.json.incoming));

r = await api(`/users/${a.id}/friend/accept`, { method: 'POST', token: b.token });
t.ok('accepting works', r.json.friendship === 'friends', JSON.stringify(r.json));

r = await say(a.token, cid, 'hello properly');
t.ok('and the chat opens both ways', r.status === 201, `${r.status}`);
r = await say(b.token, cid, 'hi back');
t.ok('for the other person too', r.status === 201, `${r.status}`);

/* ── personal vs shared wallpaper ─────────────────────────────────────── */

r = await api(`/conversations/${cid}/wallpaper?scope=mine`, {
  method: 'PUT',
  token: a.token,
  body: { preset: 'dusk', tint: '#57694A', dim: 0.5 },
});
t.ok('a personal wallpaper saves', r.json.conversation?.myWallpaper?.preset === 'dusk', JSON.stringify(r.json.conversation?.myWallpaper));
t.ok('without touching the room', !r.json.conversation?.wallpaper?.preset, JSON.stringify(r.json.conversation?.wallpaper?.preset));
t.ok('and without asking anyone', r.json.conversation?.wallpaper?.proposal === null);

const theirs = (await api('/conversations', { token: b.token })).json.conversations.find((c) => c.id === cid);
t.ok('the other person never sees it', theirs?.myWallpaper === null, JSON.stringify(theirs?.myWallpaper));

r = await api(`/conversations/${cid}/wallpaper`, { method: 'PUT', token: a.token, body: { preset: 'linen' } });
t.ok('a shared wallpaper still only proposes', r.json.conversation?.wallpaper?.proposal?.preset === 'linen', JSON.stringify(r.json.conversation?.wallpaper?.proposal));

r = await api(`/conversations/${cid}/wallpaper?scope=mine`, { method: 'PUT', token: a.token, body: { url: '', preset: '' } });
t.ok('and the personal one can be cleared', r.json.conversation?.myWallpaper === null, JSON.stringify(r.json.conversation?.myWallpaper));

/* ── chat lock ────────────────────────────────────────────────────────── */

r = await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pin', code: '12' } });
t.ok('a two-digit PIN is refused', r.status === 400, `${r.status}`);
r = await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pattern', code: '0,1,2' } });
t.ok('a three-dot pattern is refused', r.status === 400, `${r.status}`);

r = await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pin', code: '4821' } });
t.ok('a valid PIN locks it', r.json.conversation?.locked === true && r.json.conversation?.lockKind === 'pin', JSON.stringify(r.json.conversation?.lockKind));
/**
 * Checked against the fields, not against a substring of the whole response.
 *
 * It used to be `!JSON.stringify(r.json).includes('4821')`, which fails at
 * random: ids are hex, and four digits turn up inside one often enough to cry
 * wolf. A test that fails for no reason teaches people to ignore it, which
 * costs more than the test was ever worth.
 */
const convo = r.json.conversation || {};
t.ok(
  'and the code never comes back',
  convo.lockCode === undefined && convo.lockHash === undefined && convo.code === undefined,
  JSON.stringify(Object.keys(convo).filter((k) => /lock|code/i.test(k)))
);

r = await api(`/conversations/${cid}/lock/verify`, { method: 'POST', token: a.token, body: { code: '0000' } });
t.ok('a wrong code is refused', r.status === 403, `${r.status}`);
r = await api(`/conversations/${cid}/lock/verify`, { method: 'POST', token: a.token, body: { code: '4821' } });
t.ok('the right code opens it', r.status === 200 && r.json.conversation?.lockOpen === true, `${r.status}`);

r = await api(`/conversations/${cid}/lock`, { method: 'PUT', token: a.token, body: { kind: 'pattern', code: '0,3,6,7' } });
t.ok('changing the code needs the old one', r.status === 403, `${r.status}`);
r = await api(`/conversations/${cid}/lock`, {
  method: 'PUT',
  token: a.token,
  body: { kind: 'pattern', code: '0,3,6,7', currentCode: '4821' },
});
t.ok('with it, the kind can change', r.json.conversation?.lockKind === 'pattern', JSON.stringify(r.json.conversation?.lockKind));

r = await api(`/conversations/${cid}/lock`, { method: 'DELETE', token: a.token, body: { code: '9,9,9,9' } });
t.ok('removing it needs the code', r.status !== 200, `${r.status}`);
r = await api(`/conversations/${cid}/lock`, { method: 'DELETE', token: a.token, body: { code: '0,3,6,7' } });
t.ok('with the code it comes off', r.json.conversation?.locked === false, JSON.stringify(r.json.conversation?.locked));

/* ── profile picture ──────────────────────────────────────────────────── */

const me = await api('/auth/me', { token: a.token });
t.ok('a new account has no picture', me.json.user?.avatarUrl === '', JSON.stringify(me.json.user?.avatarUrl));
r = await api('/users/me', { method: 'PATCH', token: a.token, body: { avatarUrl: 'https://example.com/a.jpg' } });
t.ok('one can be set', r.json.user?.avatarUrl === 'https://example.com/a.jpg', JSON.stringify(r.json.user?.avatarUrl));
r = await api('/users/me', { method: 'PATCH', token: a.token, body: { avatarUrl: '' } });
t.ok('and removed', r.json.user?.avatarUrl === '', JSON.stringify(r.json.user?.avatarUrl));

/* ── notification preferences ─────────────────────────────────────────── */

t.ok('previews default to on', me.json.user?.settings?.notifyPreview !== false);
t.ok('reactions default to off', me.json.user?.settings?.notifyReactions === false);
r = await api('/users/me', {
  method: 'PATCH',
  token: a.token,
  body: { settings: { ...me.json.user.settings, notifyPreview: false } },
});
t.ok('a preference saves', r.json.user?.settings?.notifyPreview === false, JSON.stringify(r.json.user?.settings?.notifyPreview));
t.ok('without disturbing its neighbours', r.json.user?.settings?.enterToSend === true);

/* ── admin ────────────────────────────────────────────────────────────── */

const admin = await adminToken();
t.ok('the admin can sign in', Boolean(admin));

const open = await api(`/admin/users/${b.id}/open`, { method: 'POST', token: admin });
t.ok('an account can be opened', open.status === 200 && Boolean(open.json.accessToken), `${open.status}`);
t.ok('with a real session, not a bare token', open.cookies.some((c) => /^nook_rt=/.test(c)), JSON.stringify(open.cookies));
const who = await api('/auth/me', { token: open.json.accessToken });
t.ok('and it is the right person', who.json.user?.username === b.username, `${who.json.user?.username}`);

r = await api('/admin/broadcast/message', { method: 'POST', token: admin, body: { to: 'all', body: 'Maintenance tonight.' } });
t.ok('the in-app broadcast reaches everyone', r.json.sent === r.json.attempted && r.json.sent > 0, JSON.stringify(r.json));

r = await api('/admin/broadcast/email', {
  method: 'POST',
  token: admin,
  body: { to: b.id, subject: 'HTML', format: 'html', body: '<p>Hi {{name}}</p>' },
});
t.ok('an HTML email is accepted', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

r = await api('/admin/broadcast/push', { method: 'POST', token: admin, body: { to: 'all', title: 'Back', body: 'Sorry.' } });
t.ok('a push broadcast reports honestly', r.status === 200 && r.json.reached === 0 && r.json.silent === r.json.attempted, JSON.stringify(r.json));

process.exit(t.done() ? 1 : 0);
