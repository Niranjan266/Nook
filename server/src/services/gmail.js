/**
 * Sending through Gmail — over its HTTPS API, deliberately not SMTP.
 *
 * The obvious way to "use Gmail" is smtp.gmail.com on port 587. That cannot
 * work here: Render blocks outbound traffic on ports 25, 465 and 587 for free
 * instances, and port 25 on every plan. The failure is a connection timeout
 * with no explanation, which reads like a bug in your own code.
 *
 * Gmail also has a REST API on port 443, which nothing blocks. It costs an
 * OAuth setup once, and then it works everywhere — locally, on Render free,
 * and on any host that would have blocked SMTP.
 *
 * No new dependency: an access-token refresh is one form POST, and a message
 * is a base64url'd RFC 822 blob.
 */
import { env } from '../config/env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Access tokens last an hour. Caching one avoids a round trip to Google on
 * every send, and the 60-second margin means we never present a token that
 * expires in flight.
 */
let cached = { token: '', expiresAt: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.gmail.clientId,
      client_secret: env.gmail.clientSecret,
      refresh_token: env.gmail.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's errors here are terse and the cause is nearly always one of a
    // small set, so name them rather than passing "invalid_grant" through.
    const hint =
      data.error === 'invalid_grant'
        ? ' — the refresh token was revoked, expired, or belongs to a different client. Re-run Gmail-Auth.bat.'
        : data.error === 'invalid_client'
          ? ' — GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET is wrong.'
          : '';
    throw new Error(`Gmail auth failed (${res.status}): ${data.error || 'unknown'}${hint}`);
  }

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60_000,
  };
  return cached.token;
}

/**
 * Headers must be ASCII. A subject with anything else — our welcome subject
 * contains a curly apostrophe — has to be encoded-word wrapped per RFC 2047,
 * or recipients see mojibake in the one line they read before deciding whether
 * to open it.
 */
const encodeHeader = (value) =>
  /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

/** RFC 2045 caps encoded lines at 76 characters. Some parsers enforce it. */
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

function buildMime({ from, to, subject, html, text }) {
  const boundary = `nook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  // multipart/alternative, plain text first: the spec says the *last* part is
  // the preferred one, so HTML must come second or text-capable clients will
  // show the plain version to everyone.
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html, 'utf8').toString('base64')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Gmail wants base64url, not base64: no padding, `-` and `_` for `+` and `/`. */
const base64url = (s) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sendViaGmail({ to, subject, html, text }) {
  const token = await accessToken();

  // Gmail rewrites From to the authenticated account unless the address is a
  // verified "Send mail as" alias on that account, so this is a request, not a
  // guarantee. Worth setting anyway: when the alias is configured it is
  // honoured, and when it is not, Gmail quietly corrects it rather than
  // failing.
  const from = `${env.gmail.senderName} <${env.gmail.sender}>`;
  const raw = base64url(buildMime({ from, to, subject, html, text }));

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // A 403 here is almost always the Gmail API not being enabled on the
    // project, which the raw message does not make obvious.
    const hint = res.status === 403 ? ' — is the Gmail API enabled for this Google Cloud project?' : '';
    throw new Error(`Gmail send failed (${res.status})${hint}: ${detail.slice(0, 300)}`);
  }

  return res.json();
}

export const gmailReady = () =>
  Boolean(env.gmail.clientId && env.gmail.clientSecret && env.gmail.refreshToken && env.gmail.sender);
