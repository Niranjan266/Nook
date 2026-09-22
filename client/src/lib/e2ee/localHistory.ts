/**
 * The readable copy of secret messages, kept on this device only.
 *
 * The server holds ciphertext whose keys are erased the moment a message is
 * opened — that is what forward secrecy costs — so without a local copy a
 * reload would turn the whole chat back into noise. The copy lives in
 * IndexedDB under this account, beside the keys and for the same reason not
 * under the cache prefix that sign-out clears.
 *
 * A disappearing timer applies here too: an entry past its `expiresAt` is
 * dropped when read, so a message the server swept does not live on in the
 * one place nobody would think to look.
 */
import { get as idbGet, set as idbSet, keys as idbKeys } from 'idb-keyval';
import { cacheScope } from '@/lib/outbox';

/** What is inside the ciphertext: the message as its sender wrote it. */
export interface SecretInner {
  /** text | image | video | audio | voice | file */
  t: string;
  /** Text, or a caption. */
  b?: string;
  /** An encrypted attachment: where the ciphertext is, and how to open it. */
  m?: {
    url: string;
    key: string;
    iv: string;
    mime?: string;
    name?: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    waveform?: number[];
  };
  /** A voice note's transcript, made on the sender's device. */
  tr?: string;
  /** The message being replied to, quoted inside the ciphertext. */
  r?: { id: string; b?: string; t?: string; n?: string };
}

export interface SecretEntry {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string;
  inner: SecretInner;
  createdAt: string;
  expiresAt?: string | null;
}

type Book = Record<string, SecretEntry>;

const prefix = () => `nook-e2ee.${cacheScope()}.history.`;
const KEY = (conversationId: string) => `${prefix()}${conversationId}`;

const expired = (e: SecretEntry, now = Date.now()) => Boolean(e.expiresAt && new Date(e.expiresAt).getTime() <= now);

/** One writer per conversation, so two arrivals cannot overwrite each other's entry. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(conversationId) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(conversationId, next.catch(() => {}));
  return next;
}

async function readBook(conversationId: string): Promise<Book> {
  return ((await idbGet<Book>(KEY(conversationId))) as Book | undefined) || {};
}

export async function readHistory(conversationId: string): Promise<Book> {
  const book = await readBook(conversationId);
  const now = Date.now();
  const stale = Object.values(book).filter((e) => expired(e, now));
  if (stale.length) {
    await serial(conversationId, async () => {
      const fresh = await readBook(conversationId);
      for (const e of stale) {
        delete fresh[e.id];
        if (e.clientId) delete fresh[`c:${e.clientId}`];
      }
      await idbSet(KEY(conversationId), fresh);
    });
    for (const e of stale) delete book[e.id];
  }
  return book;
}

/** Find by server id, or by the clientId a message had before the server named it. */
export async function findEntry(conversationId: string, id: string, clientId?: string) {
  const book = await readHistory(conversationId);
  const hit = book[id] || (clientId ? book[`c:${clientId}`] : undefined);
  return hit && !expired(hit) ? hit : null;
}

/**
 * Keep one entry. Stored under its server id, and — for our own messages,
 * which exist before the server has named them — under its clientId too.
 */
export function putEntry(entry: SecretEntry) {
  return serial(entry.conversationId, async () => {
    const book = await readBook(entry.conversationId);
    book[entry.id] = entry;
    if (entry.clientId) book[`c:${entry.clientId}`] = entry;
    await idbSet(KEY(entry.conversationId), book);
  });
}

export function dropEntry(conversationId: string, id: string) {
  return serial(conversationId, async () => {
    const book = await readBook(conversationId);
    const e = book[id];
    delete book[id];
    if (e?.clientId) delete book[`c:${e.clientId}`];
    await idbSet(KEY(conversationId), book);
  });
}

/* ── backup contract ──────────────────────────────────────────────────────
   Called by the backup feature. The decrypted text of every secret chat on
   this device — which is exactly why a backup must be encrypted itself.    */

export async function exportSecretHistory(): Promise<unknown> {
  const start = prefix();
  const conversations: Record<string, SecretEntry[]> = {};
  for (const key of await idbKeys()) {
    if (typeof key !== 'string' || !key.startsWith(start)) continue;
    const conversationId = key.slice(start.length);
    const book = await readHistory(conversationId);
    // Each entry once: the clientId aliases point at the same objects.
    const entries = Object.entries(book)
      .filter(([k]) => !k.startsWith('c:'))
      .map(([, e]) => e);
    if (entries.length) conversations[conversationId] = entries;
  }
  return { version: 1, conversations };
}

export async function importSecretHistory(data: any): Promise<void> {
  if (!data || data.version !== 1 || typeof data.conversations !== 'object')
    throw new Error('That history is not one this version understands.');
  for (const [conversationId, entries] of Object.entries(data.conversations as Record<string, SecretEntry[]>)) {
    if (!Array.isArray(entries)) continue;
    await serial(conversationId, async () => {
      // Merged, not replaced: anything this device already has stays.
      const book = await readBook(conversationId);
      for (const e of entries) {
        if (!e || typeof e.id !== 'string' || !e.inner || expired(e)) continue;
        const entry = { ...e, conversationId };
        if (!book[e.id]) book[e.id] = entry;
        if (e.clientId && !book[`c:${e.clientId}`]) book[`c:${e.clientId}`] = entry;
      }
      await idbSet(KEY(conversationId), book);
    });
  }
}
