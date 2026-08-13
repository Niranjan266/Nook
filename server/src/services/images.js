/**
 * Server-side image work: thumbnails and BlurHash.
 *
 * Cloudinary does this for you. The local-disk fallback did not, which meant
 * self-hosted Nook had no thumbnails at all — every chat loaded full-size
 * originals. `sharp` closes that gap.
 *
 * sharp is an optional dependency: it ships prebuilt binaries for common
 * platforms, but if it fails to install we degrade to "no thumbnail" rather
 * than refusing to start.
 */
import path from 'node:path';
import fs from 'node:fs';
import { encode } from 'blurhash';
import { UPLOAD_DIR } from './media.js';

let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.log('  images    sharp unavailable — thumbnails and blurhash disabled');
}

export const canProcess = () => Boolean(sharp);

/**
 * A BlurHash is ~30 characters that decode to a blurred version of the image.
 * It travels inside the message, so the recipient sees the shape of a photo
 * instantly instead of a grey rectangle — even on a slow connection.
 */
export async function blurhashFor(buffer) {
  if (!sharp) return '';
  try {
    const { data, info } = await sharp(buffer)
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return '';
  }
}

/** A 480px-wide JPEG next to the original, served from the same /uploads path. */
export async function makeThumbnail(buffer, publicId) {
  if (!sharp) return '';
  try {
    const ext = path.extname(publicId);
    const thumbId = `${publicId.slice(0, -ext.length || undefined)}-thumb.jpg`;
    const target = path.join(UPLOAD_DIR, thumbId);
    if (!target.startsWith(UPLOAD_DIR)) return '';

    fs.mkdirSync(path.dirname(target), { recursive: true });
    await sharp(buffer)
      .rotate() // honour EXIF orientation, or portrait photos arrive sideways
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true })
      .toFile(target);

    return `/uploads/${thumbId}`.replace(/\/+/g, '/');
  } catch {
    return '';
  }
}

export async function dimensions(buffer) {
  if (!sharp) return {};
  try {
    const { width, height } = await sharp(buffer).metadata();
    return { width, height };
  } catch {
    return {};
  }
}
