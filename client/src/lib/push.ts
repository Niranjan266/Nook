import { get, post } from './api';
import { isNativeApp, registerNativePush, unregisterNativePush } from './native';

export type PushStatus = 'on' | 'off' | 'denied' | 'unsupported';

/**
 * WHY EVERY FUNCTION HERE FORKS ON isNativeApp()
 *
 * There are two completely different push systems behind this one interface.
 * On the web it is Web Push: a service worker, a PushManager subscription and
 * a VAPID key. In the Android app it is FCM: a native token handed up by the
 * Capacitor plugin.
 *
 * `PushManager` does not exist in an Android WebView. So `supported()` was
 * false inside the app, and the toggle in Settings — which called straight
 * into the web path — returned 'unsupported' and said "Notifications are not
 * available here." Which was true of the code it ran, and false of the app it
 * ran in: the whole reason the Android app exists is notifications on a locked
 * phone.
 *
 * The native branch lives here rather than at each call site because there are
 * three call sites — the Settings toggle, the nudge, and the resume at
 * sign-in — and a fork repeated three times is a fork that will only ever be
 * fixed twice.
 */
const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function pushState(): PushStatus {
  // In the app there is no Notification.permission to read: Android's own
  // permission is asked for by the plugin, and what we know is whether
  // registration has succeeded before.
  if (isNativeApp()) return localStorage.getItem('nook.push') === 'on' ? 'on' : 'off';

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
  if (isNativeApp()) {
    const result = await registerNativePush();
    if (result === 'on') localStorage.setItem('nook.push', 'on');
    // 'unavailable' means this build has no Firebase configuration, which is
    // the same shape of answer as a browser that cannot do push at all.
    return result === 'unavailable' ? 'unsupported' : result;
  }

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

  if (isNativeApp()) {
    // Drops the FCM token and tells the server, so the next person to use this
    // phone does not receive messages meant for whoever is signing out.
    await unregisterNativePush();
    return;
  }

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
  if (isNativeApp()) {
    /**
     * Only re-register for someone who already had it on.
     *
     * Registering unasked would fire Android's permission dialog at sign-in,
     * over the first screen of the app, before anyone has done anything worth
     * being notified about. Someone who has turned it on once should not have
     * to find the toggle again on every device, and someone who has not should
     * not be interrupted.
     */
    if (localStorage.getItem('nook.push') !== 'on') return pushState();
    const result = await registerNativePush();
    if (result !== 'on') localStorage.setItem('nook.push', 'off');
    return result === 'unavailable' ? 'unsupported' : result;
  }

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
