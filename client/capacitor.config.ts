import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android wrapper around the app you already have.
 *
 * WHY THE APP LOADS FROM THE SERVER RATHER THAN FROM FILES IN THE APK
 *
 * Capacitor's default is to bundle `dist/` inside the APK and serve it from
 * `capacitor://localhost`. That is the right default for most apps and the
 * wrong one here, for a reason worth writing down: it makes the app a
 * different *origin* from the API.
 *
 * Everything about how Nook keeps you signed in depends on that origin. The
 * refresh cookie is scoped to `.niranjand.in`; a page served from
 * `capacitor://localhost` cannot send it, so every launch would start signed
 * out. Google sign-in redirects back to a URL on that domain. CORS is an
 * allowlist of real origins. Each of those has a workaround, and together they
 * are three new ways to be broken that the browser version simply does not
 * have.
 *
 * Loading `https://nook.niranjand.in` instead means the app is the same origin
 * as the site: cookies, sign-in and CORS behave identically to Chrome, and
 * every deploy reaches phones immediately without anyone reinstalling an APK.
 *
 * The cost is honest and small — the app needs a connection to start, which a
 * chat app needs anyway — and the service worker still caches the shell, so a
 * launch on a bad connection is fast rather than blank.
 */
const config: CapacitorConfig = {
  appId: 'in.niranjand.nook',
  appName: 'Nook',
  webDir: 'dist',

  server: {
    url: 'https://nook.niranjand.in',
    // Only https, so a stray http asset cannot downgrade the connection.
    androidScheme: 'https',
    cleartext: false,
    /**
     * Shown when the site cannot be reached. Bundled in the APK, so it is the
     * one page that loads with no connection at all.
     *
     * Without it the WebView shows its own error page — a white screen reading
     * "net::ERR_NAME_NOT_RESOLVED", which tells somebody holding a phone
     * nothing and is indistinguishable from the app being broken. This is also
     * the difference between a bug report of "not working" and one naming the
     * cause.
     */
    errorPath: 'offline.html',
  },

  android: {
    // The web app already draws its own background; a white flash between the
    // splash screen and the first paint is more noticeable than the wait.
    backgroundColor: '#E9E1D6',
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    PushNotifications: {
      // Show the notification even while the app is in the foreground; the
      // in-app banner is suppressed for the chat you are actually reading, so
      // this does not double up.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
