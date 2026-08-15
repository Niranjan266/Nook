import { Router } from 'express';
import { z } from 'zod';
import {
  upsertPushSubscription,
  deletePushSubscription,
  saveDevice,
  deleteDevice,
} from '../db/misc.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { publicVapidKey, notify } from '../services/push.js';
import { TEMPLATES } from '../services/templates.js';
import { fcmReady } from '../services/fcm.js';

const router = Router();

router.get('/key', (req, res) => res.json({ publicKey: publicVapidKey() }));

/**
 * What this server can actually deliver.
 *
 * The app asks before it registers, so an APK talking to a server with no
 * Firebase credentials can say "notifications are not set up on this server"
 * rather than registering into a void and appearing broken.
 */
router.get('/capabilities', (req, res) =>
  res.json({ web: Boolean(publicVapidKey()), native: fcmReady() })
);

router.use(requireAuth);

router.post(
  '/subscribe',
  asyncRoute(async (req, res) => {
    const sub = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(req.body);

    await upsertPushSubscription({
      userId: req.user.id,
      endpoint: sub.endpoint,
      keys: sub.keys,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json({ ok: true });
  })
);

/* ── the Android app ──────────────────────────────────────────────────────
   A different transport with a different token shape, so a different route
   rather than an overloaded one.                                          */

router.post(
  '/device',
  asyncRoute(async (req, res) => {
    const { token, platform } = z
      .object({
        token: z.string().min(20).max(4096),
        platform: z.enum(['android', 'ios']).optional().default('android'),
      })
      .parse(req.body);

    await saveDevice(req.user.id, token, platform);
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/device',
  asyncRoute(async (req, res) => {
    if (req.body?.token) await deleteDevice(req.body.token);
    res.json({ ok: true });
  })
);

router.post(
  '/unsubscribe',
  asyncRoute(async (req, res) => {
    if (req.body?.endpoint) await deletePushSubscription(req.body.endpoint);
    res.json({ ok: true });
  })
);

router.post(
  '/test',
  asyncRoute(async (req, res) => {
    const sent = await notify(req.user.id, TEMPLATES.pushTest.push({}));
    res.json({ sent });
  })
);

export default router;
