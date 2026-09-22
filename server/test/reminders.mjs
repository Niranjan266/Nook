/**
 * Message reminders.
 *
 * The route half is the usual seam work: who may set a reminder on what, and
 * whether the times are refused when they should be. The firing half runs
 * against the real scheduler — run.sh shortens its reminder tick to a second —
 * because the bug worth catching is the one where the row is claimed and
 * nothing arrives, and only the whole path can show that.
 */
import { suite, api, register, befriend, directChat, say, BASE } from './helpers.mjs';
import { one, run, newId } from '../src/db/index.js';
import { claimReminder } from '../src/db/reminders.js';

const t = suite('message reminders');

const a = await register('rma');
const b = await register('rmb');
const outsider = await register('rmx');
await befriend(a, b);
const cid = await directChat(a, b);

const soon = (ms) => new Date(Date.now() + ms).toISOString();
const HOUR = 3600_000;

const m1 = (await say(a.token, cid, 'the address is 12 Elm St')).json.message;

/* ── create, list, move, delete ────────────────────────────────────────── */

let r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: soon(HOUR), note: 'bring wine' } });
t.ok('a member can set a reminder', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
const first = r.json.reminder;
t.ok('it comes back with the message snippet', first?.snippet === 'the address is 12 Elm St', first?.snippet);
t.ok('and the note', first?.note === 'bring wine');
t.ok('and who wrote the message', first?.senderName === 'rma', first?.senderName);

r = await api('/reminders', { token: b.token });
t.ok('it is listed as upcoming', r.status === 200 && r.json.upcoming?.some((x) => x.id === first.id), `${r.status}`);

r = await api('/reminders', { token: a.token });
t.ok("it is not in anybody else's list", !r.json.upcoming?.some((x) => x.id === first.id));

const later = soon(2 * HOUR);
r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: later } });
t.ok('setting it again moves it rather than adding another', r.status === 200 && r.json.reminder?.id === first.id, `${r.status}`);
r = await api('/reminders', { token: b.token });
t.ok('still exactly one for that message', r.json.upcoming.filter((x) => x.messageId === m1.id).length === 1);
t.ok('at the new time', r.json.upcoming.find((x) => x.id === first.id)?.remindAt === later);

r = await api(`/reminders/${first.id}`, { method: 'DELETE', token: a.token });
t.ok("somebody else cannot cancel it", r.status === 404, `${r.status}`);

r = await api(`/reminders/${first.id}`, { method: 'DELETE', token: b.token });
t.ok('the owner can cancel it', r.status === 200, `${r.status}`);
r = await api(`/reminders/${first.id}`, { method: 'DELETE', token: b.token });
t.ok('cancelling twice is a 404, not a quiet success', r.status === 404, `${r.status}`);

/* ── what is refused ───────────────────────────────────────────────────── */

r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: soon(-60_000) } });
t.ok('a time in the past is refused', r.status === 400, `${r.status}`);

r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: soon(400 * 86400_000) } });
t.ok('more than a year ahead is refused', r.status === 400, `${r.status}`);

r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: 'tomorrow at 9' } });
t.ok('a time that is not an instant is refused', r.status === 400, `${r.status}`);

r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m1.id, remindAt: soon(HOUR), note: 'x'.repeat(500) } });
t.ok('an essay of a note is refused', r.status === 400, `${r.status}`);

r = await api('/reminders', { method: 'POST', token: outsider.token, body: { messageId: m1.id, remindAt: soon(HOUR) } });
t.ok('someone outside the chat cannot set one', r.status === 403 || r.status === 404, `${r.status}`);

r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: 'f'.repeat(24), remindAt: soon(HOUR) } });
t.ok('a message that does not exist is a 404', r.status === 404, `${r.status}`);

const binned = (await say(a.token, cid, 'delete me for b')).json.message;
await api(`/messages/${binned.id}?scope=me`, { method: 'DELETE', token: b.token });
r = await api('/reminders', { method: 'POST', token: b.token, body: { messageId: binned.id, remindAt: soon(HOUR) } });
t.ok('a message you deleted for yourself cannot be reminded about', r.status === 404, `${r.status}`);

r = await api('/reminders', { method: 'POST', body: { messageId: m1.id, remindAt: soon(HOUR) } });
t.ok('signed out is refused', r.status === 401, `${r.status}`);

