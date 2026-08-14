import { verifyAccess } from '../services/tokens.js';
import { findUserById } from '../db/users.js';
import { warmNicknames } from '../lib/nicknames.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    const { sub, iat } = verifyAccess(token);
    const user = await findUserById(sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

    /**
     * Force sign-out. JWTs are stateless so there is nothing to revoke; the
     * cheapest honest answer is to refuse anything minted before the moment
     * the admin pressed the button.
     *
     * The comparison needs care. `iat` is in **seconds**, floored, while the
     * epoch is in milliseconds — so a token issued 800 ms after the bump
     * carries an `iat` that, multiplied up, lands *before* it. Comparing them
     * naively rejects tokens created after the sign-out, and the user can
     * never sign back in.
     *
     * So reject only when the token's whole second finished before the epoch.
     * That leaves a sub-second window where a token issued in the same second
     * survives, which is a fair trade for the account not being bricked.
     */
    if (user.tokenEpoch && (iat + 1) * 1000 <= user.tokenEpoch)
      return res.status(401).json({ error: 'Signed out. Please sign in again.', code: 'TOKEN_EXPIRED' });

    // Checked on every request rather than at sign-in, so suspending somebody
    // takes effect on their next action instead of whenever their token
    // happens to expire.
    if (user.suspended)
      return res.status(403).json({ error: 'This account has been suspended.', code: 'SUSPENDED' });

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
