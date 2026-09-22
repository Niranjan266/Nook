import { Router } from 'express';
import multer from 'multer';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { uploadBuffer, mediaProvider } from '../services/media.js';
import { recordUpload } from '../db/messages.js';

const router = Router();
router.use(requireAuth);

const MAX = 64 * 1024 * 1024; // 64 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX },
});

const FOLDERS = {
  message: 'nook/messages',
  avatar: 'nook/avatars',
  wallpaper: 'nook/wallpapers',
  voice: 'nook/voice',
  sticker: 'nook/stickers',
};

/**
 * Stickers are made on the device at 512px and land well under this. The cap
 * is generous for that and tight for anything else: a sticker is rendered
 * inline in every chat it is sent to, so a 20 MB "sticker" would be a 20 MB
 * download for everyone in the room.
 */
export const STICKER_MAX_BYTES = 400 * 1024;

/**
 * Checked by the file's first bytes, not the type the browser claimed, since
 * the claimed type is just a form field. Only WebP and PNG: both keep the
 * transparent die-cut edge, and neither can carry a script the way SVG can.
 */
function stickerType(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' };
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a)
    return { mime: 'image/png', ext: 'png' };
  return null;
}

router.post(
  '/',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpError(400, 'No file arrived.');
    const kind = FOLDERS[req.body.kind] ? req.body.kind : 'message';

    if (kind === 'sticker') {
      if (req.file.size > STICKER_MAX_BYTES) throw httpError(413, 'That sticker is too big.');
      const type = stickerType(req.file.buffer);
      if (!type) throw httpError(415, 'Stickers must be WebP or PNG.');
      // The sniffed type decides how it is stored and served, not the name it came with.
      req.file.mimetype = type.mime;
      req.file.originalname = `sticker.${type.ext}`;
    }

    const result = await uploadBuffer(req.file, { folder: FOLDERS[kind], plain: kind === 'sticker' });
    // Remembered so a message can only carry a file id its sender uploaded.
    if (result.publicId) await recordUpload(result.publicId, req.user.id);
    res.status(201).json({ media: result, provider: mediaProvider() });
  })
);

router.get('/provider', (req, res) => res.json({ provider: mediaProvider(), maxBytes: MAX }));

export default router;
