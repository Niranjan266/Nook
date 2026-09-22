/**
 * The sticker tray: stickers someone has made, kept for reuse.
 *
 * Making one happens on the device; the file goes up through /api/media with
 * `kind: 'sticker'` like any other upload, and this is where it is then kept.
 * Everything here is scoped to the signed-in person — nobody can list, reorder
 * or delete another person's tray, and a missing sticker and someone else's
 * sticker get the same 404 so ids cannot be probed.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { uploadOwner } from '../db/messages.js';
import { isOwnMediaUrl } from '../lib/sendPayload.js';
import * as S from '../db/stickers.js';

const router = Router();
router.use(requireAuth);

/** Enough for a real collection; a tray scrolled past this is not being browsed. */
export const STICKER_CAP = 120;

const createSchema = z.object({
  url: z.string().max(2048),
  publicId: z.string().max(300),
  width: z.number().int().positive().max(4096).optional(),
  height: z.number().int().positive().max(4096).optional(),
});

router.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ stickers: await S.listStickers(req.user.id), cap: STICKER_CAP });
  })
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = createSchema.parse(req.body ?? {});

    /**
     * Only a file this person uploaded as a sticker. Without the ownership
     * check anyone could add a photo from someone else's chat to their tray by
     * its id; without the folder check, any upload at all — a 60 MB video —
     * could be dressed up as a sticker and skip the sticker size limit.
     */
    const owner = await uploadOwner(body.publicId);
    if (!owner || String(owner) !== String(req.user.id)) throw httpError(403, 'That upload is not yours.');
    if (!body.publicId.startsWith('nook/stickers/')) throw httpError(400, 'That upload is not a sticker.');
    if (!isOwnMediaUrl(body.url) || !body.url.includes(body.publicId))
      throw httpError(400, 'That sticker link does not match its upload.');

    // Saving the same upload twice — a double tap, a retry — is not two stickers.
    const existing = await S.findStickerByUpload(req.user.id, body.publicId);
    if (existing) return res.json({ sticker: existing });

    if ((await S.countStickers(req.user.id)) >= STICKER_CAP)
      throw httpError(409, `You have ${STICKER_CAP} stickers — delete one to make room.`, { code: 'STICKER_CAP' });

    const sticker = await S.createSticker({
      userId: req.user.id,
      url: body.url,
      publicId: body.publicId,
      width: body.width || 512,
      height: body.height || 512,
    });
    res.status(201).json({ sticker });
  })
);

/** Sent just now — move it to the front of the tray. */
router.post(
  '/:id/use',
  asyncRoute(async (req, res) => {
    if (!(await S.touchSticker(req.user.id, req.params.id))) throw httpError(404, 'No such sticker.');
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    // The file stays: every chat it was already sent to still shows it.
    if (!(await S.deleteSticker(req.user.id, req.params.id))) throw httpError(404, 'No such sticker.');
    res.json({ ok: true });
  })
);

export default router;
