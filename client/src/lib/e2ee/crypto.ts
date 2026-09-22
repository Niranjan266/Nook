/**
 * The cryptography behind secret chats, and nothing else.
 *
 * Framework-free on purpose: no React, no stores, no IndexedDB, no imports at
 * all — only WebCrypto. That keeps it small enough to read in one sitting, and
 * lets `client/scripts/e2ee-selftest.mjs` run it under plain Node, which has
 * the same `crypto.subtle`. Every function takes state in and hands new state
 * back; persisting it is the caller's job.
 *
 * ── The design, and what it does and does not promise ──────────────────────
 *
 * Identity. Each device owns an ECDH P-256 identity key and an ECDSA P-256
 * signing key. Only the public halves are ever published.
 *
 * Handshake. The creator of a secret chat makes a fresh ephemeral ECDH key and
 * computes two agreements with the partner device's identity key:
 *
 *   dh1 = ECDH(ephemeral, partnerIdentity)
 *   dh2 = ECDH(creatorIdentity, partnerIdentity)
 *
 * and runs both through HKDF-SHA256 with
 * info = "nook-secret-v1|<creator device>|<partner device>|<conversation id>".
 * The output is two 32-byte chain keys, one per direction. The creator signs a
 * transcript naming the conversation, both devices, the ephemeral key and both
 * identity keys; the partner verifies that signature against the creator's
 * published signing key before deriving the same chains. dh2 authenticates the
 * creator's identity key implicitly; the signature makes it explicit and binds
 * the ephemeral key to it. The ephemeral private key is dropped as soon as the
 * chains exist.
 *
 * Messages. Each direction is a symmetric hash ratchet:
 *
 *   chainKey --HKDF--> messageKey || nextChainKey
 *
 * Every message uses a fresh message key and advances the chain; old chain
 * and message keys are deleted. Payloads are AES-256-GCM with a random 96-bit
 * IV and AAD = "nook-secret-v1|<conversation>|<sender device>|<counter>", so a
 * ciphertext cannot be replayed under another counter, device or chat. The
 * counter travels in the clear header; a few skipped message keys are kept so
 * messages that arrive out of order still open.
 *
 * What that buys: FORWARD SECRECY PER CHAIN STEP. Someone who steals a
 * device's session state today cannot recompute the keys for messages that
 * were already sent and received — those keys were derived one-way and then
 * erased.
 *
 * What it does NOT buy: POST-COMPROMISE SECURITY. There is no Diffie-Hellman
 * ratchet (this is not the full Double Ratchet), so someone who steals the
 * current chain keys can read every *future* message in that chat until the
 * chat is replaced. The honest remedy for a suspected compromise is to start a
 * new secret chat, which runs a new handshake from fresh keys. The identity
 * keys are also long-lived, and dh2 depends only on them: anyone holding both
 * identity private keys plus the handshake could rebuild the chains from the
 * start, which is why the ephemeral key (dh1) matters and is thrown away.
 */

/* ── encoding ─────────────────────────────────────────────────────────────── */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => enc.encode(s) as Uint8Array<ArrayBuffer>;
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);

/** A copy that WebCrypto's types accept, whatever buffer the input sat on. */
function ab(u: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u.byteLength);
  out.set(u);
  return out.buffer;
}

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const subtle = () => globalThis.crypto.subtle;
export const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/* ── keys ─────────────────────────────────────────────────────────────────── */

export type Jwk = JsonWebKey;

export interface KeyPairJwk {
  publicJwk: Jwk;
  privateJwk: Jwk;
}

export interface DeviceKeys {
  identity: KeyPairJwk;
  signing: KeyPairJwk;
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Only the point, in one canonical shape — what the server stores and compares. */
export const publicOnly = (j: Jwk): Jwk => ({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y });

/**
 * Extractable, deliberately. The backup feature has to be able to carry a
 * device's identity to a new install; a non-extractable key would make every
 * secret chat die with the phone. The private halves are still only ever
 * written to this device's own storage or to an encrypted backup.
 */
async function pairJwk(algorithm: typeof ECDH | typeof ECDSA, usages: KeyUsage[]): Promise<KeyPairJwk> {
  const pair = (await subtle().generateKey(algorithm, true, usages)) as CryptoKeyPair;
  const [publicJwk, privateJwk] = await Promise.all([
    subtle().exportKey('jwk', pair.publicKey),
    subtle().exportKey('jwk', pair.privateKey),
  ]);
  return { publicJwk: publicOnly(publicJwk), privateJwk };
}

export async function generateDeviceKeys(): Promise<DeviceKeys> {
  const [identity, signing] = await Promise.all([
    pairJwk(ECDH, ['deriveBits']),
    pairJwk(ECDSA, ['sign', 'verify']),
  ]);
  return { identity, signing };
}

const importEcdhPrivate = (j: Jwk) => subtle().importKey('jwk', j, ECDH, false, ['deriveBits']);
const importEcdhPublic = (j: Jwk) => subtle().importKey('jwk', publicOnly(j), ECDH, false, []);
const importSigner = (j: Jwk) => subtle().importKey('jwk', j, ECDSA, false, ['sign']);
const importVerifier = (j: Jwk) => subtle().importKey('jwk', publicOnly(j), ECDSA, false, ['verify']);

async function agree(privateJwk: Jwk, publicJwk: Jwk): Promise<Uint8Array<ArrayBuffer>> {
  const [priv, pub] = await Promise.all([importEcdhPrivate(privateJwk), importEcdhPublic(publicJwk)]);
  return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}

async function hkdf(ikm: Uint8Array, info: string, bytes: number, salt = new Uint8Array(32)) {
  const key = await subtle().importKey('raw', ab(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(utf8(info)) }, key, bytes * 8)
  );
}

