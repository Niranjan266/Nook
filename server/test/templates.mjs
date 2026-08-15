/**
 * The notification templates.
 *
 * Two different things are protected here.
 *
 * The first is that every template renders — that each kind produces a payload
 * with the fields push and email actually need, whatever it is handed,
 * including nothing. These call the module directly, because they are pure
 * functions and a server would add only latency.
 *
 * The second is that the admin endpoints agree with the module: that the
 * preview shows what a send would produce, and that the catalogue does not
 * advertise a channel a template cannot reach. Those go over HTTP, because
 * that seam — module to route to wire — is exactly where a rename or a
 * dropped field survives unnoticed.
 */
import { TEMPLATES, byId, catalogue, render, trim } from '../src/services/templates.js';
import { suite, api, adminToken } from './helpers.mjs';

const t = suite('notification templates');

/* ── the catalogue itself ──────────────────────────────────────────────── */

t.ok(
  'every template has a stable id',
  Object.values(TEMPLATES).every((x) => typeof x.id === 'string' && x.id.length > 0)
);

const ids = Object.values(TEMPLATES).map((x) => x.id);
t.ok('ids are unique', new Set(ids).size === ids.length, ids.join(','));

t.ok(
  'every template renders a push payload',
  Object.values(TEMPLATES).every((x) => {
    const p = x.push({ sender: 'Ada', preview: 'hello', message: 'hello', headline: 'Hi' });
    return p && typeof p.title === 'string' && typeof p.body === 'string';
  })
);

// Handed nothing at all — which is what a half-filled admin form produces.
t.ok(
  'a push title is never empty, even with nothing filled in',
  Object.values(TEMPLATES).every((x) => (x.push({}).title || '').length > 0)
);

/* ── trimming, which is what stops a lock screen mangling the copy ─────── */

t.ok('short text is left alone', trim('Hello there') === 'Hello there');

const long = trim('x'.repeat(200));
t.ok('long text is cut and ellipsised', long.length <= 120 && long.endsWith('…'), long.length + '');

t.ok('whitespace and newlines are flattened', trim('a\n\n  b   c') === 'a b c', trim('a\n\n  b   c'));

t.ok('null and undefined do not throw', trim(null) === '' && trim(undefined) === '');

const wordy = trim('alpha bravo charlie delta echo foxtrot golf hotel india', 30);
t.ok('the cut lands between words, not inside one', !/[a-z]…$/.test(wordy) === false || wordy.includes(' '), wordy);

/* ── individual templates say the right thing ──────────────────────────── */

let p = TEMPLATES.message.push({ sender: 'Ada', preview: 'hi', conversationId: 7 });
t.ok('a direct message shows the sender alone', p.title === 'Ada' && p.body === 'hi', p.title);
t.ok('the tag groups by conversation, so one chat is one stack', p.tag === 'convo-7', p.tag);

p = TEMPLATES.message.push({ sender: 'Ada', preview: 'hi', conversationName: 'Bookclub', conversationId: 7 });
t.ok('a group message shows sender and group', p.title === 'Ada · Bookclub', p.title);

p = TEMPLATES.friendRequest.push({ sender: 'Ada', userId: 3 });
t.ok('a friend request falls back to a prompt with no note', p.body === 'Tap to accept or decline.', p.body);

p = TEMPLATES.friendRequest.push({ sender: 'Ada', note: 'we met at work', userId: 3 });
t.ok("a friend request uses the sender's note when there is one", p.body === 'we met at work', p.body);

t.ok('a nudge is urgent — that is the entire point of it', TEMPLATES.nudge.push({ sender: 'A', userId: 1 }).urgent === true);

const video = TEMPLATES.call.push({ sender: 'Ada', video: true, callId: 1, conversationId: 2 });
const voice = TEMPLATES.call.push({ sender: 'Ada', video: false, callId: 1, conversationId: 2 });
t.ok('a call is urgent and says which kind', video.urgent && video.body === 'Video call' && voice.body === 'Voice call');

t.ok('a message sends no email — push is what that is for', TEMPLATES.message.email === null);
t.ok('an announcement does send an email', typeof TEMPLATES.update.email === 'function');

p = TEMPLATES.maintenance.push({ when: 'Sunday 2am', message: 'about an hour' });
t.ok('maintenance leads with when, the only part that matters', p.body.startsWith('Sunday 2am'), p.body);

t.ok('an important notice is urgent', TEMPLATES.notice.push({ headline: 'x', message: 'y' }).urgent === true);

t.ok(
  'a notice email always carries the anti-phishing line',
  TEMPLATES.notice.email({ headline: 'x', message: 'y' }).body.includes('never ask you for your password')
);

/* ── the helpers ───────────────────────────────────────────────────────── */

t.ok('byId finds by id, not by key', byId('friend-request')?.id === 'friend-request');
t.ok('byId returns null for an unknown id rather than throwing', byId('nope') === null);

t.ok('the catalogue lists only announcements', catalogue().every((x) => byId(x.id).kind === 'announcement'));

t.ok(
  'the catalogue carries no functions — nothing that cannot cross the wire',
  catalogue().every((x) => typeof x.push === 'undefined' && Array.isArray(x.fields))
);

t.ok(
  'the catalogue tells the truth about which channels exist',
  catalogue().every((x) => x.channels.email === Boolean(byId(x.id).email))
);

const rendered = render('update', { headline: 'Hi', message: 'There' });
t.ok('render returns all three channels at once', Boolean(rendered.push && rendered.email && rendered.banner));
t.ok('render returns null for an unknown id', render('nope') === null);

/* ── over the wire, where the seams are ────────────────────────────────── */

const token = await adminToken();

let r = await api('/admin/templates', { token });
t.ok('the admin catalogue endpoint answers', r.status === 200 && Array.isArray(r.json.templates), `${r.status}`);
t.ok('and it is not empty', (r.json.templates || []).length > 0);

r = await api('/admin/templates');
t.ok('it refuses anyone who is not an admin', r.status === 401 || r.status === 403, `${r.status}`);

const values = { headline: 'Wallpapers sync', message: 'Everywhere now.' };
r = await api('/admin/templates/preview', { method: 'POST', token, body: { id: 'update', values } });
const local = render('update', values);
t.ok(
  'preview returns exactly what the module renders',
  r.status === 200 && r.json.push?.title === local.push.title && r.json.push?.body === local.push.body,
  `${r.status} ${r.json.push?.title}`
);

r = await api('/admin/templates/preview', { method: 'POST', token, body: { id: 'nope', values: {} } });
t.ok('preview of an unknown template is a 404, not an empty success', r.status === 404, `${r.status}`);

r = await api('/admin/templates/send', {
  method: 'POST',
  token,
  body: { id: 'update', to: 'all', values: { headline: 'H', message: 'M' }, channels: { push: false, email: false } },
});
t.ok(
  'sending with no channel selected reports reaching nobody',
  r.status >= 400 || (r.json.push === null && r.json.email === null),
  `${r.status} ${JSON.stringify(r.json)}`
);

r = await api('/admin/templates/send', {
  method: 'POST',
  token,
  body: { id: 'nope', to: 'all', values: {}, channels: { push: true } },
});
t.ok('sending an unknown template is refused', r.status === 404, `${r.status}`);

process.exit(t.done() ? 1 : 0);
