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

/**
 * True only inside the Capacitor shell, not in a mobile browser.
 *
 * The user agent is checked as well as the bridge, and that second test is not
 * belt-and-braces — it is the one that matters when things go wrong.
 *
 * Because the app loads the live site rather than files inside the APK,
 * Capacitor has to inject its bridge into a page it fetched over the network.
 * That injection can fail for reasons that have nothing to do with this code:
 * a slow first load, a proxy that re-encodes the HTML, a WebView that serves
 * the page from its own cache. When it does fail, `window.Capacitor` is simply
 * absent, and a check that only looked there would conclude it was running in
 * Chrome — and then hand the person a sign-in flow that cannot come back.
 *
 * `appendUserAgent` in capacitor.config.ts stamps `NookApp/1` onto the web
 * view's user agent natively, before any JavaScript runs. It cannot be missing
 * while the bridge is present, and it is present when the bridge is not.
 */
export function isNativeApp(): boolean {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return / NookApp\//.test(navigator.userAgent);
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

  /**
   * Refuse to register when the app has no Firebase configuration.
   *
   * This is not caution, it is the fix for a crash. Without
   * google-services.json, PushNotifications.register() throws
   * "Default FirebaseApp is not initialized" — and it throws on Capacitor's
   * own CapacitorPlugins thread, so the try/catch below never sees it. An
   * uncaught exception on any thread ends the process, which is why a
   * signed-in person opening the app got "Nook keeps stopping": the session
   * restored, this function ran, and the app died before drawing anything.
   *
   * The check has to be native because nothing in JavaScript can see whether
   * the resource exists. PushReady is thirty lines in MainActivity's package
   * that look up one string.
   */
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const PushReady = registerPlugin<{ isConfigured(): Promise<{ configured: boolean }> }>(
      'PushReady'
    );
    const { configured } = await PushReady.isConfigured();
    if (!configured) {
      console.warn('  push  no Firebase configuration in this build; staying off');
      return 'unavailable';
    }
  } catch {
    // An older build without the PushReady plugin. Registering anyway is the
    // behaviour that crashed, so the safe answer is to do nothing.
    return 'unavailable';
  }

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

  const url = `${apiBase}/api/auth/google/start?native=1${admin ? '&admin=1' : ''}`;

  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
    return true;
  } catch {
    /**
     * No Custom Tab — but this still has to finish inside the app, and this is
     * exactly where it used to stop finishing.
     *
     * Capacitor sends any navigation to a host other than the one the app was
     * loaded from straight to the system browser (Bridge.launchIntent). The
     * API is on a different subdomain, so `location.href` here does not
     * navigate the web view at all: it opens Chrome. That is fine — Google
     * needs a real browser anyway — but only if the URL says `native=1`, so
     * the server finishes at `nook://auth` and Android hands the result back.
     *
     * The old fallback returned false and let the caller navigate to the
     * plain start URL instead. Without `native=1` the server finished at
     * https://nook.niranjand.in, so the sign-in completed in Chrome, the
     * session belonged to the browser, and the app was left sitting on the
     * front door with no way to explain itself. That is the whole of "it logs
     * in on the web and then kicks me out of the app".
     */
    window.location.href = url;
    return true;
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

    const handle = async (url?: string | null) => {
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
    };

    await App.addListener('appUrlOpen', ({ url }) => handle(url));

    /**
     * The same link, but for a launch rather than a resume.
     *
     * `appUrlOpen` only fires at an app that is already running. Android is
     * free to kill Nook while the person is off in the browser signing in —
     * it is a backgrounded app and the browser wants the memory — and then
     * the deep link *starts* the app instead of resuming it. In that case the
     * event fired long before this listener existed, and waiting for it means
     * waiting forever: the person signs in successfully, lands back in Nook,
     * and finds the front door.
     *
     * `getLaunchUrl` is the intent the app was started with, so it catches
     * exactly the case the listener cannot. Both routes run the same handler.
     */
    const launch = await App.getLaunchUrl();
    await handle(launch?.url);
  } catch {
    /* not native */
  }
}
