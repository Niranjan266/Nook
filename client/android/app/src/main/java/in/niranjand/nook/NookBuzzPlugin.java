package in.niranjand.nook;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Nook's vibration signature, played at full strength.
 *
 * WHY NOT THE HAPTICS PLUGIN
 *
 * @capacitor/haptics can only do one pulse of one length, and both it and the
 * web's navigator.vibrate run the motor at DEFAULT_AMPLITUDE — a polite
 * middle setting that is easy to miss in a pocket. A waveform with explicit
 * amplitudes can ask for 255, the hardest the motor goes, and play the whole
 * knock-knock-thud as one effect rather than a string of timers that drift.
 *
 * Timings are Android's format: a delay, then alternating on and off.
 */
@CapacitorPlugin(name = "NookBuzz")
public class NookBuzzPlugin extends Plugin {

    @SuppressWarnings("deprecation")
    private Vibrator vibrator() {
        Context c = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void pattern(PluginCall call) {
        try {
            JSArray raw = call.getArray("timings");
            int n = raw == null ? 0 : Math.min(raw.length(), 64);
            long[] timings = new long[n];
            for (int i = 0; i < n; i++) timings[i] = Math.max(0, Math.min(raw.getLong(i), 5000));

            Vibrator v = vibrator();
            if (n > 0 && v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (v.hasAmplitudeControl()) {
                        // Even slots are pauses, odd slots are pulses at full power.
                        int[] amps = new int[n];
                        for (int i = 0; i < n; i++) amps[i] = i % 2 == 0 ? 0 : 255;
                        v.vibrate(VibrationEffect.createWaveform(timings, amps, -1));
                    } else {
                        v.vibrate(VibrationEffect.createWaveform(timings, -1));
                    }
                } else {
                    v.vibrate(timings, -1);
                }
            }
        } catch (Throwable ignored) {
            // A buzz that does not happen is fine; a rejected call would make
            // the TypeScript conclude this build has no plugin and stop asking.
        }
        call.resolve();
    }
}
