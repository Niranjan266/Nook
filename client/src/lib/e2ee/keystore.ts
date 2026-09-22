/**
 * Where this device keeps its secret-chat keys: IndexedDB, per account.
 *
 * Deliberately NOT under the `nook.<user>.` prefix the message cache uses.
 * Sign-out clears that prefix, which is right for a cache and wrong for keys:
 * a forced sign-out (an expired session, a password change elsewhere) would
 * otherwise destroy every secret chat on the phone, with nothing to restore it
 * from. Keys stay with the device and the account until the backup feature or
 * the person moves them.
 *
 * Reads here are never time-boxed to a fallback the way the cache's are. A
 * slow IndexedDB that "returned nothing" would look like a fresh device, and a
 * fresh device makes new keys — silently replacing the identity every secret
 * chat was built on. Failing loudly is the safe outcome.
 */
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';
import { cacheScope } from '@/lib/outbox';
import { generateDeviceKeys, type DeviceKeys, type Session } from './crypto';

interface StoredDevice {
  deviceId: string;
  keys: DeviceKeys;
  createdAt: number;
}

const prefix = () => `nook-e2ee.${cacheScope()}.`;
const DEVICE = () => `${prefix()}device`;
const SESSION = (conversationId: string) => `${prefix()}session.${conversationId}`;

/** Base64url, 16 random bytes: unguessable, and fits the server's pattern. */
function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let creating: Promise<StoredDevice> | null = null;

export async function loadDevice(): Promise<StoredDevice | null> {
  if (cacheScope() === 'anon') return null;
  return ((await idbGet<StoredDevice>(DEVICE())) as StoredDevice | undefined) || null;
}

/** This device's identity, made on first use. One creation at a time. */
export async function getOrCreateDevice(): Promise<StoredDevice> {
  if (cacheScope() === 'anon') throw new Error('Sign in first.');
  const existing = await loadDevice();
  if (existing) return existing;
  if (!creating) {
    creating = (async () => {
      const device: StoredDevice = { deviceId: newDeviceId(), keys: await generateDeviceKeys(), createdAt: Date.now() };
      await idbSet(DEVICE(), device);
      return device;
    })().finally(() => {
      creating = null;
    });
  }
  return creating;
}

export async function loadSession(conversationId: string): Promise<Session | null> {
  return ((await idbGet<Session>(SESSION(conversationId))) as Session | undefined) || null;
}

export async function saveSession(session: Session) {
  await idbSet(SESSION(session.conversationId), session);
}

export async function deleteSession(conversationId: string) {
  await idbDel(SESSION(conversationId));
}

async function allSessions(): Promise<Record<string, Session>> {
  const start = `${prefix()}session.`;
  const out: Record<string, Session> = {};
  for (const key of await idbKeys()) {
    if (typeof key !== 'string' || !key.startsWith(start)) continue;
    const s = (await idbGet<Session>(key)) as Session | undefined;
    if (s) out[key.slice(start.length)] = s;
  }
  return out;
}

/* ── backup contract ──────────────────────────────────────────────────────
   Called by the backup feature. The shapes are part of a contract with it,
   so they change only with a version bump.                                 */

/**
 * Everything needed to bring this device's secret chats back on a new
 * install: the identity and signing key pairs (private halves included —
 * this is what a backup is for, so it must itself be encrypted before it
 * leaves the device) and every chat's ratchet state.
 */
export async function exportKeyBundle(): Promise<{ version: 1; deviceId: string; keys: unknown; sessions: unknown }> {
  const device = await getOrCreateDevice();
  return {
    version: 1,
    deviceId: device.deviceId,
    keys: { ...device.keys, createdAt: device.createdAt },
    sessions: await allSessions(),
  };
}

const isJwkPair = (p: any) =>
  p && typeof p === 'object' && p.publicJwk?.kty === 'EC' && typeof p.privateJwk?.d === 'string';

/**
 * Restore a bundle made by `exportKeyBundle`, replacing this device's
 * identity with the one it carries.
 *
 * Sessions are replaced wholesale. A restored session may be older than the
 * chat — messages sent after the backup — and that is handled where messages
 * are opened: incoming ones simply walk the chain forward, and the sending
 * chain is fast-forwarded past anything this device already sent.
 */
export async function importKeyBundle(bundle: any): Promise<void> {
  if (!bundle || bundle.version !== 1) throw new Error('That key bundle is not one this version understands.');
  if (typeof bundle.deviceId !== 'string' || !bundle.deviceId) throw new Error('That key bundle has no device.');
  const keys = bundle.keys as any;
  if (!isJwkPair(keys?.identity) || !isJwkPair(keys?.signing)) throw new Error('That key bundle is missing keys.');
  if (cacheScope() === 'anon') throw new Error('Sign in first.');

  await idbSet(DEVICE(), {
    deviceId: bundle.deviceId,
    keys: { identity: keys.identity, signing: keys.signing },
    createdAt: Number(keys.createdAt) || Date.now(),
  } satisfies StoredDevice);

  const sessions = (bundle.sessions && typeof bundle.sessions === 'object' ? bundle.sessions : {}) as Record<string, Session>;
  for (const [conversationId, session] of Object.entries(sessions)) {
    if (session?.v === 1 && session.conversationId === conversationId) await saveSession(session);
  }

  // Tell the server this device (and its keys) is back. Best effort: the app
  // publishes again on every start, so a failure here heals itself.
  const { publishDevice } = await import('./secret');
  await publishDevice(true).catch(() => {});
}
