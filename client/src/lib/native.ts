import { post, del } from './api';

/**
 * The parts of Nook that only exist inside the Android app.
 *
 * Everything here is guarded so the same bundle runs unchanged in a browser —
 * the site and the app are one build, served from one origin, and a second
 * codebase for the phone is exactly the divergence this approach exists to
 * avoid. In a browser every function below returns quietly and the web push
 * path takes over.
 *
 * The imports are dynamic for the same reason: Capacitor's plugins pull in
 * native bridge code that has no business being in the bundle a browser
 * downloads.
 */

/** True only inside the Capacitor shell, not in a mobile browser. */
export function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Android needs a notification channel before it will show anything, and the
 * channel — not the message — owns the sound and the vibration pattern. This
 * is the piece the web cannot do: a browser notification always uses the
 * system sound, which is why the sound picker in Settings only applies while
 * the app is open. Here it is a real per-app sound on a locked phone.
 *
 * Channel settings are frozen at creation: Android deliberately ignores later
 * changes so an app cannot make itself louder after you have turned it down.
 * Changing the sound therefore means a new channel id, which is why this one
 * is versioned.
 */
async function ensureChannels() {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  await PushNotifications.createChannel({
    id: 'messages',
    name: 'Messages',
    description: 'New messages from people you talk to',
    importance: 4, // heads-up, the WhatsApp default
    visibility: 1, // show content on the lock screen; a locked chat sends no push at all
    sound: 'nook_message',
    vibration: true,
    lights: true,
    lightColor: '#C0603C',
  });

  await PushNotifications.createChannel({
    id: 'calls',
    name: 'Calls',
    description: 'Someone is calling you',
    importance: 5,
    visibility: 1,
    sound: 'nook_call',
    vibration: true,
    lights: true,
    lightColor: '#C0603C',
  });
}

let registered = false;

/**
 * Ask for permission, register with FCM, and hand the token to the server.
 *
 * Called at sign-in rather than at launch: a token is useless without an
 * account to attach it to, and registering before anyone has signed in would
 * store a device against nobody.
 */
export async function registerNativePush(): Promise<'on' | 'denied' | 'unavailable'> {
  if (!isNativeApp() || registered) return isNativeApp() ? 'on' : 'unavailable';

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return 'denied';

    await ensureChannels();

    // The token arrives asynchronously through an event, not a return value.
    await PushNotifications.addListener('registration', (token) => {
      post('/push/device', { token: token.value, platform: 'android' }).catch(() => {
        /* retried on the next launch; a failure here is not worth a dialog */
      });
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('  push  FCM registration failed:', err.error);
    });

    /**
     * Tapping a notification should open the conversation it came from, not
     * just the app. The payload carries the id; the rest of the app already
     * knows how to act on `open-conversation`.
     */
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const conversationId = action.notification?.data?.conversationId;
      if (conversationId) {
        window.dispatchEvent(new CustomEvent('nook:open-conversation', { detail: { conversationId } }));
      }
    });

    await PushNotifications.register();
    registered = true;
    return 'on';
  } catch (err) {
    console.warn('  push  native registration unavailable:', err);
    return 'unavailable';
  }
}

/** Sign-out: the next person to use this phone should not get your messages. */
export async function unregisterNativePush() {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
    registered = false;
  } catch {
    /* nothing to unregister */
  }
}

/**
 * The system back button.
 *
 * Without this it closes the app from anywhere, including from inside a chat —
 * the single most jarring difference between a wrapped web app and a real one.
 * Back should mean "up one level" and only exit from the top.
 */
export async function bindBackButton(goBack: () => boolean) {
  if (!isNativeApp()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      // `goBack` returns false when there is nothing left to close, which is
      // the only moment leaving the app is the right answer.
      if (!goBack() && !canGoBack) App.exitApp();
    });
  } catch {
    /* not native */
  }
}

/** A real haptic tap, rather than the blunt vibration the web API gives. */
export async function tap() {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* not native */
  }
}
