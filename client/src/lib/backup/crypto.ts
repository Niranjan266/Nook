/**
 * The .nookbak container: compress, then seal with a password.
 *
 * No imports on purpose — this file is also run directly by Node for the
 * self-test (scripts/backup-selftest.mjs), so it may only use what a browser
 * and Node 24 both have globally: WebCrypto, CompressionStream, TextEncoder.
 *
 * Layout, all big-endian:
 *
 *   0   8  magic "NOOKBAK1"
 *   8   1  format version (1)
 *   9   1  flags — bit 0 set when the payload is gzipped
 *   10  4  PBKDF2 iterations
 *   14  16 salt
 *   30  12 AES-GCM IV
 *   42  …  ciphertext, with GCM's 16-byte tag at the end
 *
 * The header is plaintext because decrypting needs it, but it is fed to GCM
 * as additional data, so editing it — lowering the iteration count, flipping
 * the compression flag — breaks the tag exactly like editing the ciphertext.
 */

export const MAGIC = 'NOOKBAK1';
const VERSION = 1;
const HEADER_BYTES = 42;
const FLAG_GZIP = 1;

/**
 * OWASP's current figure for PBKDF2-SHA256. A second or so on an old phone,
 * once per backup — cheap for the owner, ruinous for anyone guessing.
 */
export const ITERATIONS = 600_000;
/** Refused below this on open, so a doctored header cannot make guessing cheap. */
export const MIN_ITERATIONS = 310_000;
/** And above this, so a doctored header cannot freeze the page for minutes. */
const MAX_ITERATIONS = 10_000_000;

export type BackupErrorCode = 'not-a-backup' | 'unsupported' | 'wrong-password' | 'corrupt' | 'other-account';

export class BackupError extends Error {
  code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const te = new TextEncoder();
const td = new TextDecoder();

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(through as any);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Seal any JSON-able value. Returns the whole file, header included. */
export async function sealBackup(
  data: unknown,
  password: string,
  { iterations = ITERATIONS }: { iterations?: number } = {}
): Promise<Uint8Array> {
  if (!password) throw new BackupError('wrong-password', 'A backup needs a password.');

  let payload: Uint8Array = te.encode(JSON.stringify(data));
  // Chat text shrinks five- to tenfold. Browsers without CompressionStream
  // still get a working backup, just a bigger one — the flag says which.
  const gzip = canGzip();
  if (gzip) payload = await pipe(payload, new CompressionStream('gzip'));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const header = new Uint8Array(HEADER_BYTES);
  header.set(te.encode(MAGIC), 0);
  const view = new DataView(header.buffer);
  view.setUint8(8, VERSION);
  view.setUint8(9, gzip ? FLAG_GZIP : 0);
  view.setUint32(10, iterations);
  header.set(salt, 14);
  header.set(iv, 30);

  const key = await deriveKey(password, salt, iterations);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource },
      key,
      payload as BufferSource
    )
  );

  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(header, 0);
  out.set(sealed, HEADER_BYTES);
  return out;
}

/** What the header says, without a password. Null when it is not a backup at all. */
export function peekBackup(bytes: Uint8Array): { version: number; compressed: boolean; iterations: number } | null {
  if (bytes.length < HEADER_BYTES + 16) return null;
  if (td.decode(bytes.subarray(0, 8)) !== MAGIC) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  return { version: view.getUint8(8), compressed: (view.getUint8(9) & FLAG_GZIP) !== 0, iterations: view.getUint32(10) };
}

/** Open a file made by sealBackup. Throws BackupError with a message fit to show. */
export async function openBackup(bytes: Uint8Array, password: string): Promise<unknown> {
  const head = peekBackup(bytes);
  if (!head) throw new BackupError('not-a-backup', "That isn't a Nook backup file.");
  if (head.version !== VERSION)
    throw new BackupError('unsupported', 'This backup was made by a newer version of Nook. Update the app and try again.');
  if (head.iterations < MIN_ITERATIONS || head.iterations > MAX_ITERATIONS)
    throw new BackupError('corrupt', 'This backup file has been damaged or altered.');
  if (head.compressed && !canGzip())
    throw new BackupError('unsupported', "This browser can't unpack compressed backups. Try a current Chrome, Edge, Firefox or Safari.");

  const header = bytes.subarray(0, HEADER_BYTES);
  const key = await deriveKey(password, bytes.slice(14, 30), head.iterations);

  let payload: Uint8Array;
  try {
    payload = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(30, 42) as BufferSource, additionalData: header.slice() as BufferSource },
        key,
        bytes.slice(HEADER_BYTES) as BufferSource
      )
    );
  } catch {
    // GCM cannot tell a wrong password from a changed file — both are a tag
    // that does not match. The password is overwhelmingly the likelier one.
    throw new BackupError(
      'wrong-password',
      "That password doesn't open this backup. Check it and try again — or the file was changed after it was made."
    );
  }

  try {
    if (head.compressed) payload = await pipe(payload, new DecompressionStream('gzip'));
    return JSON.parse(td.decode(payload));
  } catch {
    throw new BackupError('corrupt', 'The backup opened but its contents are damaged.');
  }
}

/**
 * A rough strength score, 0–4, for the meter under the password field.
 *
 * Length does most of the work, because it is what actually resists guessing,
 * with a nudge for mixing kinds of character and a penalty for the obvious.
 * Advisory only: a backup password is the person's call.
 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; hint: string } {
  if (!pw) return { score: 0, hint: 'Choose a password only you know.' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const common = /^(password|nook|qwerty|letmein|123456|111111|iloveyou)/i.test(pw) || /^(.)\1+$/.test(pw);
  let score = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : pw.length >= 8 ? 1 : 0;
  if (kinds >= 3 && pw.length >= 10) score += 1;
  if (common) score = 0;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const hint =
    s === 0
      ? pw.length < 8
        ? 'Too short — at least 8 characters, ideally a few words.'
        : 'Too easy to guess.'
      : s === 1
        ? 'Okay. Longer is much stronger — try a short phrase.'
        : s === 2
          ? 'Good.'
          : 'Strong.';
  return { score: s, hint };
}
