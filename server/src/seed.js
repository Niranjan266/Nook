/**
 * Demo data, so you can open two browsers and actually talk to yourself.
 *
 *   npm run seed          → seeds whatever database is configured
 *   (automatic)           → also runs at boot when the database is empty
 *
 * Accounts:  ada · river · kofi · mira   —  password: nookdemo1
 */
import { hash as hashPassword } from './services/password.js';
import { all, one, run, newId, closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import * as U from './db/users.js';
import * as C from './db/conversations.js';
import * as M from './db/messages.js';

export const DEMO_PASSWORD = 'nookdemo1';

const PEOPLE = [
  { username: 'ada', displayName: 'Ada Roy', about: 'Two coffees deep.', accent: 'terracotta' },
  { username: 'river', displayName: 'River Sen', about: 'Out walking.', accent: 'moss' },
  { username: 'kofi', displayName: 'Kofi Mensah', about: 'Building something small.', accent: 'ochre' },
  { username: 'mira', displayName: 'Mira Vale', about: 'Quiet hours 10pm–7am.', accent: 'clay-blue' },
];

const CHAT = [
  ['ada', 'did the roof guy ever call you back'],
  ['river', 'he did. wednesday, between 9 and 12, which means 4pm'],
  ['ada', 'classic'],
  ['river', "i'll be home anyway. bring the ladder back?"],
  ['ada', 'in the car already'],
  ['river', 'you are a good person and i will tell people'],
];

const GROUP_CHAT = [
  ['kofi', 'friday still on?'],
  ['mira', 'yes but i can only do early'],
  ['ada', '7 works. i booked the corner table, the loud one is fine'],
  ['river', "i'll bring the thing"],
  ['kofi', 'the thing?'],
  ['river', 'you will know it when you see it'],
];

export async function isEmpty() {
  const row = await one('SELECT COUNT(*) AS n FROM users');
  return (row?.n || 0) === 0;
}

export async function seedDemoData({ quiet = false } = {}) {
  const log = (...args) => !quiet && console.log(...args);

  // Start clean if these accounts already exist.
  const existing = await all(
    `SELECT id FROM users WHERE username IN ('ada', 'river', 'kofi', 'mira')`
  );
  for (const row of existing) await run('DELETE FROM users WHERE id = ?', [row.id]);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = {};
  for (const person of PEOPLE) {
    users[person.username] = await U.createUser({ ...person, passwordHash });
  }

  // Everyone knows everyone.
  const ids = Object.values(users).map((u) => u.id);
  for (const user of Object.values(users)) {
    for (const id of ids) if (id !== user.id) await U.addContact(user.id, id);
  }

  /* ── a direct chat, with a wallpaper already set ─────────────────────── */

  const direct = await C.createConversation({
    type: 'direct',
    members: [users.ada.id, users.river.id],
    wallpaper: { preset: 'dusk-clay', dim: 0.32, tint: '#C0603C', setBy: users.river.id },
  });

  let lastId;
  let t = Date.now() - CHAT.length * 90_000;
  for (const [from, body] of CHAT) {
    t += 90_000;
    const other = from === 'ada' ? 'river' : 'ada';
    lastId = await M.createMessageRow({
      conversationId: direct.id,
      senderId: users[from].id,
      type: 'text',
      body,
      createdAt: t,
    });
    await M.markDelivered(lastId, [users[other].id]);
    await M.markRead([lastId], users[other].id);
  }
  await C.updateConversation(direct.id, { lastMessageId: lastId, lastActivity: t });

  /* ── a group ─────────────────────────────────────────────────────────── */

  const group = await C.createConversation({
    type: 'group',
    name: 'Friday Plans',
    description: 'Four people, one restaurant, endless negotiation.',
    createdBy: users.kofi.id,
    inviteCode: 'friday24',
    members: [
      { user: users.kofi.id, role: 'admin' },
      { user: users.ada.id },
      { user: users.river.id },
      { user: users.mira.id },
    ],
    wallpaper: { preset: 'moss-paper', dim: 0.4, tint: '#57694A', setBy: users.kofi.id },
  });

  t = Date.now() - GROUP_CHAT.length * 120_000;
  for (const [from, body] of GROUP_CHAT) {
    t += 120_000;
    lastId = await M.createMessageRow({
      conversationId: group.id,
      senderId: users[from].id,
      type: 'text',
      body,
      createdAt: t,
    });
  }
  await C.updateConversation(group.id, { lastMessageId: lastId, lastActivity: t });

  for (const username of ['ada', 'river', 'mira']) {
    await C.updateMemberPrefs(group.id, users[username].id, { unread: 2 });
  }

  log('');
  log('  demo      four accounts ready, password "nookdemo1":');
  log(`              ${PEOPLE.map((p) => p.username).join('  ·  ')}`);
  log('              Sign in as "ada" here and "river" in an incognito window.');
  log('');

  return { users, direct, group };
}

/** Only run standalone when invoked directly (npm run seed). */
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.js');

if (invokedDirectly) {
  await migrate();
  await seedDemoData();
  await closeDb();
  process.exit(0);
}
