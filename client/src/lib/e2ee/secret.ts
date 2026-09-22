/**
 * Secret chats, joined up: device publishing, the handshake, sealing outgoing
 * messages and opening incoming ones.
 *
 * The rules this file keeps:
 *
 *  - Private keys and chain keys go from the keystore into crypto.ts and back
 *    into the keystore. Nothing here sends them anywhere.
 *  - One conversation's ratchet is touched by one operation at a time. Two
 *    messages opened concurrently would both read counter n and one of them
 *    would be lost for good, because its key is erased by the other.
 *  - Session state is saved *before* a ciphertext leaves the device, so a
 *    counter is never used twice, and a readable copy is saved *before* the
 *    session advances past a received message, so a crash cannot leave a
 *    message whose key is gone and whose text was never kept.
 */
import { get as apiGet, post } from '@/lib/api';
import type { Conversation, Message, MessageType, SecretInfo } from '@/lib/types';
import * as K from './keystore';
import * as H from './localHistory';
import {
  acceptHandshake,
  createHandshake,
  decryptMessage,
  encryptMessage,
  fastForwardSend,
  parseWire,
  sameKey,
  DecryptError,
  type HandshakeContext,
  type Handshake,
  type Session,
  type Jwk,
} from './crypto';
import type { SecretInner } from './localHistory';

/* ── this device ──────────────────────────────────────────────────────────── */

let published: Promise<void> | null = null;

/**
 * Make this device's keys if it has none, and publish the public halves.
 * Once per app start is enough — it doubles as "this device is still alive",
 * which is what makes it the default partner device for new secret chats.
 */
export function publishDevice(force = false): Promise<void> {
  if (published && !force) return published;
  published = (async () => {
    const d = await K.getOrCreateDevice();
    await post('/e2ee/devices', {
      deviceId: d.deviceId,
      identityPub: d.keys.identity.publicJwk,
      signingPub: d.keys.signing.publicJwk,
    });
  })().catch((err) => {
    published = null; // try again next time rather than never
    throw err;
  });
  return published;
}

export async function myDeviceId(): Promise<string | null> {
  return (await K.loadDevice().catch(() => null))?.deviceId || null;
}

/** Forget the "already published" note, so the next account publishes its own. */
export function resetSecretState() {
  published = null;
  locks.clear();
}

/* ── where a chat lives ───────────────────────────────────────────────────── */

const myEnd = (info: SecretInfo, meId: string) =>
  info.initiator.userId === meId ? info.initiator : info.responder;
export const peerEnd = (info: SecretInfo, meId: string) =>
  info.initiator.userId === meId ? info.responder : info.initiator;

/** Is this secret chat bound to the device in my hand? */
export function boundHere(convo: Conversation, meId: string, deviceId: string | null) {
  if (!convo.secret || !deviceId) return false;
  return myEnd(convo.secret, meId).deviceId === deviceId;
}

const contextOf = (convo: Conversation): HandshakeContext => ({
  conversationId: convo.id,
  initiatorDeviceId: convo.secret!.initiator.deviceId,
  responderDeviceId: convo.secret!.responder.deviceId,
  initiatorIdentityPub: convo.secret!.initiator.identityPub,
  responderIdentityPub: convo.secret!.responder.identityPub,
});

/* ── one operation per conversation ───────────────────────────────────────── */

const locks = new Map<string, Promise<unknown>>();
function locked<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(conversationId) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(conversationId, next.catch(() => {}));
  return next;
}

/* ── the handshake ────────────────────────────────────────────────────────── */

type StoredSession = Session & { pendingHandshake?: Handshake };

/**
 * Start a secret chat with someone, bound to one of their devices — the one
 * they used last unless another is named.
 */
export async function startSecretChat(userId: string, partnerDeviceId?: string): Promise<Conversation> {
  await publishDevice();
  const device = await K.getOrCreateDevice();
  const { conversation } = await post<{ conversation: Conversation }>('/e2ee/secret', {
    userId,
    deviceId: device.deviceId,
    ...(partnerDeviceId ? { partnerDeviceId } : {}),
  });
  if (conversation.secret?.handshake) return conversation; // already running
  return completeHandshake(conversation);
}

/**
 * The creator's half. The session is saved, pending, before the handshake is
 * sent: if the send is lost, the same handshake is re-sent later instead of a
 * new one being made that the partner might have already missed.
 */
async function completeHandshake(convo: Conversation): Promise<Conversation> {
  return locked(convo.id, async () => {
    const device = await K.getOrCreateDevice();
    let session = (await K.loadSession(convo.id)) as StoredSession | null;
    if (!session) {
      const made = await createHandshake(contextOf(convo), {
        identity: device.keys.identity,
        signingPrivate: device.keys.signing.privateJwk,
      });
      session = { ...made.session, pendingHandshake: made.handshake };
      await K.saveSession(session);
    }
    if (!session.pendingHandshake) return convo;

    const { conversation } = await post<{ conversation: Conversation }>(
      `/e2ee/secret/${convo.id}/handshake`,
      session.pendingHandshake
    );
    const { pendingHandshake, ...done } = session;
    await K.saveSession(done);
    return conversation;
  });
}

