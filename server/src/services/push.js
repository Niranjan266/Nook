/**
 * Web Push. Generates a VAPID keypair at boot if none is configured, so push
 * works out of the box in dev (subscriptions reset when keys change).
 */
import webpush from 'web-push';
import { env } from '../config/env.js';
import { pushSubscriptionsFor, deletePushSubscription } from '../db/misc.js';

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

export async function notify(userId, payload) {
  const subs = await pushSubscriptionsFor(userId);
  if (!subs.length) return 0;

  let sent = 0;
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
