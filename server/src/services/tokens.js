import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';

export function signAccess(userId) {
  return jwt.sign({ sub: String(userId) }, env.accessSecret, { expiresIn: env.accessTtl });
}

export function signRefresh(userId) {
  return jwt.sign({ sub: String(userId) }, env.refreshSecret, { expiresIn: env.refreshTtl });
}

export function verifyAccess(token) {
  // Pin the algorithm. With a string secret jsonwebtoken already refuses
  // `alg: none`, but that guarantee quietly disappears if the secret ever
  // becomes a KeyObject, and the cost of being explicit is nothing.
  return jwt.verify(token, env.accessSecret, { algorithms: ['HS256'] });
}

export function verifyRefresh(token) {
  return jwt.verify(token, env.refreshSecret, { algorithms: ['HS256'] });
}

export const REFRESH_COOKIE = 'nook_rt';

/**
 * Cookie options.
 *
 * With COOKIE_DOMAIN set (app and API on subdomains of one domain) the cookie
 * is first-party, so `SameSite=Lax` is both sufficient and immune to the
 * third-party cookie blocking that Safari and Firefox do by default.
 *
 * Without it we're forced into `SameSite=None`, which Chrome still largely
 * accepts — Google abandoned the forced deprecation in 2024 — but Safari and
 * Firefox drop. So this is not a future deadline, it is a present-day split:
 * sessions survive on Chrome and quietly die on iPhone.
 */
function cookieOptions() {
  const sameSite = env.cookieDomain ? 'lax' : isProd ? 'none' : 'lax';
  return {
    httpOnly: true,
    sameSite,
    // SameSite=None is only honoured on a secure connection.
    secure: isProd || sameSite === 'none',
    path: '/api/auth',
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
  };
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

/**
 * Native clients can't use an httpOnly cookie, so they get the refresh token in
 * the response body and keep it in the device keychain (expo-secure-store).
 *
 * This is *only* done for native. Returning it to a browser would put a
 * long-lived credential somewhere JavaScript can read it, which is exactly what
 * the httpOnly cookie exists to prevent. The header can be spoofed, but a
 * spoofer would only be handing themselves a token they already authenticated
 * for — it grants nothing extra.
 */
export const isNativeClient = (req) => req.get('x-nook-client') === 'native';

/** Attach the session the right way for whichever client is asking. */
export function attachSession(req, res, userId) {
  const refresh = signRefresh(userId);
  if (isNativeClient(req)) return { refreshToken: refresh };
  setRefreshCookie(res, refresh);
  return {};
}

/** The refresh token, from wherever this client keeps it. */
export const readRefreshToken = (req) =>
  req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE] || null;

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}
