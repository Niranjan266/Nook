/**
 * Secret chats, from the server's side of the glass.
 *
 * The server's promise is narrow and checkable: it publishes public keys to
 * the right people, keeps each secret chat separate from the ordinary one,
 * stores ciphertext exactly as it arrived, and never does anything that would
 * require reading it — no link preview, no transcript, no search entry, no
 * text on a lock screen, no copy in or out by forwarding. The cryptography
 * itself is the client's, and is checked by client/scripts/e2ee-selftest.mjs.
 */
import { webcrypto } from 'node:crypto';
import { suite, api, register, befriend, directChat, say, settle } from './helpers.mjs';
import { messagePushPayload } from '../src/lib/messagePush.js';
import { TEMPLATES } from '../src/services/templates.js';
import { one, all } from '../src/db/index.js';

const t = suite('secret chats');
const subtle = webcrypto.subtle;

/** A real public JWK, the way a browser exports one. */
async function publicKey(kind) {
  const pair =
    kind === 'sign'
      ? await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      : await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  const priv = await subtle.exportKey('jwk', pair.privateKey);
  return { pub: jwk, priv };
}

async function device(person, id) {
  const identity = await publicKey('ecdh');
  const signing = await publicKey('sign');
  const r = await api('/e2ee/devices', {
    method: 'POST',
    token: person.token,
    body: { deviceId: id, identityPub: identity.pub, signingPub: signing.pub },
  });
  return { r, identity, signing, id };
}

const a = await register('seca');
const b = await register('secb');
const stranger = await register('secz');

/* ── device registration ──────────────────────────────────────────────── */

const aDev = await device(a, 'dev-alice-phone');
t.ok('a device can publish its public keys', aDev.r.status === 201, `${aDev.r.status} ${JSON.stringify(aDev.r.json)}`);

let r = await api('/e2ee/devices', {
  method: 'POST',
  token: a.token,
  body: { deviceId: 'dev-alice-phone', identityPub: aDev.identity.pub, signingPub: aDev.signing.pub },
});
t.ok('publishing the same keys again is a refresh', r.status === 200 && r.json.changed === false, JSON.stringify(r.json));

r = await api('/e2ee/devices', {
  method: 'POST',
  token: a.token,
  body: { deviceId: 'dev-alice-leak', identityPub: aDev.identity.priv, signingPub: aDev.signing.pub },
});
t.ok('a private key is refused, not stored', r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);

r = await api('/e2ee/devices', {
  method: 'POST',
  token: a.token,
  body: { deviceId: 'dev-bad-key', identityPub: { kty: 'RSA', n: 'x', e: 'AQAB' }, signingPub: aDev.signing.pub },
});
t.ok('anything that is not a P-256 key is refused', r.status === 400, `${r.status}`);

r = await api('/e2ee/devices', { method: 'POST', body: { deviceId: 'dev-anon-1', identityPub: aDev.identity.pub, signingPub: aDev.signing.pub } });
t.ok('publishing keys needs a session', r.status === 401, `${r.status}`);

const bOld = await device(b, 'dev-bob-laptop');
await settle(20);
const bDev = await device(b, 'dev-bob-phone');
t.ok('a second device for the same person is its own row', bDev.r.status === 201, `${bDev.r.status}`);

/* ── who may see whose keys ───────────────────────────────────────────── */

r = await api(`/e2ee/devices/${b.id}`, { token: a.token });
t.ok('keys are private to strangers', r.status === 404, `${r.status}`);

r = await api(`/e2ee/devices/${a.id}`, { token: a.token });
t.ok('you can always see your own', r.status === 200 && r.json.devices.length === 1, JSON.stringify(r.json));
t.ok('and only public halves come back', !JSON.stringify(r.json).includes('"d"'));

await befriend(a, b);
r = await api(`/e2ee/devices/${b.id}`, { token: a.token });
t.ok('a friend can see them', r.status === 200 && r.json.devices.length === 2, `${r.status} ${JSON.stringify(r.json)}`);
t.ok('most recently seen first', r.json.devices?.[0]?.deviceId === 'dev-bob-phone', JSON.stringify(r.json.devices?.map((d) => d.deviceId)));

r = await api(`/e2ee/devices/${a.id}`, { token: stranger.token });
t.ok('a stranger still cannot', r.status === 404, `${r.status}`);

r = await api('/e2ee/devices/no-such-user', { token: a.token });
t.ok('an unknown person looks exactly like a private one', r.status === 404, `${r.status}`);

/* ── starting a secret chat ───────────────────────────────────────────── */

const direct = await directChat(a, b);

r = await api('/e2ee/secret', { method: 'POST', token: stranger.token, body: { userId: a.id, deviceId: 'dev-stranger1' } });
t.ok('a stranger cannot bind a secret chat to your device', r.status === 403, `${r.status}`);

