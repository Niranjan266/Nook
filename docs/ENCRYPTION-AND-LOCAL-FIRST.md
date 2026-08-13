# Sections 1 and 8 — build-ready specs

You asked for all ten sections. Eight of them are built and running. **These two are not**, and I'd rather hand you a spec you can build from than a half-finished version you'd have to tear out.

Here's the honest reason, in one line each:

- **End-to-end encryption** is 3–5 weeks of work that *rewrites* search, push, media and multi-device. Half-doing it is worse than not doing it, because "encrypted" becomes a claim you can't stand behind.
- **Local-first CRDTs** replace the entire data layer. Bolting Yjs onto the side of the current store would give you the costs of both models and the benefits of neither.

Both specs below are written so someone can start on Monday.

---

## Section 1 — End-to-end encryption

### Why MLS and not Signal's Double Ratchet

Signal's protocol is pairwise: every member of a group needs a session with every other member, so a 20-person group is 190 sessions, each of which must be ratcheted on every message. It works — Signal does it — but the group machinery is where all the complexity lives.

**MLS (RFC 9420)** was designed for groups. One shared group key, a tree structure so adding or removing a member is O(log n), and forward secrecy plus post-compromise security by construction. Use **`openmls`** compiled to WASM.

### Data model changes

```
User
  identityKey        Ed25519 public key (private key never leaves the device)
  devices[]          { id, name, publicKey, keyPackage, lastSeen, addedAt }
  keyPackages[]      pre-published, one-time-use, so someone can add you offline

Conversation
  mlsGroupId
  epoch              increments on every membership change
  ciphersuite

Message
  ciphertext         opaque blob — the server can no longer read `body`
  epoch              which epoch decrypts it
  senderDeviceId
```

The server keeps: who is in a conversation, when messages were sent, and the blobs. That metadata is *not* protected by E2E, and you should say so plainly rather than implying otherwise.

### Order of work

1. **Identity and devices.** Generate an identity keypair in the browser, store the private key in IndexedDB wrapped by a key derived from the account password (Argon2id → AES-GCM). Publish the public key and a batch of key packages.
2. **Two-person groups first.** Get one direct conversation encrypting and decrypting end to end before you touch groups. Verify by confirming the server sees only ciphertext.
3. **Groups.** MLS commits for add/remove. The critical rule: **a new member must not be able to read history from before they joined.** MLS gives you this — don't work around it "for convenience".
4. **Media.** Each file gets its own AES-256-GCM key. Encrypt in the browser, upload the ciphertext, put the key in the encrypted message body. Cloudinary then stores something it cannot read — which also means no server-side thumbnails, so generate them client-side before encrypting.
5. **Multi-device.** Each device is a separate MLS member. Adding one is a ceremony: existing device shows a QR containing a short-lived transfer key, new device scans it, existing device encrypts the identity key to it.
6. **Backups.** A passphrase-derived key encrypting an export of the identity key and message history. Without this, a lost phone is lost history, and users will (rightly) be furious.

### The three things this breaks, and what to do

| Breaks | Fix |
|---|---|
| **Search** — the server can't index what it can't read | Local index. Decrypt on arrival, index into IndexedDB with a trigram tokeniser. Means full history per device, so gate it by date range. |
| **Push previews** — the server can't put the message in the notification | Send a *silent* push carrying only the message id. The service worker wakes, fetches the ciphertext, decrypts, and calls `showNotification` itself. iOS Safari's silent push behaviour is unreliable, so degrade to "New message". |
| **Multi-device sync** — no server-side read state to share | Send read receipts as encrypted control messages to your own device group. |

### What to change in this codebase

- `server/src/lib/serialize.js` — stop serialising `body`; pass `ciphertext` through.
- `server/src/services/messages.js` — `preview()` becomes a constant string; the push payload loses `body`.
- `server/src/routes/messages.js` — delete the text-search route. It cannot work.
- `client/src/lib/crypto.ts` — new. Wraps openmls, owns all key handling.
- `client/src/stores/chat.ts` — decrypt on receipt, encrypt on send, both in the store so no component ever handles a key.
- `client/public/sw.js` — decrypt inside the push handler.

