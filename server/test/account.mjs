/**
 * Confirming an email, and deleting a contact.
 *
 * Both are things a person does to their own account, and both are easy to
 * get subtly wrong in ways no error message reveals: a resend that leaves two
 * valid codes in two inboxes, a delete that removes the friendship but leaves
 * the contact row, so the person reappears in search as though nothing
 * happened.
 */
import { suite, api, register, befriend, directChat } from './helpers.mjs';

const t = suite('account: verify email, delete contact');

/* ── confirming an email ───────────────────────────────────────────────── */

const noEmail = await register('vera');

let r = await api('/auth/email/resend', { method: 'POST', token: noEmail.token });
t.ok('resend refuses when there is no address on the account', r.status === 400, `${r.status}`);

// Adding an address issues a code; the account is unverified until it is used.
const addr = `vera${Date.now()}@example.com`;
r = await api('/auth/email', { method: 'POST', token: noEmail.token, body: { email: addr } });
t.ok('adding an email is accepted', r.status === 200, `${r.status}`);

r = await api('/auth/me', { token: noEmail.token });
t.ok('and the address is recorded', r.json.user?.email === addr, r.json.user?.email);
t.ok('but not yet verified', r.json.user?.emailVerified === false, String(r.json.user?.emailVerified));

// Resending is allowed while unverified, and must not need the address again.
r = await api('/auth/email/resend', { method: 'POST', token: noEmail.token });
t.ok('resend works once an address is on file', r.status === 200, `${r.status}`);
t.ok('and reports which channel carried it', typeof r.json.channel === 'string', JSON.stringify(r.json).slice(0, 90));
t.ok('and never returns the code itself', !JSON.stringify(r.json).match(/\b\d{6}\b/), JSON.stringify(r.json).slice(0, 120));

r = await api('/auth/email/verify', { method: 'POST', token: noEmail.token, body: { code: '000000' } });
t.ok('a wrong code is refused', r.status === 400 || r.status === 429, `${r.status}`);

r = await api('/auth/email/verify', { method: 'POST', token: noEmail.token, body: { code: '1' } });
t.ok('a code of the wrong length is refused before anything else', r.status === 400, `${r.status}`);

/* ── deleting a contact ────────────────────────────────────────────────── */

const a = await register('dela');
const b = await register('delb');
await befriend(a, b);
const cid = await directChat(a, b);

r = await api(`/users/${b.id}`, { token: a.token });
t.ok('they are friends to begin with', r.json.user?.friendship === 'friends', r.json.user?.friendship);

// The point of the whole feature: one call ends both halves.
r = await api(`/users/${b.id}/unfriend`, { method: 'POST', token: a.token });
t.ok('deleting the contact is accepted', r.status === 200, `${r.status}`);

r = await api(`/users/${b.id}`, { token: a.token });
t.ok('the friendship is gone', r.json.user?.friendship === 'none', r.json.user?.friendship);

// And it is mutual — a one-sided delete would leave the other person able to
// message someone who has removed them.
r = await api(`/users/${a.id}`, { token: b.token });
t.ok('and gone for them too, not just for me', r.json.user?.friendship === 'none', r.json.user?.friendship);

// Friend gating is what actually protects the person who deleted.
r = await api(`/messages/${cid}`, { method: 'POST', token: b.token, body: { body: 'still here', type: 'text' } });
t.ok('the deleted contact can no longer message them', r.status === 403, `${r.status}`);

// The history is the account holder's own; deleting a contact is not a purge.
r = await api(`/messages/${cid}`, { token: a.token });
t.ok('their existing conversation still opens', r.status === 200, `${r.status}`);

// Deleting twice should be quiet, not an error — a double tap is not a fault.
r = await api(`/users/${b.id}/unfriend`, { method: 'POST', token: a.token });
t.ok('deleting again is harmless', r.status === 200, `${r.status}`);

// And it must be re-startable: removing someone is not a permanent ban.
r = await api(`/users/${b.id}/friend`, { method: 'POST', token: a.token, body: { note: 'hello again' } });
t.ok('you can ask to reconnect afterwards', r.status === 201 || r.status === 200, `${r.status}`);

process.exit(t.done() ? 1 : 0);
