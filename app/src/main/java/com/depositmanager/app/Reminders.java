package com.depositmanager.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Phone notifications for payment and maturity reminders.
 * The page hands over the list of reminders (date + text). One alarm is kept for the next
 * reminder time; when it fires, every reminder that is due is posted and the next alarm is set.
 * After a reboot, time change or app update the alarm is set again (BootReceiver).
 */
final class Reminders {
    static final String CHANNEL = "reminders";
    static final String EXTRA_DEPOSIT = "depositId";
    static final String ACTION_FIRE = "com.depositmanager.app.REMINDER";
    private static final String PREFS = "reminders";
    private static final String KEY_DATA = "data";
    private static final String KEY_SHOWN = "shown";
    private static final int CATCH_UP_DAYS = 3; // missed reminders (phone off) are still shown this long

    private Reminders() {}

    static void save(Context c, String json) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_DATA, json == null ? "" : json).apply();
    }

    private static JSONObject data(Context c) {
        try {
            String s = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DATA, "");
            return s.isEmpty() ? new JSONObject() : new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static boolean enabledInSettings(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    static boolean canNotify(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return enabledInSettings(c);
    }

    private static String today() {
        Calendar cal = Calendar.getInstance();
        return String.format(Locale.US, "%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    private static String daysAgo(int n) {
        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_MONTH, -n);
        return String.format(Locale.US, "%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    /** Epoch millis for "yyyy-MM-dd" at the reminder time (HH:mm), local time. */
    private static long at(String date, String time) {
        Calendar cal = Calendar.getInstance();
        int hh = 9;
        int mm = 0;
        try {
            hh = Integer.parseInt(time.substring(0, 2));
            mm = Integer.parseInt(time.substring(3, 5));
        } catch (RuntimeException ignored) {
            // default 09:00
        }
        cal.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1, Integer.parseInt(date.substring(8, 10)), hh, mm, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Set (or clear) the one alarm for the next reminder time. */
    static void schedule(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent pi = alarmIntent(c);
        am.cancel(pi);
        JSONObject d = data(c);
        if (!d.optBoolean("enabled", false)) return;
        JSONArray items = d.optJSONArray("items");
        if (items == null || items.length() == 0) return;
        String time = d.optString("time", "09:00");
        Set<String> shown = shown(c);
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        String oldest = daysAgo(CATCH_UP_DAYS);
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String on = it.optString("on", "");
            if (on.length() != 10 || on.compareTo(oldest) < 0) continue;
            if (shown.contains(it.optString("key") + "@" + on)) continue;
            long t = at(on, time);
            if (t <= now) t = now + 5000; // due already (e.g. set after the reminder time)
            if (t < next) next = t;
        }
        if (next == Long.MAX_VALUE) return;
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        } catch (SecurityException e) {
            Log.w(MainActivity.TAG, "Alarm not allowed", e);
        }
    }

    /** Post every reminder that is due now, then set the next alarm. */
    static void fire(Context c) {
        JSONObject d = data(c);
        if (d.optBoolean("enabled", false)) {
            JSONArray items = d.optJSONArray("items");
            String time = d.optString("time", "09:00");
            String today = today();
            String oldest = daysAgo(CATCH_UP_DAYS);
            long now = System.currentTimeMillis();
            Set<String> shown = shown(c);
            Set<String> keep = new HashSet<>();
            int posted = 0;
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject it = items.optJSONObject(i);
                    if (it == null) continue;
                    String on = it.optString("on", "");
                    String id = it.optString("key") + "@" + on;
                    if (on.compareTo(oldest) >= 0) keep.add(id);
                    if (shown.contains(id) || on.length() != 10 || on.compareTo(oldest) < 0 || on.compareTo(today) > 0) continue;
                    if (on.equals(today) && now < at(on, time)) continue;
                    if (post(c, id, it.optString("title"), it.optString("text"), it.optString("depositId"))) posted++;
                    shown.add(id);
                }
            }
            shown.retainAll(keep);
            saveShown(c, shown);
            Log.i(MainActivity.TAG, "Reminders posted: " + posted);
        }
        schedule(c);
    }

    private static Set<String> shown(Context c) {
        return new HashSet<>(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_SHOWN, new HashSet<>()));
    }

    private static void saveShown(Context c, Set<String> s) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putStringSet(KEY_SHOWN, new HashSet<>(s)).apply();
    }

    private static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Payment reminders", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Reminders before deposit payments and maturity dates");
        nm.createNotificationChannel(ch);
    }

    static boolean post(Context c, String key, String title, String text, String depositId) {
        if (!canNotify(c)) return false;
        ensureChannel(c);
        Intent open = new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_DEPOSIT, depositId == null ? "" : depositId);
        int code = key.hashCode();
        PendingIntent pi = PendingIntent.getActivity(c, code, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : legacyBuilder(c);
        b.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setColor(Color.parseColor("#0F5C5A"))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setShowWhen(true);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        nm.notify(code, b.build());
        return true;
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder legacyBuilder(Context c) {
        return new Notification.Builder(c).setPriority(Notification.PRIORITY_DEFAULT).setDefaults(Notification.DEFAULT_ALL);
    }
}
