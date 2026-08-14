/**
 * Turn an admin password into a bcrypt hash for ADMIN_PASSWORD_HASH.
 *
 * The plain password is never stored anywhere — not in .env, not in Render,
 * not in this repo. Only the hash is, and a hash cannot be turned back into
 * the password. That matters because environment variables are visible to
 * anyone with dashboard access and turn up in screenshots and screen shares.
 *
 *     node tools/admin-hash.mjs
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let bcrypt;
try {
  bcrypt = require('../server/node_modules/bcryptjs');
} catch {
  console.log('\n  Install the server dependencies first:  npm --prefix server install\n');
  process.exit(1);
}

const line = (s = '') => console.log(s);

line();
line('  ╭──────────────────────────────────────────────╮');
line('  │  Nook — admin password                       │');
line('  ╰──────────────────────────────────────────────╯');
line();

const rl = readline.createInterface({ input, output });
const username = (await rl.question('  Admin username : ')).trim();
const password = (await rl.question('  Admin password : ')).trim();
rl.close();

if (!username || password.length < 8) {
  line('\n  Username required, and the password needs at least 8 characters.\n');
  process.exit(1);
}

// Cost 12: a few hundred milliseconds per attempt, which is nothing for one
// sign-in and ruinous for anyone trying millions.
const hash = bcrypt.hashSync(password, 12);

line();
line('  ── Put these in Render, and in server/.env for local use ────');
line();
line(`  ADMIN_USERNAME=${username}`);
line(`  ADMIN_PASSWORD_HASH=${hash}`);
line();
line('  ─────────────────────────────────────────────────────────────');
line();
line('  The password itself is not stored anywhere. If you forget it,');
line('  run this again and replace the hash.');
line();
