package in.niranjand.nook;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The whole Android app.
 *
 * Nook is one codebase — the web app served from nook.niranjand.in — and this
 * activity is the shell that hosts it, so there is deliberately almost nothing
 * here. Anything that needs to be native (push registration, the notification
 * channel and its sound, the back button, haptics) is reached through
 * Capacitor plugins from TypeScript, where it sits beside the feature it
 * belongs to instead of drifting apart in a second language.
 *
 * The one exception is PushReady, and it is here because it has to be: it
 * answers a question the TypeScript cannot ask any other way, namely whether
 * registering for push will kill the app. See PushReadyPlugin.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the bridge is built there, and a plugin
        // registered afterwards is not in it.
        registerPlugin(PushReadyPlugin.class);
        registerPlugin(CallAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
