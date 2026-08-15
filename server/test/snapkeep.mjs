/**
 * Snaps: opening, replaying, and keeping.
 *
 * The bug these exist to prevent was invisible from the server's side. Every
 * request succeeded — record the view, burn, broadcast, 200 OK — and the snap
 * still could not be looked at, because the burn happened before the picture
 * was shown. Nothing failed; the order was wrong.
 *
 * So these assert on what the *viewer receives*, not on status codes: after
 * the first open the media must still be there, and after the last one it must
 * not be.
 */
import { suite, api, register, befriend, directChat } from './helpers.mjs';

const t = suite('snaps: replay and keep');

const a = await register('snapa');
const b = await register('snapb');
await befriend(a, b);
const cid = await directChat(a, b);

const media = { url: 'https://example.com/snap.jpg', mime: 'image/jpeg', name: 's.jpg', size: 10 };

const sendSnap = async (viewSeconds) =>
  (
    await api(`/messages/${cid}`, {
      method: 'POST',
      token: a.token,
      body: { type: 'snap', media, viewOnce: true, viewSeconds },
    })
  ).json.message;

const seenBy = async (token, id) =>
  (await api(`/messages/${cid}`, { token })).json.messages.find((m) => m.id === id);

/* ── a snap with a timer: four looks, then gone ────────────────────────── */

let snap = await sendSnap(10);
t.ok('a snap can be sent', Boolean(snap?.id), JSON.stringify(snap).slice(0, 80));

let theirs = await seenBy(b.token, snap.id);
t.ok('the recipient can see it before opening', Boolean(theirs?.media?.url), String(theirs?.media));
t.ok('and it is not burnt', theirs?.viewOnce?.burnt === false, String(theirs?.viewOnce?.burnt));
t.ok('with four looks available', theirs?.viewOnce?.opensLeft === 4, String(theirs?.viewOnce?.opensLeft));

// THE REGRESSION: one open used to destroy the media before it was shown.
let r = await api(`/messages/${snap.id}/view`, { method: 'POST', token: b.token });
t.ok('opening it is accepted', r.status === 200, `${r.status}`);
t.ok('and reports the looks left', r.json.opensLeft === 3, String(r.json.opensLeft));

theirs = await seenBy(b.token, snap.id);
t.ok('the picture SURVIVES the first open', Boolean(theirs?.media?.url), String(theirs?.media));
t.ok('and it still is not burnt', theirs?.viewOnce?.burnt === false, String(theirs?.viewOnce?.burnt));

// Replays two, three and four.
for (const expected of [2, 1, 0]) {
  r = await api(`/messages/${snap.id}/view`, { method: 'POST', token: b.token });
  t.ok(`replaying leaves ${expected}`, r.json.opensLeft === expected, String(r.json.opensLeft));
}

theirs = await seenBy(b.token, snap.id);
t.ok('after the last look it is burnt', theirs?.viewOnce?.burnt === true, String(theirs?.viewOnce?.burnt));
t.ok('and the picture is gone', !theirs?.media, JSON.stringify(theirs?.media));

r = await api(`/messages/${snap.id}/view`, { method: 'POST', token: b.token });
t.ok('a fifth open is refused rather than silently allowed', r.status === 410, `${r.status}`);

/* ── the sender is not spending the recipient's looks ──────────────────── */

snap = await sendSnap(10);
for (let i = 0; i < 5; i += 1) await api(`/messages/${snap.id}/view`, { method: 'POST', token: a.token });
theirs = await seenBy(b.token, snap.id);
t.ok('the sender viewing their own snap costs the recipient nothing',
  theirs?.viewOnce?.opensLeft === 4, String(theirs?.viewOnce?.opensLeft));

/* ── keeping: only when the sender set no time limit ───────────────────── */

const timed = await sendSnap(10);
r = await api(`/messages/${timed.id}/save`, { method: 'POST', token: b.token, body: { saved: true } });
t.ok('a timed snap cannot be kept', r.status === 400, `${r.status}`);