/* ── handshake ────────────────────────────────────────────────────────────── */

export const VERSION = 'nook-secret-v1';

/** A P-256 point, written so two different points can never print the same. */
const point = (j: Jwk) => `${j.x}.${j.y}`;

export interface HandshakeContext {
  conversationId: string;
  initiatorDeviceId: string;
  responderDeviceId: string;
  initiatorIdentityPub: Jwk;
  responderIdentityPub: Jwk;
}

/** Exactly what the creator signs. Anything left out here could be swapped. */
function transcript(ctx: HandshakeContext, ephemeralPub: Jwk) {
  return utf8(
    [
      VERSION,
      'handshake',
      ctx.conversationId,
      ctx.initiatorDeviceId,
      ctx.responderDeviceId,
      point(ephemeralPub),
      point(ctx.initiatorIdentityPub),
      point(ctx.responderIdentityPub),
    ].join('|')
  );
}

export interface Handshake {
  ephemeralPub: Jwk;
  /** ECDSA P-256 / SHA-256 over the transcript, raw r||s, base64. */
  signature: string;
}

export interface Chain {
  /** Base64 chain key. Replaced on every step; the old one is gone. */
  ck: string;
  /** The counter the next message on this chain will carry. */
  n: number;
}

export interface Session {
  v: 1;
  conversationId: string;
  role: 'initiator' | 'responder';
  myDeviceId: string;
  peerDeviceId: string;
  myIdentityPub: Jwk;
  /** The partner key this chat was built on — compared later to spot a change. */
  peerIdentityPub: Jwk;
  send: Chain;
  recv: Chain;
  /** counter -> base64 message key, for messages that arrived out of order. */
  skipped: Record<string, string>;
  /** The person checked the safety number with their partner. */
  verified?: boolean;
  createdAt: number;
}

async function rootChains(ctx: HandshakeContext, dh1: Uint8Array, dh2: Uint8Array) {
  const info = `${VERSION}|${ctx.initiatorDeviceId}|${ctx.responderDeviceId}|${ctx.conversationId}`;
  const out = await hkdf(concat(dh1, dh2), info, 64);
  return { i2r: toB64(out.slice(0, 32)), r2i: toB64(out.slice(32, 64)) };
}

/** The creator's side: make the handshake, and the session it implies. */
export async function createHandshake(
  ctx: HandshakeContext,
  mine: { identity: KeyPairJwk; signingPrivate: Jwk }
): Promise<{ handshake: Handshake; session: Session }> {
  const ephemeral = await pairJwk(ECDH, ['deriveBits']);
  const [dh1, dh2] = await Promise.all([
    agree(ephemeral.privateJwk, ctx.responderIdentityPub),
    agree(mine.identity.privateJwk, ctx.responderIdentityPub),
  ]);
  const chains = await rootChains(ctx, dh1, dh2);

  const signer = await importSigner(mine.signingPrivate);
  const signature = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, ab(transcript(ctx, ephemeral.publicJwk)));
  // `ephemeral.privateJwk` goes out of scope here and is never stored.

  return {
    handshake: { ephemeralPub: ephemeral.publicJwk, signature: toB64(signature) },
    session: {
      v: 1,
      conversationId: ctx.conversationId,
      role: 'initiator',
      myDeviceId: ctx.initiatorDeviceId,
      peerDeviceId: ctx.responderDeviceId,
      myIdentityPub: publicOnly(ctx.initiatorIdentityPub),
      peerIdentityPub: publicOnly(ctx.responderIdentityPub),
      send: { ck: chains.i2r, n: 0 },
      recv: { ck: chains.r2i, n: 0 },
      skipped: {},
      createdAt: Date.now(),
    },
  };
}

