/**
 * Google Drive refresh tokens, sealed at rest.
 *
 * A refresh token is a standing key to somebody's Drive app folder. It sits in
 * the database for months, and databases leak in boring ways — a dump shared
 * to debug something, a backup bucket left readable. So the column holds
 * AES-256-GCM ciphertext, and the key lives only in the environment: a copy of
 * the database on its own opens nothing.
 *
 * The user id is bound in as additional data, so a row copied onto another
 * account fails to decrypt instead of quietly handing over the first
 * person's Drive.
 */
import crypto from 'node:crypto';

const VERSION = 'v1';
let cached = null;

/**
 * The 32-byte key, derived once.
 *
 * BACKUP_TOKEN_KEY is the intended source. Without it the key is derived from
 * JWT_REFRESH_SECRET with HKDF — a different purpose label means a leaked
 * token key still says nothing about session signing, and vice versa — so a
 * deployment that has not set the new variable still works, and says so once.
 */
export function tokenKey() {
  if (cached) return cached;

  let secret = (process.env.BACKUP_TOKEN_KEY || '').trim();
  let info = 'nook/drive-refresh-token/v1';

  if (!secret) {
    secret = (process.env.JWT_REFRESH_SECRET || '').trim();
    info = 'nook/drive-refresh-token/v1/from-jwt-refresh';
    if (secret) {
      console.log('  backup    BACKUP_TOKEN_KEY not set - deriving the Drive token key from JWT_REFRESH_SECRET');
    } else {
      // Development with no secrets at all. A per-boot key means stored links
      // stop working on restart, which is exactly what a missing secret should
      // feel like: noticeable, not dangerous.
      secret = crypto.randomBytes(32).toString('hex');
      console.log('  backup    no BACKUP_TOKEN_KEY or JWT_REFRESH_SECRET - Drive links will not survive a restart');
    }
  }

  cached = Buffer.from(crypto.hkdfSync('sha256', secret, 'nook-backup-token-salt', info, 32));
  return cached;
}

/** Tests swap the environment between cases; production never calls this. */
export function resetTokenKey() {
  cached = null;
}

export function encryptToken(plain, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** Returns the token, or null when it cannot be opened — never throws. */
export function decryptToken(sealed, userId) {
  try {
    const [version, ivPart, bodyPart] = String(sealed || '').split('.');
    if (version !== VERSION || !ivPart || !bodyPart) return null;
    const iv = Buffer.from(ivPart, 'base64url');
    const body = Buffer.from(bodyPart, 'base64url');
    if (iv.length !== 12 || body.length < 17) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAAD(Buffer.from(String(userId)));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
