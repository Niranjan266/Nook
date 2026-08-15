package in.niranjand.nook;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Answers one question: has this build been given a Firebase configuration?
 *
 * WHY THIS HAD TO EXIST
 *
 * Calling PushNotifications.register() without google-services.json does not
 * fail — it kills the app:
 *
 *   java.lang.IllegalStateException: Default FirebaseApp is not initialized
 *       at com.google.firebase.messaging.FirebaseMessaging.getInstance
 *       at PushNotificationsPlugin.register(PushNotificationsPlugin.java:103)
 *
 * and it does so on Capacitor's own "CapacitorPlugins" HandlerThread. An
 * exception there is not returned to the caller, so the try/catch wrapped
 * around the register() call in TypeScript never sees it. An uncaught
 * exception on any thread takes the whole process with it, which is why the
 * app died with "Nook keeps stopping" the moment a signed-in person opened it:
 * the session restored, push registration began, and that was that.
 *
 * The fix has to be "do not call it", and the only way to know that is here,
 * on the native side, before the call is made.
 *
 * HOW THE CHECK WORKS
 *
 * The google-services Gradle plugin turns google-services.json into string
 * resources, one of which is google_app_id. No file, no plugin applied, no
 * resource. Looking the resource up by name costs nothing, touches no
 * Firebase class, and cannot itself throw — deliberately, because a check
 * that can fail the same way as the thing it is checking is no check at all.
 */
@CapacitorPlugin(name = "PushReady")
public class PushReadyPlugin extends Plugin {

    @PluginMethod
    public void isConfigured(PluginCall call) {
        boolean configured = false;
        try {
            int id = getContext()
                    .getResources()
                    .getIdentifier("google_app_id", "string", getContext().getPackageName());
            // Present but blank would be worse than absent: Firebase would
            // accept it and fail later, somewhere less obvious.
            configured = id != 0 && !getContext().getString(id).trim().isEmpty();
        } catch (Throwable ignored) {
            // Stay false. The only consequence of a false negative is that
            // push stays off, which is exactly the state we are trying to
            // survive rather than crash in.
        }

        JSObject result = new JSObject();
        result.put("configured", configured);
        call.resolve(result);
    }
}