export class HandshakeError extends Error {}

/** The partner's side: check the signature, then derive the same chains. */
export async function acceptHandshake(
  ctx: HandshakeContext,
  handshake: Handshake,
  mine: { identityPrivate: Jwk },
  initiatorSigningPub: Jwk
): Promise<Session> {
  const verifier = await importVerifier(initiatorSigningPub);
  const ok = await subtle().verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifier,
    ab(fromB64(handshake.signature)),
    ab(transcript(ctx, handshake.ephemeralPub))
  );
  if (!ok) throw new HandshakeError('The handshake signature does not match the creator’s key.');

  const [dh1, dh2] = await Promise.all([
    agree(mine.identityPrivate, handshake.ephemeralPub),
    agree(mine.identityPrivate, ctx.initiatorIdentityPub),
  ]);
  const chains = await rootChains(ctx, dh1, dh2);

  return {
    v: 1,
    conversationId: ctx.conversationId,
    role: 'responder',
    myDeviceId: ctx.responderDeviceId,
    peerDeviceId: ctx.initiatorDeviceId,
    myIdentityPub: publicOnly(ctx.responderIdentityPub),
    peerIdentityPub: publicOnly(ctx.initiatorIdentityPub),
    send: { ck: chains.r2i, n: 0 },
    recv: { ck: chains.i2r, n: 0 },
    skipped: {},
    createdAt: Date.now(),
  };
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

/** How far ahead of the expected counter a message may jump. */
export const MAX_SKIP = 50;
/** How many out-of-order keys a session keeps at most. */
export const MAX_SKIPPED_KEPT = 100;

/** One step: a message key to use once, and the chain key that replaces this one. */
async function step(ck: string): Promise<{ mk: Uint8Array<ArrayBuffer>; next: string }> {
  const out = await hkdf(fromB64(ck), `${VERSION}|chain-step`, 64);
  return { mk: out.slice(0, 32), next: toB64(out.slice(32, 64)) };
}

const aad = (conversationId: string, deviceId: string, counter: number) =>
  utf8(`${VERSION}|${conversationId}|${deviceId}|${counter}`);

const aesKey = (raw: Uint8Array, usage: KeyUsage) =>
  subtle().importKey('raw', ab(raw), { name: 'AES-GCM' }, false, [usage]);

export interface Wire {
  v: 1;
  /** Sending device. */
  d: string;
  /** Counter on the sender's chain. */
  c: number;
  iv: string;
  ct: string;
}

export function parseWire(body: string): Wire | null {
  try {
    const w = JSON.parse(body);
    if (w?.v !== 1 || typeof w.d !== 'string' || !Number.isInteger(w.c) || w.c < 0) return null;
    if (typeof w.iv !== 'string' || typeof w.ct !== 'string') return null;
    return w as Wire;
  } catch {
    return null;
  }
}

/** Encrypt one message. Returns the advanced session; the old one must be discarded. */
export async function encryptMessage(session: Session, plaintext: string): Promise<{ session: Session; wire: string }> {
  const counter = session.send.n;
  const { mk, next } = await step(session.send.ck);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: ab(iv), additionalData: ab(aad(session.conversationId, session.myDeviceId, counter)) },
    await aesKey(mk, 'encrypt'),
    ab(utf8(plaintext))
  );
  const wire: Wire = { v: 1, d: session.myDeviceId, c: counter, iv: toB64(iv), ct: toB64(ct) };
  return { session: { ...session, send: { ck: next, n: counter + 1 } }, wire: JSON.stringify(wire) };
}

