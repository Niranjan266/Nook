/**
 * The secret-chat cryptography, round-tripped under plain Node.
 *
 *   node scripts/e2ee-selftest.mjs
 *
 * Imports client/src/lib/e2ee/crypto.ts directly — Node 22.6+ strips the
 * types itself (on by default from Node 23.6), and crypto.ts has no imports,
 * so there is nothing to bundle. Node's `crypto.subtle` is the same WebCrypto
 * the browser uses, which makes this a test of the real code, not a copy.
 */
import {
  generateDeviceKeys,
  createHandshake,
  acceptHandshake,
  encryptMessage,
  decryptMessage,
  fastForwardSend,
  encryptBytes,
  decryptBytes,
  safetyNumber,
  groupDigits,
  parseWire,
  toB64,
  fromB64,
  HandshakeError,
  DecryptError,
  MAX_SKIP,
} from '../src/lib/e2ee/crypto.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}   ${detail}`);
  }
};
const throwsCode = async (fn, code) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return code ? e instanceof DecryptError && e.code === code : true;
  }
};

console.log('\n── e2ee crypto self-test ──\n');

const alice = await generateDeviceKeys();
const bob = await generateDeviceKeys();
const mallory = await generateDeviceKeys();

ok('device keys publish no private material', !('d' in alice.identity.publicJwk) && !('d' in alice.signing.publicJwk));
ok('and keep it for the device', typeof alice.identity.privateJwk.d === 'string');

const ctx = {
  conversationId: 'convo-123',
  initiatorDeviceId: 'dev-alice',
  responderDeviceId: 'dev-bob',
  initiatorIdentityPub: alice.identity.publicJwk,
  responderIdentityPub: bob.identity.publicJwk,
};

/* ── handshake ─────────────────────────────────────────────────────────── */

const { handshake, session: aStart } = await createHandshake(ctx, {
  identity: alice.identity,
  signingPrivate: alice.signing.privateJwk,
});
ok('the handshake carries only a public ephemeral key', !('d' in handshake.ephemeralPub));

let bStart = await acceptHandshake(ctx, handshake, { identityPrivate: bob.identity.privateJwk }, alice.signing.publicJwk);
ok('both sides derive the same chains', aStart.send.ck === bStart.recv.ck && aStart.recv.ck === bStart.send.ck);
ok('and the two directions differ', aStart.send.ck !== aStart.recv.ck);

ok('a handshake signed by someone else is refused', await throwsCode(() =>
  acceptHandshake(ctx, handshake, { identityPrivate: bob.identity.privateJwk }, mallory.signing.publicJwk)));

const forged = { ...handshake, ephemeralPub: (await generateDeviceKeys()).identity.publicJwk };
let forgedError = null;
try {
  await acceptHandshake(ctx, forged, { identityPrivate: bob.identity.privateJwk }, alice.signing.publicJwk);
} catch (e) {
  forgedError = e;
}
ok('a swapped ephemeral key breaks the signature', forgedError instanceof HandshakeError, String(forgedError));

ok('the signature is bound to the conversation', await throwsCode(() =>
  acceptHandshake({ ...ctx, conversationId: 'convo-other' }, handshake, { identityPrivate: bob.identity.privateJwk }, alice.signing.publicJwk)));

ok('and to the devices', await throwsCode(() =>
  acceptHandshake({ ...ctx, responderDeviceId: 'dev-bob-2' }, handshake, { identityPrivate: bob.identity.privateJwk }, alice.signing.publicJwk)));

// The wrong recipient can accept nothing useful: its chains will not match.
const wrong = await acceptHandshake(ctx, handshake, { identityPrivate: mallory.identity.privateJwk }, alice.signing.publicJwk);
ok('a device without the partner key derives different chains', wrong.recv.ck !== aStart.send.ck);

/* ── the ratchet ───────────────────────────────────────────────────────── */

let a = aStart;
let b = bStart;

let r = await encryptMessage(a, 'hello bob');
a = r.session;
const first = r.wire;
const w = parseWire(first);
ok('the header says who and which counter', w.d === 'dev-alice' && w.c === 0, first.slice(0, 60));
ok('the plaintext is not in the wire', !first.includes('hello'));

let d = await decryptMessage(b, first);
b = d.session;
ok('a message round-trips', d.plaintext === 'hello bob', d.plaintext);

ok('the same message cannot be opened twice', await throwsCode(() => decryptMessage(b, first), 'already-used'));

r = await encryptMessage(b, 'hi alice ✨ — ünïcode');
b = r.session;
d = await decryptMessage(a, r.wire);
a = d.session;
ok('and the other way, unicode intact', d.plaintext === 'hi alice ✨ — ünïcode', d.plaintext);

// Same plaintext twice: different keys, different IVs, different ciphertexts.
const x1 = await encryptMessage(a, 'same');
const x2 = await encryptMessage(x1.session, 'same');
ok('identical messages encrypt differently', parseWire(x1.wire).ct !== parseWire(x2.wire).ct);
ok('each on its own counter', parseWire(x1.wire).c + 1 === parseWire(x2.wire).c);
a = x2.session;
d = await decryptMessage(b, x1.wire);
b = d.session;
d = await decryptMessage(b, x2.wire);
b = d.session;
ok('and both open', d.plaintext === 'same');

