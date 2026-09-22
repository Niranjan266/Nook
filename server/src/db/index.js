/**
 * libSQL / Turso connection.
 *
 * With no credentials this opens a local SQLite file — real, persistent data
 * with no signup and no network. That is a genuine improvement on the old
 * in-memory Mongo fallback, which downloaded a 100 MB binary and threw the
 * data away on every restart.
 *
 * With TURSO_DATABASE_URL set it connects to Turso instead. Same code, same
 * SQL, same behaviour.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;

export function db() {
  if (client) return client;

  if (env.turso.url) {
    client = createClient({ url: env.turso.url, authToken: env.turso.authToken });
  } else {
    const dir = path.resolve(__dirname, '../../data');
    fs.mkdirSync(dir, { recursive: true });
    client = createClient({ url: `file:${path.join(dir, 'nook.db')}` });
  }

  /**
   * A local SQLite file is locked for the instant of each write, and a second
   * writer — the send-later tick racing a request, or a test touching the
   * file beside the server — fails outright with SQLITE_BUSY. Five seconds of
   * waiting turns that into a pause. Turso is a server and handles its own.
   */
  if (String(client.url || env.turso.url || 'file:').startsWith('file:')) {
    ready = client.execute('PRAGMA busy_timeout = 5000').catch(() => {});
  }

  return client;
}

/** Settles once per-connection setup has run; queries wait for it. */
let ready = Promise.resolve();

export const usingTurso = () => Boolean(env.turso.url);

/* ── query helpers ────────────────────────────────────────────────────────
   Every call goes through these, so parameters are always bound and never
   interpolated. No string-built SQL anywhere in the codebase.             */

export async function all(sql, args = []) {
  const c = db();
  await ready;
  const result = await c.execute({ sql, args });
  return result.rows.map(normalise);
}

export async function one(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}

export async function run(sql, args = []) {
  const c = db();
  await ready;
  return c.execute({ sql, args });
}

/** Several statements, all-or-nothing. */
export async function tx(statements) {
  const c = db();
  await ready;
  return c.batch(statements, 'write');
}

/**
 * libSQL returns row objects with a null prototype and BigInt for integers.
 * Both surprise downstream code — `JSON.stringify` throws on a BigInt — so
 * normalise once, here, rather than defensively everywhere else.
 */
function normalise(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

/* ── small shared utilities ───────────────────────────────────────────── */

/**
 * 24-character hex ids, matching Mongo's ObjectId shape.
 *
 * Kept deliberately: ids appear in cached client data, in URLs and in the
 * offline store. Switching to UUIDs would invalidate all of it for no benefit.
 * The leading 8 hex chars are a timestamp, so ids still sort roughly by age.
 */
export function newId() {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  return time + crypto.randomBytes(8).toString('hex');
}

export const now = () => Date.now();

/** JSON columns: never throw on bad data, just fall back. */
export function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const toJson = (value) => JSON.stringify(value ?? null);

/** SQLite has no boolean type. */
export const bool = (v) => (v ? 1 : 0);
export const fromBool = (v) => Boolean(v);

/** Build a `?, ?, ?` placeholder list for an IN clause. */
export const placeholders = (list) => list.map(() => '?').join(', ');

export async function closeDb() {
  try {
    client?.close?.();
  } catch {
    /* already closed */
  }
  client = null;
}