export class DecryptError extends Error {
  code: 'malformed' | 'wrong-device' | 'too-far' | 'already-used' | 'tampered';
  constructor(code: DecryptError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Decrypt one message. The session only moves forward if the message is
 * genuine: a forged or corrupted ciphertext throws and leaves the state as it
 * was, so it cannot be used to burn through someone's chain.
 */
export async function decryptMessage(session: Session, body: string): Promise<{ session: Session; plaintext: string }> {
  const w = parseWire(body);
  if (!w) throw new DecryptError('malformed', 'That is not a secret message.');
  if (w.d !== session.peerDeviceId)
    throw new DecryptError('wrong-device', 'This came from a device this chat is not bound to.');

  let mk: Uint8Array;
  let recv = session.recv;
  const skipped = { ...session.skipped };

  if (w.c < recv.n) {
    const kept = skipped[String(w.c)];
    if (!kept) throw new DecryptError('already-used', 'That message key has already been used and erased.');
    mk = fromB64(kept);
    delete skipped[String(w.c)];
  } else {
    if (w.c - recv.n > MAX_SKIP) throw new DecryptError('too-far', 'That message is too far ahead of this chat.');
    let ck = recv.ck;
    // Walk the chain up to this counter, keeping the keys of any messages
    // we have not seen yet so they can still open when they turn up.
    for (let n = recv.n; n < w.c; n++) {
      const s = await step(ck);
      skipped[String(n)] = toB64(s.mk);
      ck = s.next;
    }
    const s = await step(ck);
    mk = s.mk;
    recv = { ck: s.next, n: w.c + 1 };
  }

  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: ab(fromB64(w.iv)), additionalData: ab(aad(session.conversationId, w.d, w.c)) },
      await aesKey(mk, 'decrypt'),
      ab(fromB64(w.ct))
    );
  } catch {
    throw new DecryptError('tampered', 'This message was changed after it was sent, or is not for this chat.');
  }

  // Keep only the newest skipped keys: an old gap is far more likely to be a
  // lost message than a late one, and every kept key is a small liability.
  const counters = Object.keys(skipped).map(Number).sort((a, b) => a - b);
  while (counters.length > MAX_SKIPPED_KEPT) delete skipped[String(counters.shift())];

  return { session: { ...session, recv, skipped }, plaintext: fromUtf8(new Uint8Array(plain)) };
}

/**
 * Move the sending chain forward to `counter` without sending anything.
 *
 * Used after restoring an older backup: this device may already have sent
 * messages past the restored counter, and the partner has erased those keys,
 * so reusing a counter would produce messages they can no longer open.
 */
export async function fastForwardSend(session: Session, counter: number): Promise<Session> {
  if (counter <= session.send.n) return session;
  if (counter - session.send.n > 10_000) throw new Error('Refusing to fast-forward that far.');
  let ck = session.send.ck;
  for (let n = session.send.n; n < counter; n++) ck = (await step(ck)).next;
  return { ...session, send: { ck, n: counter } };
}

/* ── files ────────────────────────────────────────────────────────────────── */

/** A fresh key per file, carried inside the (encrypted) message that points to it. */
export async function encryptBytes(bytes: Uint8Array): Promise<{ data: Uint8Array<ArrayBuffer>; key: string; iv: string }> {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv: ab(iv) }, await aesKey(key, 'encrypt'), ab(bytes));
  return { data: new Uint8Array(data), key: toB64(key), iv: toB64(iv) };
}

export async function decryptBytes(data: Uint8Array, key: string, iv: string): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: ab(fromB64(iv)) },
    await aesKey(fromB64(key), 'decrypt'),
    ab(data)
  );
  return new Uint8Array(plain);
}

/* ── safety number ────────────────────────────────────────────────────────── */

const FINGERPRINT_ROUNDS = 1024;

/** 30 digits for one side: iterated SHA-512 over the key and whose it is. */
async function half(userId: string, identityPub: Jwk): Promise<string> {
  const key = concat(fromB64Url(identityPub.x || ''), fromB64Url(identityPub.y || ''));
  let hash: Uint8Array = concat(utf8(`${VERSION}|fingerprint|${userId}|`), key);
  for (let i = 0; i < FINGERPRINT_ROUNDS; i++)
    hash = new Uint8Array(await subtle().digest('SHA-512', ab(concat(hash, key))));

  let digits = '';
  for (let chunk = 0; chunk < 6; chunk++) {
    const b = hash.slice(chunk * 5, chunk * 5 + 5);
    const n = ((b[0] * 2 ** 32 + b[1] * 2 ** 24 + b[2] * 2 ** 16 + b[3] * 2 ** 8 + b[4]) % 100000);
    digits += String(n).padStart(5, '0');
  }
  return digits;
}

/**
 * The 60-digit safety number for a pair of identity keys.
 *
 * Both sides compute the same number — the halves are put in a fixed order —
 * so two people can read it to each other, or compare it on two screens. If a
 * key is swapped anywhere on the way, the numbers differ.
 */
export async function safetyNumber(a: { userId: string; identityPub: Jwk }, b: { userId: string; identityPub: Jwk }) {
  const [ha, hb] = await Promise.all([half(a.userId, a.identityPub), half(b.userId, b.identityPub)]);
  return ha < hb ? ha + hb : hb + ha;
}

/** Twelve groups of five, the way people actually read numbers aloud. */
export const groupDigits = (n: string) => n.match(/.{1,5}/g) || [];

function fromB64Url(s: string) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(b + '='.repeat((4 - (b.length % 4)) % 4));
}

/** Same point, same key — used to notice that a partner's key changed. */
export const sameKey = (a?: Jwk | null, b?: Jwk | null) =>
  Boolean(a && b && a.x === b.x && a.y === b.y && a.crv === b.crv);
