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

/**
 * Match the status bar to the app rather than leaving it black.
 *
 * The WebView has no say over the status bar, so the `theme-color` meta tag
 * the browser honours does nothing here — an app that is otherwise warm bisque
 * sits under a black strip until this runs.
 */
export async function styleStatusBar(dark: boolean) {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color: dark ? '#201D1A' : '#E9E1D6' });
    // Dark *content* on a light bar, and the reverse — the naming is the
    // opposite of what it reads like, which is worth stating once here.
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    /* not native, or no status bar to style */
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

/* ── signing in with Google, from inside the app ──────────────────────────── */

/**
 * Google sign-in cannot happen in the app's own web view.
 *
 * Google refuses OAuth from embedded web views, and Capacitor sends any
 * off-origin navigation to the system browser regardless — so the flow always
 * runs outside the app. That was fine; what was broken is that it also
 * *finished* outside the app. The server redirected to https://nook…, so the
 * browser ended up holding the session and the app was left exactly as it had
 * been: signed out, with no error to explain it.
 *
 * The fix is a round trip that comes home. `?native=1` tells the server to
 * finish at `nook://auth?g=<code>` instead of a web address, Android hands
 * that link to this app, and `bindDeepLinks` below turns it into a session.
 *
 * A Custom Tab rather than the plain browser: it opens over the app, shares
 * the system's cookies so an already-signed-in Google account is one tap, and
 * can be closed programmatically the moment the code comes back.
 */
export async function startGoogleSignIn(apiBase: string, admin = false): Promise<boolean> {
  if (!isNativeApp()) return false;

  try {
    const { Browser } = await import('@capacitor/browser');
    const url = `${apiBase}/api/auth/google/start?native=1${admin ? '&admin=1' : ''}`;
    await Browser.open({ url, presentationStyle: 'popover' });
    return true;
  } catch {
    // No Custom Tab available. Falling back to a normal navigation still
    // works, because the deep link is what actually carries the result — the
    // browser choice only affects how it looks.
    return false;
  }
}

/**
 * Everything Android hands to the app as a link.
 *
 * Right now that is the end of a Google sign-in, but the shape is general: a
 * scheme, a path, and a query. Anything added later (an invite link, a shared
 * conversation) arrives through the same door.
 */
export async function bindDeepLinks(onCode: (code: string) => void, onError: (why: string) => void) {
  if (!isNativeApp()) return;

  try {
    const { App } = await import('@capacitor/app');

    await App.addListener('appUrlOpen', async ({ url }) => {
      if (!url?.startsWith('nook://')) return;

      // `new URL` on a custom scheme is unreliable across engines; the query
      // is the only part that matters and splitting on '?' cannot misparse.
      const query = new URLSearchParams(url.split('?')[1] || '');
      const code = query.get('g');
      const failed = query.get('google_error');

      // Close the Custom Tab first, so the app is what the person is looking
      // at when the result lands rather than a browser that lingers on top.
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
      } catch {
        /* nothing open, or already gone */
      }

      if (code) onCode(code);
      else if (failed) onError(failed);
    });
  } catch {
    /* not native */
  }
}