/**
 * This device's session for a chat, completing whichever half of the
 * handshake is ours if it has not happened yet. Null when the chat belongs
 * to another device, or is still waiting for the creator.
 */
async function sessionFor(convo: Conversation): Promise<StoredSession | null> {
  const existing = (await K.loadSession(convo.id)) as StoredSession | null;
  if (existing && !existing.pendingHandshake) return existing;

  const info = convo.secret;
  const device = await K.loadDevice();
  if (!info || !device) return null;

  // Our own unfinished handshake: finish it, then carry on.
  if (existing?.pendingHandshake) {
    if (info.handshake) {
      const { pendingHandshake, ...done } = existing;
      await K.saveSession(done);
      return done;
    }
    await post(`/e2ee/secret/${convo.id}/handshake`, existing.pendingHandshake);
    const { pendingHandshake, ...done } = existing;
    await K.saveSession(done);
    return done;
  }

  if (info.responder.deviceId !== device.deviceId || !info.handshake) return null;
  // The chat was bound to this device id with a key this device no longer
  // holds — a reinstall that kept the id, say. Deriving would only produce
  // keys that open nothing.
  if (!sameKey(device.keys.identity.publicJwk, info.responder.identityPub)) return null;

  const session = await acceptHandshake(
    contextOf(convo),
    info.handshake,
    { identityPrivate: device.keys.identity.privateJwk },
    info.initiator.signingPub
  );
  await K.saveSession(session);
  return session;
}

export async function hasSession(convo: Conversation) {
  return Boolean(await K.loadSession(convo.id).catch(() => null));
}

/* ── sealing ──────────────────────────────────────────────────────────────── */

/** Encrypt one outgoing message. The returned wire string is what the server stores. */
export function seal(convo: Conversation, inner: SecretInner): Promise<string> {
  return locked(convo.id, async () => {
    const session = await sessionFor(convo);
    if (!session) throw new Error('This secret chat is not set up on this device.');
    const { session: next, wire } = await encryptMessage(session, JSON.stringify(inner));
    await K.saveSession(next);
    return wire;
  });
}

/* ── opening ──────────────────────────────────────────────────────────────── */

function parseInner(plaintext: string): SecretInner {
  const inner = JSON.parse(plaintext);
  if (!inner || typeof inner.t !== 'string') throw new Error('malformed');
  return inner as SecretInner;
}

const INNER_TYPES = new Set(['text', 'image', 'video', 'audio', 'voice', 'file']);

/** The message as the bubble should draw it. */
export function display(m: Message, inner: SecretInner): Message {
  const type = (INNER_TYPES.has(inner.t) ? inner.t : 'text') as MessageType;
  return {
    ...m,
    type,
    body: inner.b || '',
    transcript: inner.tr || '',
    // The remote URL points at ciphertext. The bubble swaps it for a local
    // blob once the file has been fetched and opened with the key below.
    media: inner.m
      ? {
          url: inner.m.url,
          thumbUrl: '',
          mime: inner.m.mime || '',
          name: inner.m.name || '',
          size: inner.m.size || 0,
          width: inner.m.width || 0,
          height: inner.m.height || 0,
          duration: inner.m.duration || 0,
          waveform: inner.m.waveform || [],
        }
      : null,
    replyTo: inner.r ? { id: inner.r.id, body: inner.r.b || '', type: inner.r.t as MessageType, senderName: inner.r.n || 'Them' } : null,
    linkPreview: null,
    secret: {
      state: 'ok',
      media: inner.m ? { key: inner.m.key, iv: inner.m.iv, mime: inner.m.mime || 'application/octet-stream' } : undefined,
      wire: m.type === 'encrypted' ? m.body : m.secret?.wire,
    },
  };
}

const placeholder = (m: Message, state: 'failed' | 'elsewhere' | 'unkept' | 'waiting', note = ''): Message => ({
  ...m,
  type: 'text',
  body: '',
  media: null,
  transcript: '',
  replyTo: null,
  linkPreview: null,
  secret: { state, note, wire: m.type === 'encrypted' ? m.body : undefined },
});

const why = (err: unknown) => {
  if (err instanceof DecryptError) {
    if (err.code === 'tampered') return 'This message was changed on the way, so it was not opened.';
    if (err.code === 'wrong-device') return 'This came from a device this chat is not bound to.';
    if (err.code === 'already-used') return 'This message could not be opened again — its key is gone.';
  }
  return 'This message could not be decrypted.';
};

/**
 * Turn one message from the server into something readable, if this device
 * can. Anything that is not ciphertext passes through untouched.
 */
