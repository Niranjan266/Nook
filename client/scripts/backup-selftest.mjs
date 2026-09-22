/**
 * The backup container, exercised in Node — no browser, no server.
 *
 *   node client/scripts/backup-selftest.mjs
 *
 * Node 24 runs the TypeScript module directly (type stripping) and has the
 * same WebCrypto and CompressionStream the browser uses, so this is the real
 * code under test, not a copy of it.
 */
import { sealBackup, openBackup, peekBackup, passwordStrength, BackupError, MIN_ITERATIONS } from '../src/lib/backup/crypto.ts';

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

const rejects = async (promise, code) => {
  try {
    await promise;
    return false;
  } catch (err) {
    return err instanceof BackupError && err.code === code;
  }
};

console.log('\n── backup container self-test ──\n');

const sample = {
  format: 'nook-backup',
  version: 1,
  createdAt: new Date().toISOString(),
  user: { id: 'u1', username: 'ada' },
  messages: { c1: Array.from({ length: 500 }, (_, i) => ({ id: `m${i}`, body: `hello ${i} — ünïcødé 🌿`, type: 'text' })) },
  secret: { keyBundle: { version: 1, deviceId: 'd', keys: [1, 2, 3], sessions: {} }, history: null },
};
const password = 'correct horse battery staple';

const file = await sealBackup(sample, password);
ok('seals to bytes starting with the magic', new TextDecoder().decode(file.subarray(0, 8)) === 'NOOKBAK1');

const head = peekBackup(file);
ok('header is readable without the password', head?.version === 1 && head.iterations >= MIN_ITERATIONS, JSON.stringify(head));
ok('payload was compressed', head?.compressed === true && file.length < JSON.stringify(sample).length);
ok('no plaintext leaks into the file', !Buffer.from(file).toString('latin1').includes('hello 1'));

const back = await openBackup(file, password);
ok('opens to exactly what went in', JSON.stringify(back) === JSON.stringify(sample));

ok('a wrong password is refused clearly', await rejects(openBackup(file, 'correct horse battery stapler'), 'wrong-password'));

const tampered = file.slice();
tampered[tampered.length - 20] ^= 0x01;
ok('a changed byte in the body is refused', await rejects(openBackup(tampered, password), 'wrong-password'));

const lowered = file.slice();
new DataView(lowered.buffer).setUint32(10, MIN_ITERATIONS + 1);
ok('a changed header is refused (it is authenticated too)', await rejects(openBackup(lowered, password), 'wrong-password'));

const weakened = file.slice();
new DataView(weakened.buffer).setUint32(10, 1000);
ok('an iteration count below the floor is refused before any work', await rejects(openBackup(weakened, password), 'corrupt'));

ok('something else entirely is not a backup', await rejects(openBackup(new TextEncoder().encode('PK a zip file, honestly'), password), 'not-a-backup'));

const again = await sealBackup(sample, password);
ok('two seals of the same data differ (fresh salt and IV)', Buffer.compare(Buffer.from(again), Buffer.from(file)) !== 0);

// Browsers without CompressionStream store the payload as-is, flagged.
const savedCS = globalThis.CompressionStream;
globalThis.CompressionStream = undefined;
const plain = await sealBackup({ a: 1 }, password);
globalThis.CompressionStream = savedCS;
ok('without CompressionStream it stores uncompressed, flagged', peekBackup(plain)?.compressed === false);
ok('and that still opens', JSON.stringify(await openBackup(plain, password)) === '{"a":1}');

ok('strength: empty scores 0', passwordStrength('').score === 0);
ok('strength: a common password scores 0', passwordStrength('password123').score === 0);
ok('strength: a long phrase scores high', passwordStrength('Quiet Kettle Orbits 42').score >= 3);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
