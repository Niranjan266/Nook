/**
 * Media pipeline.
 *
 * Cloudinary when configured; otherwise files land in server/uploads and are
 * served statically from /uploads. Same call signature either way, so nothing
 * upstream needs to know which one is active.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (env.cloudinary.enabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
  });
}

const kindFromMime = (mime = '') => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'raw';
};

/**
 * @param {{buffer: Buffer, originalname: string, mimetype: string, size: number}} file
 * @param {{folder?: string}} opts
 */
export async function uploadBuffer(file, { folder = 'nook' } = {}) {
  const kind = kindFromMime(file.mimetype);

  if (env.cloudinary.enabled) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: kind === 'raw' ? 'raw' : kind },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });

    // Cloudinary makes the thumbnail; we still make the blur placeholder,
    // because the point of a blurhash is that it arrives *with* the message.
    let blurhash = '';
    if (kind === 'image') {
      const { blurhashFor } = await import('./images.js');
      blurhash = await blurhashFor(file.buffer);
    }

    return {
      url: result.secure_url,
      blurhash,
      thumbUrl:
        kind === 'image'
          ? cloudinary.url(result.public_id, { width: 480, crop: 'limit', quality: 'auto', fetch_format: 'auto' })
          : kind === 'video'
            ? cloudinary.url(result.public_id, { resource_type: 'video', format: 'jpg', width: 480, crop: 'limit' })
            : '',
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      duration: result.duration,
      mime: file.mimetype,
      name: file.originalname,
      size: file.size,
      provider: 'cloudinary',
    };
  }

  // ── local disk fallback ─────────────────────────────────────────────────────
  const ext = path.extname(file.originalname) || '';
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, '');
  const dir = path.join(UPLOAD_DIR, safeFolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);

  /**
   * When the frontend is on a different host (Vercel) from the API, a relative
   * `/uploads/...` path would resolve against the frontend and 404. PUBLIC_URL
   * makes these absolute so media works regardless of where the app is served.
   */
  const path_ = `/uploads/${safeFolder}/${filename}`.replace(/\/+/g, '/');
  const url = env.publicUrl ? `${env.publicUrl}${path_}` : path_;
  const publicId = `${safeFolder}/${filename}`;

  // Images get a real thumbnail and a blur placeholder, so the local fallback
  // behaves like the CDN rather than serving 12 MB originals into a chat list.
  let thumbUrl = '';
  let blurhash = '';
  let size = {};
  if (kind === 'image') {
    const { makeThumbnail, blurhashFor, dimensions } = await import('./images.js');
    [thumbUrl, blurhash, size] = await Promise.all([
      makeThumbnail(file.buffer, publicId),
      blurhashFor(file.buffer),
      dimensions(file.buffer),
    ]);
  }

  return {
    url,
    thumbUrl: thumbUrl ? (env.publicUrl ? `${env.publicUrl}${thumbUrl}` : thumbUrl) : kind === 'image' ? url : '',
    blurhash,
    publicId,
    mime: file.mimetype,
    name: file.originalname,
    size: file.size,
    width: size.width,
    height: size.height,
    provider: 'local',
  };
}

export async function destroy(publicId, mime = '') {
  if (!publicId) return;
  if (env.cloudinary.enabled) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: kindFromMime(mime) });
    } catch {
      /* best effort */
    }
    return;
  }
  const target = path.join(UPLOAD_DIR, publicId);
  if (target.startsWith(UPLOAD_DIR) && fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch {
      /* best effort */
    }
  }
}

export const mediaProvider = () => (env.cloudinary.enabled ? 'cloudinary' : 'local-disk');
