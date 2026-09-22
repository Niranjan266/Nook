/**
 * Offline outbox. Anything you send while disconnected is parked in IndexedDB
 * and replayed in order the moment the socket comes back.
 */
import { get as idbGet, set as idbSet, keys as idbKeys, delMany as idbDelMany } from 'idb-keyval';

/**
 * IndexedDB can hang rather than fail: a deleted-while-open database, a private
 * window, a full quota. An await that never settles is worse than an error —
 * it silently stalls whatever depends on it. Every read here is time-boxed and
 * every write is fire-and-forget, so the cache can only ever make things
 * faster, never slower.
 */
const TIMEOUT = 1500;

function guard<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT)),
  ]);
}

const get = <T,>(key: string, fallback: T) => guard(idbGet<T>(key) as Promise<T>, fallback);
const set = (key: string, value: unknown) => {
  idbSet(key, value).catch(() => {});
};

export interface PollDraft {
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  closesAt?: string | null;
}

export interface Outgoing {
  clientId: string;
  conversationId: string;
  type: string;
  body?: string;
  media?: any;
  replyTo?: string | null;
  viewOnce?: boolean;
  /**
   * Seconds the recipient gets, 0 meaning "until they close it".
   *
   * It has to live on the queued payload too: a snap sent while offline is
   * replayed from here, and without this the timer the sender chose would be
   * quietly replaced by the server default on every retry.
   */
  viewSeconds?: number;
  /** A voice note's transcript, which a replay would otherwise lose. */
  transcript?: string;
  /** A poll's options and settings, or a list's first items — see sendPayload.js. */
  poll?: PollDraft;
  list?: { items: string[] };
  queuedAt: number;
}

/**
 * Every cache key is scoped to the signed-in account.
 *
 * Without this, signing in as someone else — or reconnecting to a server whose
 * data has been reset — leaves the previous account's conversations in
 * IndexedDB. They render, they look real, and tapping one opens a dead end
 * because the id no longer exists anywhere.
 */
let scope = 'anon';
export function setCacheScope(userId: string | null) {
  scope = userId || 'anon';
}

/**
 * Sign-out: drop everything this account cached, outbox included. On a shared
 * computer the next person should not find the last one's messages sitting in
 * IndexedDB, nor have the last one's unsent messages go out on their behalf.
 */
export function clearCacheScope() {
  const prefix = `nook.${scope}.`;
  idbKeys()
    .then((all) => idbDelMany(all.filter((k) => typeof k === 'string' && k.startsWith(prefix))))
    .catch(() => {});
  scope = 'anon';
}

const KEY = () => `nook.${scope}.outbox`;

export async function readOutbox(): Promise<Outgoing[]> {
  return (await get<Outgoing[]>(KEY(), [])) || [];
}

export async function enqueue(item: Outgoing) {
  const list = await readOutbox();
  list.push(item);
  set(KEY(), list);
}

export async function dequeue(clientId: string) {
  const list = await readOutbox();
  set(
    KEY(),
    list.filter((i) => i.clientId !== clientId)
  );
}

export async function clearOutbox() {
  set(KEY(), []);
}

/** Cache the last N messages per conversation so a cold start is instant. */
const cacheKey = (conversationId: string) => `nook.${scope}.msgs.${conversationId}`;

export function cacheMessages(conversationId: string, messages: unknown[]) {
  set(cacheKey(conversationId), messages.slice(-60));
}

export async function readCached<T = unknown>(conversationId: string): Promise<T[]> {
  return (await get<T[]>(cacheKey(conversationId), [])) || [];
}

export function cacheConversations(list: unknown[]) {
  set(`nook.${scope}.convos`, list);
}

export async function readCachedConversations<T = unknown>(): Promise<T[]> {
  return (await get<T[]>(`nook.${scope}.convos`, [])) || [];
}
