package in.niranjand.nook;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Where a call's sound comes out.
 *
 * WHY THE WEB CANNOT DO THIS
 *
 * The speaker button in the call overlay used to flip a boolean and nothing
 * else. It looked like a control and was a light switch wired to no bulb —
 * every call came out of the loudspeaker whatever it said, because an Android
 * WebView plays audio through the media stream, and the media stream means the
 * loudspeaker.
 *
 * There is no web API for this. `setSinkId` chooses between output *devices*
 * a browser knows about, and the earpiece is not one of them: it belongs to
 * the telephony routing that only AudioManager can reach.
 *
 * MODE_IN_COMMUNICATION is the part that actually matters. It tells Android
 * this is a call rather than a video, which switches the routing to the
 * earpiece, enables the hardware echo canceller, and makes the volume buttons
 * adjust call volume instead of media volume. Without it, turning the speaker
 * "off" would simply make a loudspeaker call quieter.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * Enter or leave call routing.
     *
     * Leaving matters as much as entering: an app that stays in
     * MODE_IN_COMMUNICATION after hanging up leaves the phone convinced a call
     * is in progress — music plays out of the earpiece and the volume buttons
     * keep adjusting a call that ended.
     */
    @PluginMethod
    public void setInCall(PluginCall call) {
        boolean inCall = call.getBoolean("inCall", false);
        try {
            AudioManager am = audio();
            if (inCall) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            } else {
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Throwable ignored) {
            // Routing is a comfort, not a requirement. A call that comes out
            // of the wrong speaker is worth having; a call that crashes the
            // app because the routing failed is not.
        }
        call.resolve();
    }

    /** Loudspeaker on, or back to the earpiece. */
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        try {
            AudioManager am = audio();
            // Setting the mode again is deliberate: some devices reset routing
            // when a Bluetooth headset connects or the screen turns off, and
            // re-asserting it here is cheaper than tracking every such event.
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(on);
        } catch (Throwable ignored) {
            /* see above */
        }
        call.resolve();
    }
}