const untimed = await sendSnap(0);
theirs = await seenBy(b.token, untimed.id);
t.ok('a snap with no limit offers keeping', theirs?.viewOnce?.canSave === true, String(theirs?.viewOnce?.canSave));
t.ok('a timed one does not', (await seenBy(b.token, timed.id))?.viewOnce?.canSave === false);

r = await api(`/messages/${untimed.id}/save`, { method: 'POST', token: b.token, body: { saved: true } });
t.ok('keeping it is accepted', r.status === 200, `${r.status}`);

theirs = await seenBy(b.token, untimed.id);
t.ok('and it reads as kept', theirs?.saved === true, String(theirs?.saved));

// A kept snap must outlive its allowance — that is the entire promise.
for (let i = 0; i < 6; i += 1) await api(`/messages/${untimed.id}/view`, { method: 'POST', token: b.token });
theirs = await seenBy(b.token, untimed.id);
t.ok('a kept snap survives being opened past its allowance', Boolean(theirs?.media?.url), String(theirs?.media));
t.ok('and never reads as burnt', theirs?.viewOnce?.burnt === false, String(theirs?.viewOnce?.burnt));

// And letting it go must be possible, or Keep is a one-way door.
r = await api(`/messages/${untimed.id}/save`, { method: 'POST', token: b.token, body: { saved: false } });
t.ok('it can be let go again', r.status === 200, `${r.status}`);
t.ok('and stops reading as kept', (await seenBy(b.token, untimed.id))?.saved === false);

// The sender keeping their own snap makes no sense — they still have it.
r = await api(`/messages/${untimed.id}/save`, { method: 'POST', token: a.token, body: { saved: true } });
t.ok('the sender cannot keep their own snap', r.status === 400, `${r.status}`);

/* ── ordinary messages can be kept too, with no timer rule ─────────────── */

const plain = (await api(`/messages/${cid}`, { method: 'POST', token: a.token, body: { body: 'keep me', type: 'text' } })).json.message;
r = await api(`/messages/${plain.id}/save`, { method: 'POST', token: b.token, body: { saved: true } });
t.ok('an ordinary message can be kept', r.status === 200, `${r.status}`);
t.ok('and reads as kept', (await seenBy(b.token, plain.id))?.saved === true);

/* ── keeping actually beats the disappearing timer ─────────────────────── */

/**
 * The part that was missing, and the part the whole feature rests on.
 *
 * saved_by was written, the label said "Kept", and deleteExpired swept the
 * message anyway — it filtered on expires_at alone. Keep wrote a row and
 * changed nothing. Nobody would have noticed until they went back for a
 * message they had deliberately saved and found it gone, which is the worst
 * possible moment to discover it.
 *
 * Asserted against the SQL rather than by waiting out a timer: the sweep is
 * one statement, and what matters is that it cannot select a saved row.
 */
import { one, run } from '../src/db/index.js';
import { deleteExpired } from '../src/db/messages.js';

const kept = (await api(`/messages/${cid}`, { method: 'POST', token: a.token, body: { body: 'save me', type: 'text' } })).json.message;
const doomed = (await api(`/messages/${cid}`, { method: 'POST', token: a.token, body: { body: 'let me go', type: 'text' } })).json.message;

await api(`/messages/${kept.id}/save`, { method: 'POST', token: b.token, body: { saved: true } });

// Expire both, a second in the past.
const past = Date.now() - 1000;
await run('UPDATE messages SET expires_at = ? WHERE id IN (?, ?)', [past, kept.id, doomed.id]);

await deleteExpired();

t.ok('an expired message is swept', !(await one('SELECT id FROM messages WHERE id = ?', [doomed.id])));
t.ok('a kept one survives the sweep', Boolean(await one('SELECT id FROM messages WHERE id = ?', [kept.id])));

process.exit(t.done() ? 1 : 0);
