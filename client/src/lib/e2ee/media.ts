/**
 * Attachments in secret chats.
 *
 * A file is encrypted on this device with a key made just for it, and only
 * the ciphertext is uploaded — as an anonymous `application/octet-stream`, so
 * the storage provider sees neither the picture nor what kind of file it was.
 * The key, IV and real type travel inside the encrypted message.
 */
import { mediaUrl } from '@/lib/config';
import { decryptBytes, encryptBytes } from './crypto';

export async function encryptFile(file: Blob): Promise<{ blob: Blob; key: string; iv: string }> {
  const { data, key, iv } = await encryptBytes(new Uint8Array(await file.arrayBuffer()));
  return { blob: new Blob([data], { type: 'application/octet-stream' }), key, iv };
}

/** One download and decryption per file per session, however many bubbles ask. */
const opened = new Map<string, Promise<string>>();

/** Fetch the ciphertext, open it, and hand back a local blob: URL. */
export function decryptedUrl(url: string, key: string, iv: string, mime: string): Promise<string> {
  const cacheKey = `${url}#${iv}`;
  let job = opened.get(cacheKey);
  if (!job) {
    job = (async () => {
      const res = await fetch(mediaUrl(url));
      if (!res.ok) throw new Error(`That file is gone (${res.status}).`);
      const plain = await decryptBytes(new Uint8Array(await res.arrayBuffer()), key, iv);
      return URL.createObjectURL(new Blob([plain], { type: mime || 'application/octet-stream' }));
    })();
    // A failure is not cached, so a flaky network gets another try.
    job.catch(() => opened.delete(cacheKey));
    opened.set(cacheKey, job);
  }
  return job;
}

/** Sign-out: let go of every decrypted file this session made. */
export function forgetDecrypted() {
  for (const job of opened.values()) job.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  opened.clear();
}