// The cap. Filled directly: a hundred round trips prove nothing the SQL does not.
const capper = await register('rmc');
await befriend(a, capper);
const capChat = await directChat(a, capper);
const capMsg = (await say(a.token, capChat, 'one too many')).json.message;
for (let i = 0; i < 100; i += 1) {
  await run(
    `INSERT INTO reminders (id, user_id, message_id, conversation_id, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), capper.id, `filler${i}`, capChat, Date.now() + 30 * 86400_000, Date.now()]
  );
}
r = await api('/reminders', { method: 'POST', token: capper.token, body: { messageId: capMsg.id, remindAt: soon(HOUR) } });
t.ok('past a hundred waiting, a new one is refused', r.status === 429, `${r.status}`);

/* ── the claim ─────────────────────────────────────────────────────────── */

/**
 * What stops a restart, or a second instance, from firing one reminder twice.
 * Two claims at once, exactly one winner.
 */
const m2 = (await say(a.token, cid, 'claim me')).json.message;
const toClaim = (await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m2.id, remindAt: soon(HOUR) } })).json.reminder;
const claims = await Promise.all([claimReminder(toClaim.id), claimReminder(toClaim.id), claimReminder(toClaim.id)]);
t.ok('only one claim of a reminder can win', claims.filter(Boolean).length === 1, JSON.stringify(claims));

/* ── firing ────────────────────────────────────────────────────────────── */

const { io } = await import('../../client/node_modules/socket.io-client/build/esm/index.js');
const sock = await new Promise((resolve, reject) => {
  const s = io(BASE.replace(/\/api$/, ''), { auth: { token: b.token }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
  setTimeout(() => reject(new Error('socket never connected')), 8000);
}).catch((e) => {
  t.ok('a socket can connect', false, e.message);
  return null;
});

const due = [];
sock?.on('reminder:due', (p) => due.push(p));

/** Poll rather than sleep a fixed time: the tick is a second, not a promise. */
async function until(check, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = await check();
    if (hit) return hit;
    await new Promise((res) => setTimeout(res, 200));
  }
  return null;
}

if (sock) {
  const m3 = (await say(a.token, cid, 'ring me back')).json.message;
  const set = (await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m3.id, remindAt: soon(2000), note: 'call mum' } })).json.reminder;

  const event = await until(() => due.find((p) => p.id === set.id));
  t.ok('a due reminder arrives over the socket', Boolean(event), `${due.length} events`);
  t.ok('with the snippet', event?.snippet === 'ring me back', event?.snippet);
  t.ok('and the message to jump to', event?.messageId === m3.id && event?.conversationId === cid);
  t.ok('and a banner rendered from the template', event?.banner?.title === 'call mum', JSON.stringify(event?.banner));

  const row = await one('SELECT fired_at, outcome FROM reminders WHERE id = ?', [set.id]);
  t.ok('it is marked fired', Boolean(row?.fired_at) && row?.outcome === 'sent', JSON.stringify(row));

  r = await api('/reminders', { token: b.token });
  t.ok('it leaves the upcoming list', !r.json.upcoming.some((x) => x.id === set.id));
  t.ok('and shows under recent', r.json.recent.some((x) => x.id === set.id && x.firedAt));

  await new Promise((res) => setTimeout(res, 2500));
  t.ok('it fires once, not on every tick', due.filter((p) => p.id === set.id).length === 1, `${due.filter((p) => p.id === set.id).length}`);

  // Deleted by the sender meanwhile: still told, told it went.
  const m4 = (await say(a.token, cid, 'about to be unsent')).json.message;
  const doomed = (await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m4.id, remindAt: soon(2000) } })).json.reminder;
  await api(`/messages/${m4.id}?scope=everyone`, { method: 'DELETE', token: a.token });
  const goneEvent = await until(() => due.find((p) => p.id === doomed.id));
  t.ok('a reminder for an unsent message still fires', Boolean(goneEvent));
  t.ok('saying the message was deleted, with nothing to jump to', goneEvent?.gone === true && goneEvent?.messageId === null && goneEvent?.snippet === '', JSON.stringify(goneEvent));

  // Deleted for yourself meanwhile: you threw it away, so nothing is said.
  const m5 = (await say(a.token, cid, 'I will bin this')).json.message;
  const binnedRem = (await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m5.id, remindAt: soon(1500) } })).json.reminder;
  await api(`/messages/${m5.id}?scope=me`, { method: 'DELETE', token: b.token });
  const dropped = await until(async () => (await one('SELECT outcome FROM reminders WHERE id = ?', [binnedRem.id]))?.outcome === 'dropped');
  t.ok('a message you deleted yourself is dropped quietly', Boolean(dropped) && !due.some((p) => p.id === binnedRem.id));

  // Fell due while the server was down: found by remind_at <= now on the next pass.
  const m6 = (await say(a.token, cid, 'overdue')).json.message;
  const overdue = (await api('/reminders', { method: 'POST', token: b.token, body: { messageId: m6.id, remindAt: soon(HOUR) } })).json.reminder;
  await run('UPDATE reminders SET remind_at = ? WHERE id = ?', [Date.now() - 3 * HOUR, overdue.id]);
  t.ok('an overdue reminder fires on the next pass', Boolean(await until(() => due.find((p) => p.id === overdue.id))));

  // The one claimed above, by hand, must never fire: the claim is the fire.
  t.ok('a claimed reminder is never fired again', !due.some((p) => p.id === toClaim.id));

  sock.close();
}

process.exit(t.done() ? 1 : 0);