/* ── out of order ──────────────────────────────────────────────────────── */

const batch = [];
for (let i = 0; i < 5; i++) {
  r = await encryptMessage(a, `m${i}`);
  a = r.session;
  batch.push(r.wire);
}
const order = [3, 0, 4, 1, 2];
const got = [];
for (const i of order) {
  d = await decryptMessage(b, batch[i]);
  b = d.session;
  got.push(d.plaintext);
}
ok('messages arriving out of order all open', got.join(',') === order.map((i) => `m${i}`).join(','), got.join(','));
ok('and their spare keys are erased once used', Object.keys(b.skipped).length === 0, JSON.stringify(Object.keys(b.skipped)));

const far = [];
for (let i = 0; i < MAX_SKIP + 2; i++) {
  r = await encryptMessage(a, `far${i}`);
  a = r.session;
  far.push(r.wire);
}
ok('a jump beyond the skip limit is refused', await throwsCode(() => decryptMessage(b, far[far.length - 1]), 'too-far'));
d = await decryptMessage(b, far[MAX_SKIP - 1]);
b = d.session;
ok('a jump within it is fine', d.plaintext === `far${MAX_SKIP - 1}`);
d = await decryptMessage(b, far[0]);
b = d.session;
ok('and the skipped ones still open late', d.plaintext === 'far0');

/* ── tampering ─────────────────────────────────────────────────────────── */

r = await encryptMessage(a, 'do not change me');
a = r.session;
const genuine = r.wire;
const parsed = JSON.parse(genuine);

const bytes = fromB64(parsed.ct);
bytes[3] ^= 0x01;
const flipped = JSON.stringify({ ...parsed, ct: toB64(bytes) });
ok('a flipped ciphertext bit is caught', await throwsCode(() => decryptMessage(b, flipped), 'tampered'));

const moved = JSON.stringify({ ...parsed, c: parsed.c + 1 });
ok('a changed counter is caught (it is in the AAD)', await throwsCode(() => decryptMessage(b, moved), 'tampered'));

const otherIv = JSON.stringify({ ...parsed, iv: toB64(new Uint8Array(12)) });
ok('a changed IV is caught', await throwsCode(() => decryptMessage(b, otherIv), 'tampered'));

const claimed = JSON.stringify({ ...parsed, d: 'dev-mallory' });
ok('another device cannot speak in this chat', await throwsCode(() => decryptMessage(b, claimed), 'wrong-device'));

ok('garbage is refused', await throwsCode(() => decryptMessage(b, 'not json'), 'malformed'));

// None of those attempts may have advanced the chain.
d = await decryptMessage(b, genuine);
b = d.session;
ok('after all that, the genuine message still opens', d.plaintext === 'do not change me');

// A message for one chat cannot be replayed into another with the same keys.
const replayed = await throwsCode(() => decryptMessage({ ...b, conversationId: 'convo-other', skipped: {} }, genuine));
ok('a ciphertext cannot move to another chat', replayed);

/* ── forward secrecy per step ──────────────────────────────────────────── */

// State stolen *now* cannot reopen a message already received: its key was
// erased, and the chain only runs forward.
ok('a stolen current state cannot reopen old messages', await throwsCode(() => decryptMessage(b, first), 'already-used'));

/* ── restoring an older backup ─────────────────────────────────────────── */

const backup = structuredClone(a);
r = await encryptMessage(a, 'sent after the backup');
a = r.session;
d = await decryptMessage(b, r.wire);
b = d.session;
let restored = await fastForwardSend(backup, a.send.n);
r = await encryptMessage(restored, 'sent from the restored device');
restored = r.session;
d = await decryptMessage(b, r.wire);
b = d.session;
ok('a restored device can fast-forward and keep talking', d.plaintext === 'sent from the restored device');

/* ── files ─────────────────────────────────────────────────────────────── */

const file = new Uint8Array(200_000);
for (let i = 0; i < file.length; i += 65536) crypto.getRandomValues(file.subarray(i, i + 65536));
const sealed = await encryptBytes(file);
const opened = await decryptBytes(sealed.data, sealed.key, sealed.iv);
ok('a file round-trips', opened.length === file.length && opened.every((v, i) => v === file[i]));
const broken = sealed.data.slice();
broken[100] ^= 0xff;
ok('a tampered file is refused', await throwsCode(() => decryptBytes(broken, sealed.key, sealed.iv)));

/* ── safety number ─────────────────────────────────────────────────────── */

const ab = await safetyNumber({ userId: 'u-a', identityPub: alice.identity.publicJwk }, { userId: 'u-b', identityPub: bob.identity.publicJwk });
const ba = await safetyNumber({ userId: 'u-b', identityPub: bob.identity.publicJwk }, { userId: 'u-a', identityPub: alice.identity.publicJwk });
ok('the safety number is 60 digits', /^\d{60}$/.test(ab), ab);
ok('and the same from both sides', ab === ba);
ok('in twelve groups of five', groupDigits(ab).length === 12);
const am = await safetyNumber({ userId: 'u-a', identityPub: alice.identity.publicJwk }, { userId: 'u-b', identityPub: mallory.identity.publicJwk });
ok('a different key gives a different number', am !== ab);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
