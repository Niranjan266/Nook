import 'dotenv/config';
import crypto from 'node:crypto';

const bool = (v) => Boolean(v && String(v).trim());

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Let *.vercel.app preview builds talk to this API. Off by default. */
  allowVercelPreviews: process.env.ALLOW_VERCEL_PREVIEWS === '1',

  /** Public origin of this API, e.g. https://api.yoursite.com — no trailing slash. */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  /**
   * Where the *app* lives — the link people click in emails. Distinct from
   * PUBLIC_URL, which is where the API lives: a button pointing at the API
   * would open a JSON 404. Falls back to the first allowed client origin,
   * which is right in every deployment we have.
   */
  appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, ''),

  /**
   * Set to `.yoursite.com` when the app and API are subdomains of one domain.
   * The refresh cookie then belongs to the whole site, which makes it
   * first-party.
   *
   * That matters because Safari and Firefox block third-party cookies by
   * default, and have for years. (Google abandoned Chrome's forced deprecation
   * in 2024 — Chrome now asks the user instead — so Chrome is the lenient case,
   * not the deadline.) Without this set, the cookie is cross-site and Safari
   * and Firefox users are silently signed out on refresh while Chrome users
   * are mostly fine, which is the worst kind of bug to be told about.
   */
  cookieDomain: process.env.COOKIE_DOMAIN || '',

  /**
   * Turso (libSQL). Leave both empty in development and the server writes to
   * server/data/nook.db — a real SQLite file, no signup, survives restarts.
   */
  turso: {
    url: (process.env.TURSO_DATABASE_URL || '').trim(),
    authToken: (process.env.TURSO_AUTH_TOKEN || '').trim(),
  },

  accessSecret: process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex'),
  refreshSecret: process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex'),
  accessTtl: process.env.ACCESS_TTL || '15m',
  refreshTtl: process.env.REFRESH_TTL || '30d',

  cloudinary: {
    enabled:
      bool(process.env.CLOUDINARY_CLOUD_NAME) &&
      bool(process.env.CLOUDINARY_API_KEY) &&
      bool(process.env.CLOUDINARY_API_SECRET),
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  brevo: {
    enabled: bool(process.env.BREVO_API_KEY),
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'no-reply@nook.app',
    senderName: process.env.BREVO_SENDER_NAME || 'Nook',
  },

  /**
   * Gmail over its HTTPS API. Not SMTP: Render blocks outbound 25/465/587 on
   * free instances, so smtp.gmail.com times out there with no useful error.
   * Port 443 is never blocked, which is why this route works everywhere.
   */
  gmail: {
    clientId: (process.env.GMAIL_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GMAIL_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.GMAIL_REFRESH_TOKEN || '').trim(),
    sender: (process.env.GMAIL_SENDER || '').trim(),
    senderName: process.env.GMAIL_SENDER_NAME || 'Nook',
  },

  /**
   * Sign in with Google. Uses the server-side authorization-code flow, so a
   * client secret is required — unlike the browser ID-token flow, which needs
   * only the ID but forces you to use Google's own button.
   */
  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  },

  /**
   * The admin panel at /nookcontrol.
   *
   * `ADMIN_PASSWORD_HASH` holds a bcrypt hash, never the password itself — a
   * plaintext admin password in an environment variable is readable by anyone
   * with dashboard access and shows up in screenshots. Generate one with
   * Make-Admin.bat.
   */
  admin: {
    emails: process.env.ADMIN_EMAILS || 'supportnookchat@gmail.com',
    username: (process.env.ADMIN_USERNAME || '').trim(),
    passwordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim(),
  },

  /**
   * `auto` picks Gmail if it is configured, then Brevo, then the console.
   * Set it explicitly to pin one — useful when both are configured and you
   * want to be certain which is in play.
   */
  mailProvider: (process.env.MAIL_PROVIDER || 'auto').trim().toLowerCase(),

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:hello@nook.app',
  },

  ice: {
    stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnUrl: process.env.TURN_URL || '',
    turnUsername: process.env.TURN_USERNAME || '',
    turnCredential: process.env.TURN_CREDENTIAL || '',
  },
};

export const isProd = env.nodeEnv === 'production';

export function iceServers() {
  const servers = [{ urls: env.ice.stun }];
  if (env.ice.turnUrl) {
    servers.push({
      urls: env.ice.turnUrl,
      username: env.ice.turnUsername,
      credential: env.ice.turnCredential,
    });
  }
  return servers;
}
