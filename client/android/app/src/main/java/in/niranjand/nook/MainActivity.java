package in.niranjand.nook;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The whole Android app.
 *
 * Nook is one codebase — the web app served from nook.niranjand.in — and this
 * activity is the shell that hosts it, so there is deliberately almost nothing
 * here. Anything that needs to be native (push registration, the back button,
 * haptics) is reached through Capacitor plugins from TypeScript, where it sits
 * beside the feature it belongs to instead of drifting apart in a second
 * language.
 *
 * The exceptions are here because they have to be: PushReady answers whether
 * registering for push will kill the app, NookBuzz drives the motor harder
 * than any web API can, and the notification channels need a vibration
 * pattern that Capacitor's createChannel has no field for.
 */
public class MainActivity extends BridgeActivity {

    /**
     * Nook's vibration signature in Android's format (delay, on, off, on…).
     * Mirrors BUZZ in client/src/lib/native.ts and the timings in server
     * fcm.js; change all three together.
     */
    static final long[] MESSAGE_BUZZ = { 0, 80, 70, 80, 70, 220 };
    static final long[] CALL_BUZZ = { 0, 180, 110, 420, 650, 180, 110, 420, 650, 180, 110, 420 };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the bridge is built there, and a plugin
        // registered afterwards is not in it.
        registerPlugin(PushReadyPlugin.class);
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(NookBuzzPlugin.class);
        // Also before the bridge, so the page's first listChannels already
        // sees them and does not remake the old ones.
        ensureChannels();
        super.onCreate(savedInstanceState);
    }

    /**
     * The lock-screen channels, v2: louder sounds and the Nook buzz.
     *
     * Android freezes a channel's sound and vibration the moment it exists, so
     * nothing can make 'messages' louder in place — the only way is new ids.
     * The server only names these for a device that registered with
     * channels: 2, which this build's TypeScript sends once it sees them.
     */
    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            nm.createNotificationChannel(channel(
                    "messages_v2", "Messages", "New messages from people you talk to",
                    NotificationManager.IMPORTANCE_HIGH, R.raw.nook_message_v2,
                    AudioAttributes.USAGE_NOTIFICATION, MESSAGE_BUZZ));
            nm.createNotificationChannel(channel(
                    "calls_v2", "Calls", "Someone is calling you",
                    NotificationManager.IMPORTANCE_HIGH, R.raw.nook_call_v2,
                    AudioAttributes.USAGE_NOTIFICATION_RINGTONE, CALL_BUZZ));

            // Otherwise system settings lists "Messages" twice and people
            // mute the wrong one. A push still aimed at an old id (the server
            // has not heard channels: 2 yet) falls back to FCM's default
            // channel, which strings.xml points at messages_v2.
            nm.deleteNotificationChannel("messages");
            nm.deleteNotificationChannel("calls");
        } catch (Throwable ignored) {
            // Channels are a nicety over FCM's default one. Never worth a
            // crash on launch.
        }
    }

    private NotificationChannel channel(String id, String name, String description, int importance,
                                        int sound, int usage, long[] buzz) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(description);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        ch.enableVibration(true);
        ch.setVibrationPattern(buzz);
        ch.enableLights(true);
        ch.setLightColor(Color.parseColor("#C0603C"));
        ch.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/" + sound),
                new AudioAttributes.Builder()
                        .setUsage(usage)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        return ch;
    }
}