r = await api('/e2ee/secret', { method: 'POST', token: a.token, body: { userId: b.id, deviceId: 'dev-not-mine' } });
t.ok('the creator must use a device it has published', r.status === 400, `${r.status}`);

r = await api('/e2ee/secret', { method: 'POST', token: a.token, body: { userId: b.id, deviceId: aDev.id } });
t.ok('a secret chat can be started', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
const secret = r.json.conversation;
t.ok('it is its own kind of conversation', secret?.type === 'secret');
t.ok('separate from the ordinary chat', secret?.id && secret.id !== direct, `${secret?.id} vs ${direct}`);
t.ok('bound to the partner device seen most recently', secret?.secret?.responder?.deviceId === 'dev-bob-phone', JSON.stringify(secret?.secret?.responder));
t.ok('and to the creating device', secret?.secret?.initiator?.deviceId === aDev.id);
t.ok('carrying a snapshot of both public keys', secret?.secret?.initiator?.identityPub?.x === aDev.identity.pub.x
     && secret?.secret?.responder?.signingPub?.x === bDev.signing.pub.x);
t.ok('with no handshake yet', secret?.secret?.handshake === null);
t.ok('named after the other person, like a direct chat', secret?.partner?.id === b.id, JSON.stringify(secret?.partner));

r = await api('/e2ee/secret', { method: 'POST', token: a.token, body: { userId: b.id, deviceId: aDev.id, partnerDeviceId: 'dev-bob-laptop' } });
t.ok('a specific partner device can be chosen', r.status === 201 && r.json.conversation.secret.responder.deviceId === 'dev-bob-laptop',
     `${r.status} ${JSON.stringify(r.json.conversation?.secret?.responder)}`);

r = await api('/e2ee/secret', { method: 'POST', token: a.token, body: { userId: b.id, deviceId: aDev.id } });
t.ok('the same pair of devices reuses its chat', r.json.conversation?.id === secret.id && r.json.existing === true, JSON.stringify(r.json.existing));

r = await api('/conversations/direct', { method: 'POST', token: a.token, body: { userId: b.id } });
t.ok('opening the ordinary chat still finds the ordinary chat', r.json.conversation?.id === direct, r.json.conversation?.id);

/* ── the handshake ────────────────────────────────────────────────────── */

const eph = await publicKey('ecdh');
r = await api(`/e2ee/secret/${secret.id}/handshake`, { method: 'POST', token: b.token, body: { ephemeralPub: eph.pub, signature: 'A'.repeat(88) } });
t.ok('only the creator sends the handshake', r.status === 403, `${r.status}`);

r = await api(`/e2ee/secret/${secret.id}/handshake`, { method: 'POST', token: a.token, body: { ephemeralPub: eph.pub, signature: 'A'.repeat(88) } });
t.ok('the creator can', r.status === 200 && r.json.conversation?.secret?.handshake?.ephemeralPub?.x === eph.pub.x, `${r.status} ${JSON.stringify(r.json)}`);

r = await api(`/e2ee/secret/${secret.id}/handshake`, { method: 'POST', token: a.token, body: { ephemeralPub: eph.pub, signature: 'B'.repeat(88) } });
t.ok('and only once — keys cannot be swapped under a live chat', r.status === 409, `${r.status}`);

const bView = (await api('/conversations', { token: b.token })).json.conversations.find((c) => c.id === secret.id);
t.ok('the partner sees the chat with the handshake in it', bView?.secret?.handshake?.signature === 'A'.repeat(88), JSON.stringify(bView?.secret));

/* ── ciphertext in, ciphertext out ────────────────────────────────────── */

// Shaped like real output, with a URL and a searchable word tucked inside —
// both of which a server that read bodies would act on.
const cipher = JSON.stringify({
  v: 1,
  d: aDev.id,
  c: 0,
  iv: 'q83vEjRWeJq8m0xx',
  ct: 'zebracorn https://example.com/secret ' + 'QUJD'.repeat(40),
});

r = await api(`/messages/${secret.id}`, {
  method: 'POST',
  token: a.token,
  body: { type: 'encrypted', body: cipher, transcript: 'zebracorn spoken words', replyTo: null, clientId: 'sec-1' },
});
t.ok('an encrypted message is accepted', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
const sent = r.json.message;
t.ok('and comes back byte for byte', sent?.body === cipher);
t.ok('typed as encrypted', sent?.type === 'encrypted');
t.ok('with no transcript kept beside it', sent?.transcript === '', JSON.stringify(sent?.transcript));

const row = await one('SELECT body, cipher, transcript FROM messages WHERE id = ?', [sent.id]);
t.ok('stored verbatim, out of the indexed column', row?.cipher === cipher && row?.body === '', JSON.stringify(row).slice(0, 120));

const indexed = await all(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"zebracorn"'`);
t.ok('never written to the search index', indexed.length === 0, `${indexed.length} hits`);

r = await api(`/messages/search/all?q=zebracorn`, { token: b.token });
t.ok('so search finds nothing in it', r.status === 200 && r.json.results.length === 0, JSON.stringify(r.json));

await settle(1500);
r = await api(`/messages/${secret.id}`, { token: b.token });
const received = r.json.messages?.find((m) => m.id === sent.id);
t.ok('the partner receives the same ciphertext', received?.body === cipher);
t.ok('and no link preview was ever made from it', received?.linkPreview === null, JSON.stringify(received?.linkPreview));

const convoRow = (await api('/conversations', { token: b.token })).json.conversations.find((c) => c.id === secret.id);
t.ok('the chat list carries ciphertext, not a preview', convoRow?.lastMessage?.body === cipher);

/* ── what a secret chat refuses ───────────────────────────────────────── */

r = await say(a.token, secret.id, 'this would be stored in the clear');
t.ok('plain text is refused in a secret chat', r.status === 400 && r.json.code === 'SECRET_ONLY', `${r.status} ${JSON.stringify(r.json)}`);

r = await api(`/messages/${direct}`, { method: 'POST', token: a.token, body: { type: 'encrypted', body: cipher } });
t.ok('ciphertext is refused in an ordinary chat', r.status === 400, `${r.status}`);

r = await api(`/messages/${secret.id}`, { method: 'POST', token: a.token, body: { type: 'encrypted', body: cipher, threadRoot: sent.id } });
t.ok('threads are refused — their replies would be plaintext', r.status === 400, `${r.status}`);

r = await api(`/messages/${sent.id}`, { method: 'PATCH', token: a.token, body: { body: 'edited' } });
t.ok('secret messages cannot be edited', r.status === 400, `${r.status}`);

r = await api(`/conversations/${secret.id}/pins/${sent.id}`, { method: 'POST', token: a.token });
t.ok('nor pinned into a bar everyone reads', r.status === 400, `${r.status}`);

r = await api(`/rooms/${secret.id}/wall`, { method: 'POST', token: a.token, body: { type: 'note', text: 'in the clear' } });
t.ok('wall notes are off in a secret chat', r.status === 400, `${r.status}`);

r = await api(`/messages/${sent.id}/react`, { method: 'POST', token: b.token, body: { emoji: '❤️' } });
t.ok('reactions still work — they are metadata', r.status === 200 && r.json.message?.reactions?.length === 1, `${r.status}`);

/* ── forwarding ───────────────────────────────────────────────────────── */

r = await api(`/messages/${sent.id}/forward`, { method: 'POST', token: a.token, body: { conversationIds: [direct] } });
t.ok('nothing is forwarded out of a secret chat', r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);

const plain = (await say(a.token, direct, 'an ordinary message')).json.message;
r = await api(`/messages/${plain.id}/forward`, { method: 'POST', token: a.token, body: { conversationIds: [secret.id] } });
t.ok('nothing is forwarded into one', r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);

r = await api(`/messages/${plain.id}/forward`, { method: 'POST', token: a.token, body: { conversationIds: [direct, secret.id] } });
t.ok('and a mixed forward is refused whole', r.status === 403, `${r.status}`);
const after = (await api(`/messages/${direct}`, { token: a.token })).json.messages.filter((m) => m.forwarded);
t.ok('without half of it going out first', after.length === 0, `${after.length} forwarded copies`);

/* ── what a push may say ──────────────────────────────────────────────── */

const secretConvo = { id: secret.id, type: 'secret', name: '' };
const encryptedMessage = { id: sent.id, type: 'encrypted', body: cipher, cipher };
const sender = { displayName: 'Alice', avatarUrl: '/a.png' };

const withName = messagePushPayload({ convo: secretConvo, message: encryptedMessage, sender, showPreview: true, sound: 'default', vibrate: true });
t.ok('a secret push names the sender when previews are allowed', withName.title === 'Alice', withName.title);
t.ok('and says only that there is a secret message', withName.body === 'New secret message', withName.body);
t.ok('with not a byte of the ciphertext anywhere in it', !JSON.stringify(withName).includes('zebracorn') && !JSON.stringify(withName).includes('QUJD'));

const noName = messagePushPayload({ convo: secretConvo, message: encryptedMessage, sender, showPreview: false, sound: 'default', vibrate: true });
t.ok('with previews off it does not even say who', noName.title === 'Nook' && !JSON.stringify(noName).includes('Alice'), JSON.stringify(noName));

// Even handed a preview by mistake, the template has nowhere to put it.
const misuse = TEMPLATES.secretMessage.push({ sender: 'Alice', preview: 'zebracorn', body: 'zebracorn' });
t.ok('the secret template ignores any preview it is handed', !JSON.stringify(misuse).includes('zebracorn'));

const stray = messagePushPayload({ convo: { id: direct, type: 'direct' }, message: encryptedMessage, sender, showPreview: true });
t.ok('ciphertext never becomes a preview anywhere', !JSON.stringify(stray).includes('zebracorn'), JSON.stringify(stray));

const ordinary = messagePushPayload({ convo: { id: direct, type: 'direct' }, message: { id: 'x', type: 'text', body: 'hello there' }, sender, showPreview: true });
t.ok('ordinary chats keep their previews', ordinary.body === 'hello there', ordinary.body);

/* ── unsend ───────────────────────────────────────────────────────────── */

r = await api(`/messages/${sent.id}?scope=everyone`, { method: 'DELETE', token: a.token });
const gone = await one('SELECT body, cipher FROM messages WHERE id = ?', [sent.id]);
t.ok('unsending wipes the ciphertext too', r.status === 200 && gone?.cipher === '', JSON.stringify(gone));

/* ── the whole protocol, through this server ──────────────────────────────
   The client's own crypto module, driven over the real routes: keys
   published and fetched, a handshake signed on one side and verified on the
   other against the key the server handed out, and messages that survive
   the round trip. This is the seam where a JWK the server trims differently,
   or a signature encoding it rejects, would break every secret chat. Node
   strips the TypeScript itself; an older Node without that skips the block. */

let X = null;
try {
  X = await import('../../client/src/lib/e2ee/crypto.ts');
} catch (err) {
  console.log(`  SKIP  protocol round trip (this Node cannot load .ts: ${err?.code || err?.message})`);
}

if (X) {
  const c = await register('secc');
  const d = await register('secd');
  await befriend(c, d);
  const cKeys = await X.generateDeviceKeys();
  const dKeys = await X.generateDeviceKeys();
  const publish = (who, id, keys) =>
    api('/e2ee/devices', {
      method: 'POST',
      token: who.token,
      body: { deviceId: id, identityPub: keys.identity.publicJwk, signingPub: keys.signing.publicJwk },
    });
  await publish(c, 'dev-carol-real', cKeys);
  await publish(d, 'dev-dave-real', dKeys);

  const made = (await api('/e2ee/secret', { method: 'POST', token: c.token, body: { userId: d.id, deviceId: 'dev-carol-real' } })).json.conversation;
  const ctx = (s) => ({
    conversationId: made.id,
    initiatorDeviceId: s.initiator.deviceId,
    responderDeviceId: s.responder.deviceId,
    initiatorIdentityPub: s.initiator.identityPub,
    responderIdentityPub: s.responder.identityPub,
  });
  const { handshake, session: cSession } = await X.createHandshake(ctx(made.secret), {
    identity: cKeys.identity,
    signingPrivate: cKeys.signing.privateJwk,
  });
  r = await api(`/e2ee/secret/${made.id}/handshake`, { method: 'POST', token: c.token, body: handshake });
  t.ok('a real handshake is accepted by the server', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);

  // Dave's side sees only what the server gives him.
  const seen = (await api('/conversations', { token: d.token })).json.conversations.find((x) => x.id === made.id);
  const dSession = await X.acceptHandshake(ctx(seen.secret), seen.secret.handshake, { identityPrivate: dKeys.identity.privateJwk }, seen.secret.initiator.signingPub);
  t.ok('and verifies on the other side against the relayed keys', dSession.recv.ck === cSession.send.ck);

  const sealed = await X.encryptMessage(cSession, JSON.stringify({ t: 'text', b: 'meet at the usual place' }));
  r = await api(`/messages/${made.id}`, { method: 'POST', token: c.token, body: { type: 'encrypted', body: sealed.wire } });
  const relayed = (await api(`/messages/${made.id}`, { token: d.token })).json.messages.find((m) => m.id === r.json.message?.id);
  const opened = await X.decryptMessage(dSession, relayed.body);
  t.ok('a real message survives the round trip', JSON.parse(opened.plaintext).b === 'meet at the usual place');
  t.ok('and the server never held its words', !JSON.stringify(await one('SELECT * FROM messages WHERE id = ?', [r.json.message.id])).includes('usual place'));

  // Each side: its own key from its own storage, the other's from the server.
  const n1 = await X.safetyNumber({ userId: c.id, identityPub: cKeys.identity.publicJwk }, { userId: d.id, identityPub: made.secret.responder.identityPub });
  const n2 = await X.safetyNumber({ userId: d.id, identityPub: dKeys.identity.publicJwk }, { userId: c.id, identityPub: seen.secret.initiator.identityPub });
  t.ok('both sides compute the same safety number from what they hold', n1 === n2);
}

process.exit(t.done() ? 1 : 0);
