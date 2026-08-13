import { verifyAccess } from '../services/tokens.js';
import { findUserById } from '../db/users.js';
import { warmNicknames } from '../lib/nicknames.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    const { sub } = verifyAccess(token);
    const user = await findUserById(sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;

    // The serialisers read nicknames synchronously, so this viewer's map has
    // to be in memory before any handler runs. One small indexed query.
    await warmNicknames(user.id);

    next();
  } catch {
    return res.status(401).json({ error: 'Session expired.', code: 'TOKEN_EXPIRED' });
  }
}

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
