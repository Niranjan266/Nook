/**
 * Per-chat notification overrides — "custom notification for this person".
 *
 * The middle state is the whole design, so it is what these check: a chat that
 * has chosen nothing must keep following the global setting rather than
 * freezing at whatever it happened to be.
 */
import { suite, api, register, befriend, directChat } from './helpers.mjs';

const t = suite('custom notifications');

const a = await register('prefa');
const b = await register('prefb');
await befriend(a, b);
const cid = await directChat(a, b);

let convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('a new chat follows the default', convo?.notifyVibrate === -1 && convo?.notifyPreview === -1,
     JSON.stringify({ v: convo?.notifyVibrate, p: convo?.notifyPreview }));

let r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { notifyVibrate: 0 } });
t.ok('vibrate can be turned off for one person', r.status === 200, `${r.status}`);

convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('and it sticks', convo?.notifyVibrate === 0, String(convo?.notifyVibrate));
t.ok('without disturbing the other setting', convo?.notifyPreview === -1, String(convo?.notifyPreview));

r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { notifyPreview: 1 } });
convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('previews can be forced on for one person', convo?.notifyPreview === 1, String(convo?.notifyPreview));

// Back to Default has to be reachable, or the setting is a one-way door.
r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { notifyVibrate: -1 } });
convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('and put back to Default', convo?.notifyVibrate === -1, String(convo?.notifyVibrate));

// It is a personal setting, exactly like the wallpaper and the lock.
const theirs = (await api('/conversations', { token: b.token })).json.conversations.find((c) => c.id === cid);
t.ok('the other person is unaffected', theirs?.notifyPreview === -1, String(theirs?.notifyPreview));

r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { notifyVibrate: 5 } });
t.ok('a value outside -1..1 is refused', r.status === 400, `${r.status}`);

// The per-chat sound still works alongside the new fields.
r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { sound: 'chime' } });
convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('a per-chat sound still saves', convo?.sound === 'chime', String(convo?.sound));

// And the lock is still not settable here - the hole that was closed earlier.
r = await api(`/conversations/${cid}/prefs`, { method: 'PATCH', token: a.token, body: { locked: true } });
convo = (await api('/conversations', { token: a.token })).json.conversations.find((c) => c.id === cid);
t.ok('prefs still cannot set the lock', convo?.locked === false, String(convo?.locked));

process.exit(t.done() ? 1 : 0);
