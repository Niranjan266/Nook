/**
 * Runs the schema at boot.
 *
 * Every statement is `CREATE ... IF NOT EXISTS`, so this is safe to run on
 * every start — first boot creates everything, later boots are a no-op. That
 * removes a whole class of "did you run the migration?" deployment failure.
 *
 * Statements are executed one at a time rather than as a batch because libSQL
 * batches are transactional, and SQLite will not create a virtual table (FTS5)
 * inside a transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, usingTurso } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Split on semicolons, but not the ones inside a CREATE TRIGGER body. */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inTrigger = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      if (!current.trim()) continue;
    }

    current += line + '\n';

    if (/^\s*CREATE\s+TRIGGER/i.test(current) && !inTrigger) inTrigger = true;

    if (inTrigger) {
      if (/^\s*END\s*;\s*$/i.test(trimmed)) {
        statements.push(current.trim());
        current = '';
        inTrigger = false;
      }
      continue;
    }

    if (trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.replace(/--.*$/gm, '').trim().length > 1);
}

/**
 * Errors that mean "this statement has already been applied".
 *
 * `CREATE ... IF NOT EXISTS` handles most of it, but SQLite has no
 * `ADD COLUMN IF NOT EXISTS`. Adding a column to a table that already has it
 * raises "duplicate column name: x" — which is not a failure, it is the
 * migration being run a second time. Without this the server would boot once
 * and then refuse to start ever again, which is a spectacularly bad way to
 * find out you shipped a schema change.
 */
const ALREADY_APPLIED = [
  /already exists/i,
  /duplicate column name/i,
];

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);

  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await db().execute(statement);
      applied += 1;
    } catch (err) {
      if (ALREADY_APPLIED.some((re) => re.test(err.message))) {
        skipped += 1;
        continue;
      }
      console.error('\n  db        migration failed on:\n');
      console.error(statement.split('\n').slice(0, 3).join('\n'));
      throw err;
    }
  }

  const where = usingTurso() ? 'Turso' : 'local file';
  const note = skipped ? `${applied} applied, ${skipped} already present` : `${applied} statements`;
  console.log(`  db        schema ready (${note}) → ${where}`);
}

/**
 * FTS5 mirrors the messages table through triggers, but a database created
 * before the triggers existed — or one restored from a dump — can be out of
 * sync. Rebuilding is cheap at this size and makes search reliable.
 */
export async function rebuildSearchIndex() {
  try {
    await db().execute(`INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')`);
  } catch {
    /* not fatal: search degrades, nothing breaks */
  }
}
