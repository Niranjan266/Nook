import { get, post } from './api';

export type PushStatus = 'on' | 'off' | 'denied' | 'unsupported';

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function pushState(): PushStatus {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return localStorage.getItem('nook.push') === 'on' ? 'on' : 'off';
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!registration) return 'unsupported';

  try {
    const { publicKey } = await get<{ publicKey: string }>('/push/key');
    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await post('/push/subscribe', sub.toJSON());
    localStorage.setItem('nook.push', 'on');
    return 'on';
  } catch {
    return 'off';
  }
}

export async function disablePush() {
  localStorage.setItem('nook.push', 'off');
  const registration = await navigator.serviceWorker?.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  if (sub) {
    await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/**
 * Bring an existing permission back to life, quietly.
 *
 * Notifications only ever worked if someone found the toggle in Settings, and
 * nothing pointed them at it — so for most people push was simply never turned
 * on, which looks exactly like it being broken. This runs at sign-in: if the
 * browser has already granted permission, resubscribe without asking again.
 *
 * It also repairs the case that used to leave people silently unsubscribed:
 * push subscriptions are bound to the VAPID key they were created with, so
 * rotating the server key invalidates every one of them, and the browser will
 * keep handing back the dead subscription until it is explicitly replaced.
 */
export async function resumePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  if (Notification.permission !== 'granted') return pushState();

  const registration =
    (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!registration) return 'unsupported';

  try {
    const { publicKey } = await get<{ publicKey: string }>('/push/key');
    const wanted = urlBase64ToUint8Array(publicKey);
    const existing = await registration.pushManager.getSubscription();

    // A subscription made with a different key is dead on arrival; the server
    // will never be able to send to it, and nothing surfaces the failure.
    if (existing) {
      const same =
        existing.options?.applicationServerKey &&
        new Uint8Array(existing.options.applicationServerKey).every((b, i) => b === wanted[i]);
      if (!same) await existing.unsubscribe().catch(() => {});
    }

    const sub =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: wanted,
      }));

    await post('/push/subscribe', sub.toJSON());
    localStorage.setItem('nook.push', 'on');
    return 'on';
  } catch {
    return pushState();
  }
}

/** Have we already asked, and been ignored rather than refused? */
export const neverAsked = () => supported() && Notification.permission === 'default';
