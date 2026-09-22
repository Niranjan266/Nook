/**
 * Firebase Cloud Messaging, for the Android app.
 *
 * The browser and the app need different transports, and neither can stand in
 * for the other. Web Push does not exist inside an Android WebView, so the
 * APK cannot use the VAPID subscriptions the site uses; FCM cannot reach a
 * desktop browser. So `notify()` sends to both and each person receives on
 * whichever they actually have.
 *
 * Configured exactly like the mail provider: absent credentials mean this
 * quietly reports itself as unconfigured rather than throwing at boot, so a
 * deployment without Firebase runs perfectly well and simply has no native
 * push. The one thing it must never do is claim to have sent something.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * The service account JSON, as one environment variable.
 *
 * A file on disk would be lost on every deploy of an ephemeral container, and
 * three separate variables invite the mistake of updating two of them. Newlines
 * inside the private key survive JSON encoding, which is why it is stored
 * whole rather than field by field.
 */
function credentials() {
  const raw = (process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch {
    // A malformed value is worth one line in the log: silently behaving as
    // "not configured" would look identical to never having set it.
    console.error('  push      FCM_SERVICE_ACCOUNT is set but is not valid JSON — native push is off');
    return null;
  }
}

export const fcmReady = () => Boolean(credentials());

/** What is missing, by name only — never a value. */
export function fcmMissing() {
  if (process.env.FCM_SERVICE_ACCOUNT) return [];
  return ['FCM_SERVICE_ACCOUNT'];
}

/* ── access token ─────────────────────────────────────────────────────────── */

let cached = { token: '', expires: 0 };

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Google wants a signed JWT traded for an access token. Cached with a minute
 * of margin: tokens last an hour, and refreshing on the exact boundary means
 * occasionally using one that expired in flight.
 */
async function accessToken() {
  const creds = credentials();
  if (!creds) return null;
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(creds.private_key));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  if (!res.ok) {
    console.error(`  push      FCM token exchange failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data = await res.json();
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

/* ── send ─────────────────────────────────────────────────────────────────── */

/**
 * Nook's vibration signature, as FCM durations. Mirrors BUZZ in the client's
 * lib/native.ts and MainActivity; change all three together. On Android 8+
 * the channel owns the buzz and these are ignored — they are for older phones,
 * where the notification itself carries it.
 */
const BUZZ = {
  message: [0, 80, 70, 80, 70, 220],
  call: [0, 180, 110, 420, 650, 180, 110, 420, 650, 180, 110, 420],
};
const timings = (ms) => ms.map((n) => `${(n / 1000).toFixed(3)}s`);

/**
 * The FCM message for one device.
 *
 * Split out from the send so the channel choice can be tested without a
 * network. `device.channels` is what the APK told us it created: v2 channels
 * only exist from 1.0.8, and naming a channel the phone lacks silently drops
 * the custom sound.
 */
export function buildMessage(token, payload, device = {}) {
  const v2 = Number(device.channels) >= 2;
  const kind = payload.urgent ? 'call' : 'message';
  const channel = (payload.urgent ? 'calls' : 'messages') + (v2 ? '_v2' : '');

  return {
    message: {
      token,
      /**
       * `notification` (not data-only) so Android draws it even when the app
       * has been killed. A data-only message is delivered to the app, which
       * cannot run if the user swiped it away — the exact case a notification
       * exists for.
       */
      notification: {
        title: payload.title || 'Nook',
        body: payload.body || '',
      },
      data: {
        conversationId: String(payload.conversationId || ''),
        messageId: String(payload.messageId || ''),
        kind: String(payload.kind || 'message'),
      },
      android: {
        // High priority wakes the device out of Doze. A chat message is
        // exactly what this is for; anything routine should not use it.
        priority: 'high',
        notification: {
          // The channel carries the custom sound and the vibration pattern.
          // Naming it here rather than relying on the default is what makes a
          // per-app sound possible at all on Android 8 and later.
          channel_id: channel,
          tag: payload.tag || `nook-${payload.conversationId || 'general'}`,
          icon: 'ic_stat_nook',
          color: '#C0603C',
          // Pre-Oreo has no channels, so the sound and buzz ride on the
          // notification. Only for v2 builds: older APKs lack the _v2 sounds.
          ...(v2 && {
            sound: `nook_${kind}_v2`,
            default_sound: false,
            vibrate_timings: timings(BUZZ[kind]),
            default_vibrate_timings: false,
            visibility: 'PUBLIC',
          }),
        },
      },
    },
  };
}

/**
 * Send to one device.
 *
 * Returns `'gone'` when the token is dead so the caller can delete it. A dead
 * token that is never cleaned up is retried on every message forever, and the
 * failures are invisible — the notification simply never arrives and nothing
 * says why.
 */
export async function sendToDevice(token, payload, device = {}) {
  const creds = credentials();
  const bearer = await accessToken();
  if (!creds || !bearer) return 'unconfigured';

  const body = buildMessage(token, payload, device);

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (res.ok) return 'sent';

  const text = await res.text();
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token both mean this
  // registration will never work again.
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text)) return 'gone';

  console.error(`  push      FCM send failed: ${res.status} ${text.slice(0, 200)}`);
  return 'failed';
}