### Traps

- **Do not roll your own.** Not the ratchet, not the group logic, not the key schedule. Use openmls and treat it as a black box.
- **Key packages run out.** They're one-time-use. Republish in the background or people become un-addable.
- **Epoch skew.** A client that missed a commit can't decrypt the next message. Keep the last few epoch secrets and implement a resync path.
- **Search feels broken before it feels private.** Ship the local index in the same release, not after.

---

## Section 8 — Local-first with CRDTs

### What actually changes

Today: the UI asks the store, the store asks the server, the server is the truth. Offline messages queue in an outbox and replay in order.

Local-first: **the device is the truth.** Every change is applied locally and immediately, then converges with everyone else's changes whenever the network allows. There is no "saving" state, no spinner, and no such thing as being offline — only being less recently converged.

### Yjs, not Automerge

Automerge has a nicer API and full history. Yjs is dramatically faster and its documents are far smaller — and for a chat app you are storing *a lot* of small edits. Use **Yjs** with `y-indexeddb` for local persistence and a custom `y-websocket` provider that speaks to the existing Socket.IO connection.

### Document shape

One Yjs document per conversation:

```
conversation (Y.Doc)
├── messages   Y.Array<Y.Map>   append-mostly
├── meta       Y.Map            wallpaper, mood, slow mode, pins
├── wall       Y.Array<Y.Map>   wall objects
└── drafts     Y.Map            per-user, never synced to others
```

The server becomes a **relay and archive**: it stores update blobs, serves them on reconnect, and never interprets them. Which composes perfectly with E2E encryption — encrypt the Yjs update blob and the server is a dumb pipe by construction. If you do both, do encryption first.

### Order of work

1. Replace the message array in one conversation with a `Y.Array`, keep everything else. Prove convergence with two browsers and the network throttled off.
2. Move conversation metadata into `Y.Map`. This is where CRDTs earn their keep: two people changing the wallpaper offline currently produces a race; with a `Y.Map` it produces a deterministic winner.
3. Persist with `y-indexeddb`. The app now cold-starts fully populated with no network at all.
4. Swap the outbox for the Yjs provider's own queue and delete `client/src/lib/outbox.ts`.
5. Add a server-side compaction job — update logs grow forever otherwise. Snapshot per conversation weekly and drop superseded updates.

### Traps

- **Deletion is not deletion.** CRDTs keep tombstones. "Delete for everyone" removes the *content* but the tombstone remains, and the document only ever grows. Compaction is not optional.
- **Ordering is causal, not chronological.** Two people writing offline produce a merge order that may not match wall-clock time. Sort the rendered list by timestamp, and accept that a message can appear *above* one you already read.
- **Y.Doc per conversation, never one giant doc.** A single document containing everything would load your entire history into memory on boot.
- **Don't sync drafts.** Obvious in hindsight, easy to get wrong when everything is in one doc.

### Honest cost/benefit

Three weeks for: instant UI, true offline, no lost messages, and a real technical moat. Against that — a permanently more complex data model, storage that grows unless you actively manage it, and a class of bug ("why did it merge like that?") that is genuinely hard to debug.

If you only ever expect Nook to be used with a connection, the current optimistic-send-plus-outbox already covers 90% of the felt benefit for 5% of the cost. Do this when offline use is a real requirement, not because it's interesting.

---

## My recommendation

Do **Section 1** before either. Everything shipped so far is designed to survive it — transcription is on-device, link previews are server-side by design, export is client-side, and the media pipeline already measures dimensions client-side. The one thing you'd lose is server-side message search, and that's a known, planned trade.

Do **Section 8** only if offline is a requirement someone has actually asked for.
