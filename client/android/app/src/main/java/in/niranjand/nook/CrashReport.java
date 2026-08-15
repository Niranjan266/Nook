package in.niranjand.nook;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Turns "Nook keeps stopping" into a screen that says why.
 *
 * Android's crash dialog names the app and nothing else. That is fine when the
 * developer is holding the phone with a cable attached, and useless in every
 * other case — which is most cases, and was ours: a release build died on
 * launch and there was no way to see the exception without USB debugging.
 *
 * WHY attachBaseContext AND NOT MainActivity
 *
 * The obvious place for this is the activity, and the obvious place is wrong.
 * ContentProviders run before any activity exists — FirebaseInitProvider,
 * androidx's startup provider, and anything a library quietly registers in its
 * manifest — and a crash in one of those happens before onCreate is ever
 * called. A handler installed in the activity would miss precisely the class
 * of failure that is hardest to diagnose without it.
 *
 * Application.attachBaseContext runs before the providers, so this catches
 * essentially everything that can kill the process at startup.
 *
 * The trace is shown, not uploaded. Nook has no crash-reporting service and
 * adding one to answer a single question would be a strange trade.
 */
public class CrashReport extends Application {

    /**
     * The version, read from the installed package rather than BuildConfig.
     *
     * AGP 8 stopped generating BuildConfig unless the project asks for it, and
     * turning that on for two strings would change the build for every module.
     * The package manager already knows, and knowing it from the *installed*
     * package is marginally better anyway: it reports what is actually on the
     * phone rather than what the source thought it was.
     */
    static String versionOf(Context context) {
        try {
            android.content.pm.PackageInfo info = context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0);
            return info.versionName + " (build " + info.versionCode + ")";
        } catch (Throwable ignored) {
            return "unknown version";
        }
    }

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);

        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();

        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter out = new StringWriter();
                PrintWriter writer = new PrintWriter(out);

                writer.println("Nook " + versionOf(this));
                writer.println("Android " + Build.VERSION.RELEASE
                        + "  API " + Build.VERSION.SDK_INT);
                writer.println(Build.MANUFACTURER + " " + Build.MODEL);
                writer.println("thread: " + thread.getName());
                writer.println();

                // printStackTrace on a PrintWriter includes the whole "Caused
                // by" chain, which is normally where the real answer is - the
                // top frame is usually just the framework noticing.
                error.printStackTrace(writer);
                writer.flush();

                Intent show = new Intent(CrashReport.this, CrashActivity.class);
                show.putExtra(CrashActivity.EXTRA_TRACE, out.toString());
                // A fresh task: the one that crashed is being torn down, and
                // launching into it would take this screen down with it.
                show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(show);
            } catch (Throwable ignored) {
                // A crash handler that crashes tells you nothing at all. If
                // anything above fails, fall through and let Android do what
                // it would have done anyway.
            }

            if (previous != null) previous.uncaughtException(thread, error);
            else System.exit(2);
        });
    }
}
