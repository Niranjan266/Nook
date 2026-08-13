import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { fetchPreview } from '../services/linkPreview.js';

const router = Router();
router.use(requireAuth);

// The server is doing the outbound fetching, so this endpoint is worth
// rate-limiting harder than the rest of the API.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many link previews.' },
});

router.get(
  '/preview',
  limiter,
  asyncRoute(async (req, res) => {
    try {
      const preview = await fetchPreview(String(req.query.url || ''));
      res.json({ preview });
    } catch (err) {
      // A failed preview is normal, not an error worth alarming the client about.
      res.json({ preview: null, reason: err.message });
    }
  })
);

export default router;
