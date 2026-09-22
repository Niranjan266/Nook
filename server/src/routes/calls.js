import { Router } from 'express';
import { listCalls } from '../db/misc.js';
import { asyncRoute, requireAuth } from '../middleware/auth.js';
import { iceServers } from '../services/turn.js';

const router = Router();
router.use(requireAuth);

// Behind requireAuth above: these are relay credentials, and a stranger who
// could mint them would be relaying their traffic on our bill.
router.get(
  '/ice',
  asyncRoute(async (req, res) => {
    // Credentials — never let a proxy or the browser cache hand them on.
    res.set('Cache-Control', 'no-store');
    res.json({ iceServers: await iceServers() });
  })
);

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const rows = await listCalls(req.user.id);

    res.json({
      calls: rows.map((c) => {
        const outgoing = c.caller_id === req.user.id;
        return {
          id: c.id,
          conversationId: c.conversation_id,
          direction: outgoing ? 'outgoing' : 'incoming',
          kind: c.kind,
          status: c.status,
          duration: c.duration,
          at: new Date(c.started_at).toISOString(),
          with: {
            id: outgoing ? c.callee_id : c.caller_id,
            username: outgoing ? c.callee_username : c.caller_username,
            displayName: outgoing ? c.callee_name : c.caller_name,
            avatarUrl: outgoing ? c.callee_avatar : c.caller_avatar,
            accent: outgoing ? c.callee_accent : c.caller_accent,
          },
        };
      }),
    });
  })
);

export default router;
