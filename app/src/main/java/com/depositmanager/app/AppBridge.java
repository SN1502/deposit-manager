package com.depositmanager.app;

import android.content.ClipData;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Methods the page calls as window.AndroidBridge.*. They run on a WebView background thread;
 * anything touching the UI hops to the main thread. Asynchronous results go back through
 * MainActivity.callback(id, json).
 */
final class AppBridge {
    private final MainActivity activity;

    AppBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getInfo() {
        return Json.of("version", BuildConfig.VERSION_NAME, "sdk", Build.VERSION.SDK_INT, "biometric", biometricAvailable()).toString();
    }

    /* ------------------------------------------------------------ app data */

    @JavascriptInterface
    public String loadFile(String key) {
        return Storage.load(activity, key);
    }

    @JavascriptInterface
    public String saveFile(String key, String content) {
        return Storage.save(activity, key, content == null ? "" : content);
    }

    @JavascriptInterface
    public void deleteFile(String key) {
        Storage.delete(activity, key);
    }

    /* ------------------------------------------------------------ Excel workbook */

    @JavascriptInterface
    public String getLinkedFile() {
        JSONObject info = Storage.linkedInfo(activity);
        return info == null ? "" : info.toString();
    }

    @JavascriptInterface
    public void openExcel(String cb) {
        activity.runOnUiThread(() -> activity.startOpen(cb));
    }

    @JavascriptInterface
    public String linkFile(String uri, String name) {
        return Storage.link(activity, uri, name).toString();
    }

    @JavascriptInterface
    public void createExcel(String cb, String name, String base64) {
        byte[] bytes = decode(base64);
        activity.runOnUiThread(() -> activity.startCreate(cb, safeName(name, "DepositManager.xlsx"), Storage.XLSX_MIME, bytes, true));
    }

    @JavascriptInterface
    public String writeLinked(String base64) {
        return Storage.writeLinked(activity, decode(base64)).toString();
    }

    @JavascriptInterface
    public String readLinked() {
        return Storage.readLinked(activity).toString();
    }

    @JavascriptInterface
    public void unlinkFile() {
        Storage.unlink(activity);
    }

    @JavascriptInterface
    public void saveCopy(String cb, String name, String mime, String base64) {
        byte[] bytes = decode(base64);
        activity.runOnUiThread(() -> activity.startCreate(cb, safeName(name, "DepositManager.xlsx"),
                mime == null || mime.isEmpty() ? Storage.XLSX_MIME : mime, bytes, false));
    }

    @JavascriptInterface
    public String shareFile(String name, String mime, String base64) {
        try {
            File dir = new File(activity.getCacheDir(), ShareProvider.DIR);
            if (!dir.exists() && !dir.mkdirs()) return Json.error("Cannot prepare the file").toString();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                f.delete();
            String fileName = safeName(name, "DepositManager.xlsx");
            File out = new File(dir, fileName);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(decode(base64));
            }
            Uri uri = ShareProvider.uriFor(activity, fileName);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime == null || mime.isEmpty() ? Storage.XLSX_MIME : mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, fileName);
            send.setClipData(ClipData.newRawUri(fileName, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, "Share " + fileName)));
            return Json.ok().toString();
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "share", e);
            return Json.error(e.getMessage()).toString();
        }
    }

    /* ------------------------------------------------------------ notifications */

    @JavascriptInterface
    public void setReminders(String json) {
        Reminders.save(activity, json);
        Reminders.schedule(activity);
    }

    @JavascriptInterface
    public String notificationStatus() {
        return Json.of("granted", Reminders.canNotify(activity)).toString();
    }

    @JavascriptInterface
    public void requestNotificationPermission(String cb) {
        activity.runOnUiThread(() -> activity.requestNotifyPermission(cb));
    }

    @JavascriptInterface
    public void showNotification(String title, String text, String tag) {
        Reminders.post(activity, "manual:" + (tag == null ? "" : tag), title, text, "");
    }

    /* ------------------------------------------------------------ device */

    @SuppressWarnings("deprecation")
    private boolean biometricAvailable() {
        if (Build.VERSION.SDK_INT < 29) return false;
        BiometricManager bm = activity.getSystemService(BiometricManager.class);
        if (bm == null) return false;
        if (Build.VERSION.SDK_INT >= 30) {
            return bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        return bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
    }

    @JavascriptInterface
    public void authenticate(String cb, String title) {
        if (Build.VERSION.SDK_INT < 29 || !biometricAvailable()) {
            activity.callback(cb, Json.error("Fingerprint is not available"));
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt.Builder(activity)
                        .setTitle(title == null || title.isEmpty() ? "Unlock Deposit Manager" : title)
                        .setSubtitle("Deposit Manager")
                        .setNegativeButton("Use PIN", activity.getMainExecutor(), (dialog, which) -> activity.callback(cb, Json.cancelled()))
                        .build();
                prompt.authenticate(new CancellationSignal(), activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        activity.callback(cb, Json.ok());
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        activity.callback(cb, Json.error(String.valueOf(errString)));
                    }
                });
            } catch (RuntimeException e) {
                activity.callback(cb, Json.error(e.getMessage()));
            }
        });
    }

    @JavascriptInterface
    public void setSecureScreen(boolean on) {
        activity.runOnUiThread(() -> activity.setSecure(on));
    }

    @JavascriptInterface
    public void setSystemBars(String bar, String nav, boolean darkNavIcons) {
        activity.runOnUiThread(() -> activity.setBarColors(bar, nav, darkNavIcons));
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(() -> activity.moveTaskToBack(true));
    }

    @JavascriptInterface
    public String consumeLaunchTarget() {
        String t = activity.launchTarget;
        activity.launchTarget = "";
        return t == null ? "" : t;
    }

    /* ------------------------------------------------------------ helpers */

    private static byte[] decode(String b64) {
        return b64 == null ? new byte[0] : Base64.decode(b64, Base64.DEFAULT);
    }

    private static String safeName(String name, String fallback) {
        if (name == null) return fallback;
        String n = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return n.isEmpty() ? fallback : n;
    }
}
