// Adds a lock-screen, full-screen order alert to the Capacitor Android project.
// Reusable for BOTH apps. Run AFTER `npx cap add android` / `cap sync`.
//   ALERT_TYPES   comma list of FCM data.type values that trigger it (default rider_assignment)
//   ANDROID_ROOT  android project dir (default "android"); CAP_CONFIG config path
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.ANDROID_ROOT || 'android';
const cfg = JSON.parse(fs.readFileSync(process.env.CAP_CONFIG || 'capacitor.config.json', 'utf8'));
const pkg = cfg.appId;
const types = process.env.ALERT_TYPES || 'rider_assignment';
const dir = path.join(root, 'app/src/main/java', ...pkg.split('.'));
fs.mkdirSync(dir, { recursive: true });

const service = `package __PKG__;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.Build;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.List;
import java.util.Map;

public class AlertMessagingService extends MessagingService {
  static final String CH = "eatswada_fullscreen_alerts";
  static final int ID = 7001;
  static final String TYPES = "__TYPES__";

  @Override public void onMessageReceived(RemoteMessage m) {
    Map<String, String> d = m.getData();
    String t = d.get("type");
    boolean hit = false;
    if (t != null) for (String x : TYPES.split(",")) if (x.trim().equals(t)) hit = true;
    // When the app is open, the in-app alarm already handles it.
    if (hit && !appInForeground()) show(d);
    super.onMessageReceived(m);
  }

  boolean appInForeground() {
    try {
      ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
      List<ActivityManager.RunningAppProcessInfo> l = am.getRunningAppProcesses();
      if (l != null) for (ActivityManager.RunningAppProcessInfo p : l)
        if (p.processName.equals(getPackageName())) return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    } catch (Exception e) { }
    return false;
  }

  void show(Map<String, String> d) {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    Uri snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
    if (Build.VERSION.SDK_INT >= 26) {
      AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIC).build();
      NotificationChannel c = new NotificationChannel(CH, "Full-screen order alerts", NotificationManager.IMPORTANCE_HIGH);
      c.setSound(snd, aa);
      c.enableVibration(true);
      c.setVibrationPattern(new long[]{0, 500, 300, 500});
      c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
      nm.createNotificationChannel(c);
    }
    String title = d.get("title") != null ? d.get("title") : "New order";
    String body = d.get("body") != null ? d.get("body") : "Tap to open";
    Intent i = new Intent(this, AlertActivity.class).putExtra("title", title).putExtra("body", body)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pi = PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
    b.setSmallIcon(getApplicationInfo().icon).setContentTitle(title).setContentText(body)
        .setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_MAX)
        .setFullScreenIntent(pi, true).setContentIntent(pi).setAutoCancel(true);
    if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(60000);
    else b.setSound(snd, AudioManager.STREAM_ALARM);
    Notification n = b.build();
    n.flags |= Notification.FLAG_INSISTENT;
    nm.notify(ID, n);
  }
}
`;

const activity = `package __PKG__;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.*;

public class AlertActivity extends Activity {
  MediaPlayer mp;
  Vibrator vb;
  CountDownTimer ct;

  @Override protected void onCreate(Bundle s) {
    super.onCreate(s);
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
    else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(AlertMessagingService.ID);

    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.VERTICAL);
    l.setGravity(Gravity.CENTER);
    l.setPadding(60, 60, 60, 60);
    l.setBackgroundColor(Color.parseColor("#1C2024"));
    TextView t = tv(getIntent().getStringExtra("title"), 30, Color.WHITE, true);
    TextView b = tv(getIntent().getStringExtra("body"), 18, Color.parseColor("#C9CED2"), false);
    final TextView c = tv("60", 64, Color.parseColor("#D71945"), true);
    Button ok = new Button(this); ok.setText("ACCEPT"); ok.setTextSize(22);
    Button no = new Button(this); no.setText("DISMISS");
    l.addView(t); l.addView(b); l.addView(c); l.addView(ok, -1, 200); l.addView(no, -1, -2);
    setContentView(l);

    try {
      Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      mp = new MediaPlayer();
      mp.setDataSource(this, u);
      mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIC).build());
      mp.setLooping(true); mp.prepare(); mp.start();
    } catch (Exception e) { }
    vb = (Vibrator) getSystemService(VIBRATOR_SERVICE);
    if (vb != null) vb.vibrate(new long[]{0, 600, 400}, 0);

    ct = new CountDownTimer(60000, 1000) {
      public void onTick(long ms) { c.setText(String.valueOf(ms / 1000)); }
      public void onFinish() { stopAll(); finish(); }
    }.start();

    ok.setOnClickListener(v -> accept());
    no.setOnClickListener(v -> { stopAll(); finish(); });
  }

  TextView tv(String text, int sp, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(text == null ? "" : text); t.setTextSize(sp); t.setTextColor(color);
    t.setGravity(Gravity.CENTER); t.setPadding(0, 20, 0, 20);
    if (bold) t.setTypeface(null, Typeface.BOLD);
    return t;
  }

  void accept() {
    stopAll();
    final Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (open != null) open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (Build.VERSION.SDK_INT >= 26) {
      ((KeyguardManager) getSystemService(KEYGUARD_SERVICE)).requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
        @Override public void onDismissSucceeded() { if (open != null) startActivity(open); finish(); }
        @Override public void onDismissCancelled() { finish(); }
        @Override public void onDismissError() { if (open != null) startActivity(open); finish(); }
      });
    } else { if (open != null) startActivity(open); finish(); }
  }

  void stopAll() {
    try { if (ct != null) ct.cancel(); } catch (Exception e) { }
    try { if (mp != null) { mp.stop(); mp.release(); mp = null; } } catch (Exception e) { }
    try { if (vb != null) vb.cancel(); } catch (Exception e) { }
  }

  @Override protected void onDestroy() { stopAll(); super.onDestroy(); }
}
`;

const sub = (s) => s.replaceAll('__PKG__', pkg).replaceAll('__TYPES__', types);
fs.writeFileSync(path.join(dir, 'AlertMessagingService.java'), sub(service));
fs.writeFileSync(path.join(dir, 'AlertActivity.java'), sub(activity));

// Manifest
const mf = path.join(root, 'app/src/main/AndroidManifest.xml');
let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('AlertActivity')) {
  const perms = ['USE_FULL_SCREEN_INTENT', 'WAKE_LOCK', 'VIBRATE', 'POST_NOTIFICATIONS']
    .filter((p) => !m.includes('android.permission.' + p))
    .map((p) => `    <uses-permission android:name="android.permission.${p}" />\n`).join('');
  m = m.replace('<application', perms + '    <application');
  m = m.replace('</application>',
`        <activity android:name="${pkg}.AlertActivity" android:exported="false" android:launchMode="singleTop"
            android:excludeFromRecents="true" android:taskAffinity="" android:showWhenLocked="true" android:turnScreenOn="true"
            android:theme="@android:style/Theme.Material.NoActionBar" />
        <service android:name="${pkg}.AlertMessagingService" android:exported="false">
            <intent-filter android:priority="100"><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
    </application>`);
  fs.writeFileSync(mf, m);
}

// Gradle: firebase-messaging must be on the app compile classpath
const gf = path.join(root, 'app/build.gradle');
let g = fs.readFileSync(gf, 'utf8');
if (!g.includes('firebase-messaging')) {
  g = g.replace(/\ndependencies\s*\{/, "\ndependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.1.0'");
  fs.writeFileSync(gf, g);
}
console.log(`Full-screen alert added for ${pkg} (types: ${types}).`);
