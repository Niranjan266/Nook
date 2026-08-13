import { Router } from 'express';
import { z } from 'zod';
import { upsertPushSubscription, deletePushSubscription } from '../db/misc.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { publicVapidKey, notify } from '../services/push.js';

const router = Router();

router.get('/key', (req, res) => res.json({ publicKey: publicVapidKey() }));

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
    const sent = await notify(req.user.id, {
      title: 'Nook',
      body: 'Notifications are working. This is the only one you asked for.',
      tag: 'nook-test',
    });
    res.json({ sent });
  })
);

export default router;
