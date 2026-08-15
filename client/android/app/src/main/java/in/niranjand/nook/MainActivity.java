package in.niranjand.nook;

import com.getcapacitor.BridgeActivity;

/**
 * The whole Android app.
 *
 * Nook is one codebase — the web app served from nook.niranjand.in — and this
 * activity is the shell that hosts it, so there is deliberately nothing here.
 * Anything that needs to be native (push registration, the notification
 * channel and its sound, the back button, haptics) is reached through
 * Capacitor plugins from TypeScript, where it sits beside the feature it
 * belongs to instead of drifting apart in a second language.
 */
public class MainActivity extends BridgeActivity {}
