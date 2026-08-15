package in.niranjand.nook;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Shows a crash instead of swallowing it.
 *
 * Built in code rather than XML on purpose: this screen has to work when the
 * app has just failed to start, and a layout resource is one more thing that
 * can fail to inflate. Nothing here touches the app's theme, its resources or
 * any library — if it needed those to work it could not be trusted to report
 * a problem with those.
 *
 * The Copy button matters more than it looks. A stack trace is long and the
 * useful part is usually a "Caused by" halfway down, which is exactly the part
 * a photograph of a phone screen cuts off.
 */
public class CrashActivity extends Activity {

    public static final String EXTRA_TRACE = "trace";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        final String trace = getIntent().getStringExtra(EXTRA_TRACE) == null
                ? "(no details were captured)"
                : getIntent().getStringExtra(EXTRA_TRACE);

        int pad = (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, 16, getResources().getDisplayMetrics());

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#E9E1D6")); // bisque, so it still looks like Nook
        root.setPadding(pad, pad * 3, pad, pad);

        TextView title = new TextView(this);
        title.setText("Nook stopped");
        title.setTextColor(Color.parseColor("#1E1A17"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Tap Copy, then paste this to whoever is fixing it.");
        hint.setTextColor(Color.parseColor("#5C5349"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setPadding(0, pad / 2, 0, pad);
        root.addView(hint);

        Button copy = new Button(this);
        copy.setText("Copy the details");
        copy.setAllCaps(false);
        copy.setOnClickListener(v -> {
            ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cb != null) {
                cb.setPrimaryClip(ClipData.newPlainText("Nook crash", trace));
                Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
            }
        });
        root.addView(copy);

        TextView body = new TextView(this);
        body.setText(trace);
        body.setTextColor(Color.parseColor("#1E1A17"));
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        body.setPadding(0, pad, 0, pad);

        ScrollView scroller = new ScrollView(this);
        scroller.addView(body, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroller.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(scroller);

        TextView footer = new TextView(this);
        footer.setText("Nook · " + CrashReport.versionOf(this));
        footer.setTextColor(Color.parseColor("#5C5349"));
        footer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        footer.setGravity(Gravity.CENTER);
        root.addView(footer);

        setContentView(root);
    }
}
