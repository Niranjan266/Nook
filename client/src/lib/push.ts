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
