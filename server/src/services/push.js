/**
 * Web Push. Generates a VAPID keypair at boot if none is configured, so push
 * works out of the box in dev (subscriptions reset when keys change).
 */
import webpush from 'web-push';
import { sendToDevice } from './fcm.js';
import { env } from '../config/env.js';
import {
  pushSubscriptionsFor,
  deletePushSubscription,
  devicesFor,
  deleteDevice,
} from '../db/misc.js';

let keys = { publicKey: env.vapid.publicKey, privateKey: env.vapid.privateKey };

if (!keys.publicKey || !keys.privateKey) {
  keys = webpush.generateVAPIDKeys();
  console.log('  push      generated a temporary VAPID keypair — add to .env to persist:');
  console.log(`            VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`            VAPID_PRIVATE_KEY=${keys.privateKey}`);
}

webpush.setVapidDetails(env.vapid.subject, keys.publicKey, keys.privateKey);

export const publicVapidKey = () => keys.publicKey;

/**
 * "configured" or "ephemeral". Worth surfacing on /api/health: an ephemeral
 * keypair looks perfectly healthy until the service restarts, at which point
 * every existing subscription is silently invalid — browsers bind a
 * subscription to the public key it was created with.
 */
export const pushProvider = () =>
  env.vapid.publicKey && env.vapid.privateKey ? 'configured' : 'ephemeral';

/**
 * Send to every device this person has, on whichever transport it uses.
 *
 * Two transports rather than one, because neither reaches the other's devices:
 * Web Push does not exist inside an Android WebView, so the app cannot use the
 * browser's VAPID subscription, and FCM cannot reach a desktop browser. Anyone
 * with both the site and the app installed is registered on both and gets one
 * notification per device, which is what they would expect.
 */
export async function notify(userId, payload) {
  const [subs, devices] = await Promise.all([pushSubscriptionsFor(userId), devicesFor(userId)]);
  if (!subs.length && !devices.length) return 0;

  let sent = 0;

  // Native first: it is the one that reaches a locked phone.
  await Promise.all(
    devices.map(async (device) => {
      const result = await sendToDevice(device.token, payload).catch(() => 'failed');
      if (result === 'sent') sent += 1;
      // A dead registration retried on every message forever is invisible
      // breakage — the notification simply never arrives and nothing says why.
      else if (result === 'gone') await deleteDevice(device.token);
    })
  );

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (err) {
        // 404/410 = the subscription is dead, so stop trying it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await deletePushSubscription(sub.endpoint);
        }
      }
    })
  );
  return sent;
}
