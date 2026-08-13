import { Router } from 'express';
import multer from 'multer';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { uploadBuffer, mediaProvider } from '../services/media.js';

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
};

router.post(
  '/',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpError(400, 'No file arrived.');
    const kind = FOLDERS[req.body.kind] ? req.body.kind : 'message';
    const result = await uploadBuffer(req.file, { folder: FOLDERS[kind] });
    res.status(201).json({ media: result, provider: mediaProvider() });
  })
);

router.get('/provider', (req, res) => res.json({ provider: mediaProvider(), maxBytes: MAX }));

export default router;
