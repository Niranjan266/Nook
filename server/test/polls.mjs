/**
 * Polls and shared lists, end to end.
 *
 * Both halves matter: what members can do (vote, change their mind, tick
 * things off) and what they cannot (vote on a closed poll, see who picked
 * what in an anonymous one, delete somebody else's line, touch a chat they
 * are not in). The second half is where a missing check hides.
 */
import { suite, api, register, befriend } from './helpers.mjs';

const t = suite('polls');

const a = await register('pollA');
const b = await register('pollB');
const c = await register('pollC');
const outsider = await register('pollX');
await befriend(a, b);
await befriend(a, c);

let r = await api('/conversations/group', {
  method: 'POST',
  token: a.token,
  body: { name: 'Friday plans', memberIds: [b.id, c.id] },
});
const gid = r.json.conversation?.id;
t.ok('a group to poll in', Boolean(gid), `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);

const send = (token, body) => api(`/messages/${gid}`, { method: 'POST', token, body });
const vote = (token, id, optionIds) => api(`/messages/${id}/poll/vote`, { method: 'POST', token, body: { optionIds } });

/* ── creating ─────────────────────────────────────────────────────────── */

r = await send(a.token, { type: 'poll', body: 'Where for dinner?', poll: { options: ['Pizza', 'Tacos', 'Ramen'] } });
t.ok('a poll can be created', r.status === 201 && r.json.message?.type === 'poll', `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const poll = r.json.message;
t.ok('with its question as the body', poll?.body === 'Where for dinner?', poll?.body);
t.ok('and its options in order', poll?.poll?.options?.map((o) => o.text).join() === 'Pizza,Tacos,Ramen', JSON.stringify(poll?.poll?.options));
t.ok('starting empty and open', poll?.poll?.totalVoters === 0 && poll?.poll?.closed === false, JSON.stringify(poll?.poll));
const [pizza, tacos, ramen] = (poll?.poll?.options || []).map((o) => o.id);

r = await send(a.token, { type: 'poll', body: 'Lonely?', poll: { options: ['Only one'] } });
t.ok('one option is refused', r.status === 400, `${r.status}`);
r = await send(a.token, { type: 'poll', body: 'Too many?', poll: { options: Array.from({ length: 11 }, (_, i) => `o${i}`) } });
t.ok('eleven options are refused', r.status === 400, `${r.status}`);
r = await send(a.token, { type: 'poll', body: 'Same?', poll: { options: ['Yes', 'yes'] } });
t.ok('duplicate options are refused', r.status === 400, `${r.status}`);
r = await send(a.token, { type: 'poll', body: '   ', poll: { options: ['x', 'y'] } });
t.ok('a blank question is refused', r.status === 400, `${r.status}`);
r = await send(a.token, {
  type: 'poll',
  body: 'Yesterday?',
  poll: { options: ['x', 'y'], closesAt: new Date(Date.now() - 60_000).toISOString() },
});
t.ok('a closing time in the past is refused', r.status === 400, `${r.status}`);
r = await send(a.token, { type: 'text', body: 'sneaky', poll: { options: ['x', 'y'] } });
t.ok('a text message cannot smuggle poll options', r.status === 400, `${r.status}`);

/* ── voting ───────────────────────────────────────────────────────────── */

r = await vote(b.token, poll.id, [pizza]);
t.ok('a member can vote', r.status === 200 && r.json.message?.poll?.options?.[0]?.count === 1, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
t.ok('and sees their own vote', r.json.message?.poll?.myVotes?.join() === pizza, JSON.stringify(r.json.message?.poll?.myVotes));
t.ok('with their name on it', r.json.message?.poll?.options?.[0]?.voters?.includes(b.id), JSON.stringify(r.json.message?.poll?.options?.[0]));

r = await vote(b.token, poll.id, [pizza]);
t.ok('voting again changes nothing', r.json.message?.poll?.options?.[0]?.count === 1, JSON.stringify(r.json.message?.poll?.options));

r = await vote(b.token, poll.id, [tacos]);
const afterChange = r.json.message?.poll?.options || [];
t.ok('a vote can be changed', afterChange[0]?.count === 0 && afterChange[1]?.count === 1, JSON.stringify(afterChange));

r = await vote(b.token, poll.id, [pizza, tacos]);
t.ok('a single-choice poll takes one answer', r.status === 400, `${r.status}`);
r = await vote(b.token, poll.id, ['nope']);
t.ok('an option from nowhere is refused', r.status === 400, `${r.status}`);

r = await vote(c.token, poll.id, [ramen]);
t.ok('others count separately', r.json.message?.poll?.totalVoters === 2, JSON.stringify(r.json.message?.poll));
t.ok('and do not see anyone else’s vote as theirs', r.json.message?.poll?.myVotes?.join() === ramen, JSON.stringify(r.json.message?.poll?.myVotes));

r = await vote(c.token, poll.id, []);
t.ok('an empty set is an unvote', r.json.message?.poll?.options?.[2]?.count === 0 && r.json.message?.poll?.myVotes?.length === 0, JSON.stringify(r.json.message?.poll));

r = await vote(outsider.token, poll.id, [pizza]);
t.ok('someone outside the chat cannot vote', r.status === 404 || r.status === 403, `${r.status}`);

/* ── editing the question ─────────────────────────────────────────────── */

r = await api(`/messages/${poll.id}`, { method: 'PATCH', token: a.token, body: { body: 'Skip dinner?' } });
t.ok('the question is fixed once people have voted', r.status === 409, `${r.status}`);

r = await send(a.token, { type: 'poll', body: 'Tyop?', poll: { options: ['x', 'y'] } });
const fresh = r.json.message;
r = await api(`/messages/${fresh.id}`, { method: 'PATCH', token: a.token, body: { body: 'Typo?' } });
t.ok('but can be fixed before anyone has', r.status === 200 && r.json.message?.body === 'Typo?', `${r.status} ${r.json.message?.body}`);

/* ── multiple choice ──────────────────────────────────────────────────── */

r = await send(a.token, { type: 'poll', body: 'Which days work?', poll: { options: ['Fri', 'Sat', 'Sun'], multiple: true } });
const multi = r.json.message;
const [fri, sat] = multi.poll.options.map((o) => o.id);
t.ok('a multiple-choice poll says so', multi.poll.multiple === true);

r = await vote(b.token, multi.id, [fri, sat]);
const mp = r.json.message?.poll;
t.ok('it takes several answers', mp?.options?.[0]?.count === 1 && mp?.options?.[1]?.count === 1, JSON.stringify(mp?.options));
t.ok('while counting the person once', mp?.totalVoters === 1, `${mp?.totalVoters}`);
r = await vote(b.token, multi.id, [sat]);
t.ok('and dropping one keeps the other', r.json.message?.poll?.options?.[0]?.count === 0 && r.json.message?.poll?.options?.[1]?.count === 1, JSON.stringify(r.json.message?.poll?.options));

/* ── anonymous ────────────────────────────────────────────────────────── */

r = await send(a.token, { type: 'poll', body: 'Honest opinion?', poll: { options: ['Good', 'Bad'], anonymous: true } });
const anon = r.json.message;
r = await vote(b.token, anon.id, [anon.poll.options[1].id]);
t.ok('the voter still sees their own choice', r.json.message?.poll?.myVotes?.length === 1, JSON.stringify(r.json.message?.poll?.myVotes));
t.ok('but not their own name on the option', r.json.message?.poll?.options?.[1]?.voters?.length === 0, JSON.stringify(r.json.message?.poll?.options));

const history = (await api(`/messages/${gid}`, { token: a.token })).json.messages || [];
const seenByCreator = history.find((m) => m.id === anon.id)?.poll;
t.ok('the creator sees the count', seenByCreator?.options?.[1]?.count === 1, JSON.stringify(seenByCreator));
t.ok('and not who voted', seenByCreator?.options?.every((o) => o.voters.length === 0), JSON.stringify(seenByCreator?.options));
t.ok('not even by leaking it into myVotes', seenByCreator?.myVotes?.length === 0, JSON.stringify(seenByCreator?.myVotes));

/* ── closing ──────────────────────────────────────────────────────────── */

r = await api(`/messages/${poll.id}/poll/close`, { method: 'POST', token: b.token });
t.ok('only the asker can close a poll', r.status === 403, `${r.status}`);
r = await api(`/messages/${poll.id}/poll/close`, { method: 'POST', token: a.token });
t.ok('the asker can', r.status === 200 && r.json.message?.poll?.closed === true, `${r.status} ${JSON.stringify(r.json.message?.poll)}`);
t.ok('and the results survive it', r.json.message?.poll?.options?.[1]?.count === 1, JSON.stringify(r.json.message?.poll?.options));
r = await vote(c.token, poll.id, [pizza]);
t.ok('a closed poll takes no votes', r.status === 409, `${r.status}`);
r = await vote(b.token, poll.id, []);
t.ok('nor unvotes', r.status === 409, `${r.status}`);

r = await send(a.token, {
  type: 'poll',
  body: 'Until tomorrow?',
  poll: { options: ['x', 'y'], closesAt: new Date(Date.now() + 86_400_000).toISOString() },
});
t.ok('a future closing time is kept', r.status === 201 && Boolean(r.json.message?.poll?.closesAt) && r.json.message?.poll?.closed === false, `${r.status} ${JSON.stringify(r.json.message?.poll)}`);

/* ── unsent ───────────────────────────────────────────────────────────── */

await api(`/messages/${multi.id}?scope=everyone`, { method: 'DELETE', token: a.token });
r = await vote(c.token, multi.id, [fri]);
t.ok('an unsent poll takes no votes', r.status === 410, `${r.status}`);

/* ── lists ────────────────────────────────────────────────────────────── */

r = await send(a.token, { type: 'list', body: 'Bring to the picnic', list: { items: ['Blanket'] } });
t.ok('a list can be created', r.status === 201 && r.json.message?.list?.items?.length === 1, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const list = r.json.message;
const blanket = list?.list?.items?.[0]?.id;

r = await send(a.token, { type: 'list', body: '', list: { items: [] } });
t.ok('a list needs a title', r.status === 400, `${r.status}`);

r = await vote(b.token, list.id, []);
t.ok('a list is not a poll', r.status === 400, `${r.status}`);

const add = (token, text) => api(`/messages/${list.id}/list/items`, { method: 'POST', token, body: { text } });
r = await add(b.token, 'Lemonade');
t.ok('any member can add an item', r.status === 201 && r.json.message?.list?.items?.length === 2, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
const lemonade = r.json.message?.list?.items?.[1]?.id;
t.ok('and it is theirs', r.json.message?.list?.items?.[1]?.addedBy === b.id, JSON.stringify(r.json.message?.list?.items?.[1]));

r = await add(c.token, 'Cups');
const cups = r.json.message?.list?.items?.[2]?.id;
r = await add(b.token, '   ');
t.ok('a blank item is refused', r.status === 400, `${r.status}`);

r = await api(`/messages/${list.id}/list/items/${lemonade}`, { method: 'PATCH', token: c.token, body: { checked: true } });
t.ok('anyone can tick an item', r.json.message?.list?.items?.[1]?.checkedBy === c.id, JSON.stringify(r.json.message?.list?.items?.[1]));
r = await api(`/messages/${list.id}/list/items/${lemonade}`, { method: 'PATCH', token: b.token, body: { checked: false } });
t.ok('and untick it', r.json.message?.list?.items?.[1]?.checkedBy === null, JSON.stringify(r.json.message?.list?.items?.[1]));

r = await api(`/messages/${list.id}/list/items/${lemonade}`, { method: 'DELETE', token: c.token });
t.ok('nobody removes someone else’s item', r.status === 403, `${r.status}`);
r = await api(`/messages/${list.id}/list/items/${blanket}`, { method: 'DELETE', token: c.token });
t.ok('not even the creator’s', r.status === 403, `${r.status}`);
r = await api(`/messages/${list.id}/list/items/${lemonade}`, { method: 'DELETE', token: b.token });
t.ok('but you can remove your own', r.status === 200 && r.json.message?.list?.items?.length === 2, `${r.status}`);
r = await api(`/messages/${list.id}/list/items/${cups}`, { method: 'DELETE', token: a.token });
t.ok('and the list’s creator can remove anything', r.status === 200 && r.json.message?.list?.items?.length === 1, `${r.status}`);

// A list someone else started: the group admin may still tidy it.
r = await send(b.token, { type: 'list', body: 'Chores', list: { items: [] } });
const chores = r.json.message;
r = await api(`/messages/${chores.id}/list/items`, { method: 'POST', token: c.token, body: { text: 'Dishes' } });
const dishes = r.json.message?.list?.items?.[0]?.id;
r = await api(`/messages/${chores.id}/list/items/${dishes}`, { method: 'DELETE', token: a.token });
t.ok('a group admin can remove any item', r.status === 200 && r.json.message?.list?.items?.length === 0, `${r.status}`);

r = await api(`/messages/${list.id}/list/items`, { method: 'POST', token: outsider.token, body: { text: 'Crash the party' } });
t.ok('someone outside the chat cannot add', r.status === 404 || r.status === 403, `${r.status}`);
r = await api(`/messages/${list.id}/list/items/${blanket}`, { method: 'PATCH', token: outsider.token, body: { checked: true } });
t.ok('or tick', r.status === 404 || r.status === 403, `${r.status}`);

r = await api(`/messages/${list.id}/forward`, { method: 'POST', token: a.token, body: { conversationIds: [gid] } });
t.ok('a list cannot be forwarded into an empty copy', r.status === 400, `${r.status}`);

process.exit(t.done() ? 1 : 0);