export async function reveal(convo: Conversation, m: Message, meId: string, deviceId: string | null): Promise<Message> {
  if (m.type !== 'encrypted') return m;
  if (m.deletedForAll || m.deletedForMe || !m.body) {
    // Unsent: nothing to open, and nothing readable should outlive it here.
    if (m.deletedForAll) H.dropEntry(convo.id, m.id).catch(() => {});
    return placeholder(m, 'unkept');
  }

  const kept = await H.findEntry(convo.id, m.id, m.clientId).catch(() => null);
  if (kept) {
    // Our own message, known so far only by its clientId: file it under the
    // id the server gave it, so a later load finds it directly.
    // (Not while it is still optimistic: its id is the clientId then.)
    if (kept.id !== m.id && m.id !== m.clientId)
      H.putEntry({ ...kept, id: m.id, expiresAt: m.expiresAt }).catch(() => {});
    return display(m, kept.inner);
  }

  if (!boundHere(convo, meId, deviceId)) return placeholder(m, 'elsewhere');

  // Our own messages cannot be decrypted after the fact — the sending keys are
  // erased as they are used, which is the point. Without a kept copy, say so.
  if (m.sender.id === meId) return placeholder(m, 'unkept');

  try {
    const inner = await locked(convo.id, async () => {
      const again = await H.findEntry(convo.id, m.id, m.clientId);
      if (again) return again.inner;
      const session = await sessionFor(convo);
      if (!session) throw new Error('no-session');
      const { session: next, plaintext } = await decryptMessage(session, m.body);
      const opened = parseInner(plaintext);
      await H.putEntry({
        id: m.id,
        clientId: m.clientId || undefined,
        conversationId: convo.id,
        senderId: m.sender.id,
        inner: opened,
        createdAt: m.createdAt,
        expiresAt: m.expiresAt,
      });
      await K.saveSession(next);
      return opened;
    });
    return display(m, inner);
  } catch (err: any) {
    if (err?.message === 'no-session') return placeholder(m, 'waiting');
    return placeholder(m, 'failed', why(err));
  }
}

/**
 * A page of history, oldest first. Opened in order so the chain walks
 * forward once, rather than skipping ahead and back.
 *
 * Also the place a restored backup catches up: if this device's own
 * messages on the server carry counters past the restored sending chain, the
 * chain is moved on, so the next message never reuses a counter the partner
 * has already spent.
 */
export async function revealAll(convo: Conversation, list: Message[], meId: string): Promise<Message[]> {
  const deviceId = await myDeviceId();
  const out: Message[] = [];
  let highestMine = -1;
  for (const m of list) {
    if (m.type === 'encrypted' && m.sender.id === meId && deviceId) {
      const w = parseWire(m.body);
      if (w && w.d === deviceId) highestMine = Math.max(highestMine, w.c);
    }
    out.push(await reveal(convo, m, meId, deviceId));
  }
  if (highestMine >= 0 && boundHere(convo, meId, deviceId)) {
    await locked(convo.id, async () => {
      const s = await K.loadSession(convo.id);
      if (s && s.send.n <= highestMine) await K.saveSession(await fastForwardSend(s, highestMine + 1));
    }).catch(() => {});
  }
  return out;
}

/** Keep the readable copy of something we just sent. */
export function keepSent(entry: H.SecretEntry) {
  return H.putEntry(entry);
}

/* ── keys and trust ───────────────────────────────────────────────────────── */

export async function markVerified(conversationId: string, verified: boolean) {
  await locked(conversationId, async () => {
    const s = await K.loadSession(conversationId);
    if (s) await K.saveSession({ ...s, verified });
  });
}

export async function sessionSummary(conversationId: string) {
  const s = await K.loadSession(conversationId).catch(() => null);
  return s ? { verified: Boolean(s.verified), peerIdentityPub: s.peerIdentityPub as Jwk } : null;
}

export interface Device {
  deviceId: string;
  identityPub: Jwk;
  signingPub: Jwk;
  createdAt: string;
  lastSeen: string;
}

export async function devicesOf(userId: string): Promise<Device[]> {
  const { devices } = await apiGet<{ devices: Device[] }>(`/e2ee/devices/${userId}`);
  return devices;
}

/**
 * Has the partner's device key changed since this chat began?
 *
 * 'changed' means their device now publishes a different identity key than
 * the one this chat was built on — a reinstall, or someone substituting keys.
 * 'gone' means the device no longer publishes at all. Either way the chat
 * says so, in the chat, rather than carrying on as if nothing happened.
 */
export async function partnerKeyStatus(convo: Conversation, meId: string): Promise<'ok' | 'changed' | 'gone' | 'unknown'> {
  if (!convo.secret) return 'unknown';
  const peer = peerEnd(convo.secret, meId);
  try {
    const devices = await devicesOf(peer.userId);
    const now = devices.find((d) => d.deviceId === peer.deviceId);
    if (!now) return 'gone';
    const session = await K.loadSession(convo.id).catch(() => null);
    const expected = session?.peerIdentityPub || peer.identityPub;
    return sameKey(now.identityPub, expected) && sameKey(now.identityPub, peer.identityPub) ? 'ok' : 'changed';
  } catch {
    return 'unknown';
  }
}
