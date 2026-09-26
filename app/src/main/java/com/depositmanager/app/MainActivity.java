package com.depositmanager.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Hosts the Deposit Manager web app (assets/index.html) in a WebView and connects it to the
 * phone: files via the system file picker, notifications, fingerprint unlock and sharing.
 * The app has no INTERNET permission — the page is loaded from the APK and every other
 * request is refused.
 */
public class MainActivity extends Activity {
    static final String TAG = "DepositManager";
    static final String BASE_URL = "https://app.depositmanager.local/";

    static final int REQ_OPEN = 101;
    static final int REQ_CREATE = 102;
    static final int REQ_COPY = 103;
    static final int REQ_NOTIFY = 104;

    WebView web;
    private View statusSpacer;
    private View navSpacer;
    private boolean pageLoaded = false;
    private Object backCallback; // OnBackInvokedCallback on Android 13+

    // pending picker / permission requests (callback id for the page, plus bytes to write)
    String pendingOpenCb;
    String pendingCreateCb;
    byte[] pendingCreateBytes;
    String pendingCopyCb;
    byte[] pendingCopyBytes;
    String pendingNotifyCb;

    /** Deposit to open after a notification tap; the page asks for it via consumeLaunchTarget(). */
    volatile String launchTarget = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (Storage.prefs(this).getBoolean(Storage.KEY_SECURE, false)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        setupSystemBars(window);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0F5C5A"));
        statusSpacer = new View(this);
        statusSpacer.setBackgroundColor(Color.parseColor("#0F5C5A"));
        navSpacer = new View(this);
        navSpacer.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F3F5F4"));
        root.addView(statusSpacer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(navSpacer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        root.setOnApplyWindowInsetsListener(this::applyInsets);
        setContentView(root);

        configureWebView();
        handleIntent(getIntent());
        loadApp();

        if (Build.VERSION.SDK_INT >= 33) {
            OnBackInvokedCallback cb = this::handleBack;
            backCallback = cb;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
        }
        Reminders.schedule(this);
    }

    /* ------------------------------------------------------------ window & insets */

    private void setupSystemBars(Window window) {
        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15+ always draws edge-to-edge; the spacer views sit under the bars.
            window.setDecorFitsSystemWindows(false);
        } else {
            window.setStatusBarColor(Color.parseColor("#0F5C5A"));
            window.setNavigationBarColor(Build.VERSION.SDK_INT >= 26 ? Color.WHITE : Color.BLACK);
            if (Build.VERSION.SDK_INT >= 26) {
                window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            }
        }
    }

    private WindowInsets applyInsets(View v, WindowInsets insets) {
        int top = 0;
        int bottom = 0;
        if (Build.VERSION.SDK_INT >= 35) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            top = bars.top;
            bottom = Math.max(bars.bottom, ime.bottom);
            v.setPadding(bars.left, 0, bars.right, 0);
        }
        setHeight(statusSpacer, top);
        setHeight(navSpacer, bottom);
        return insets;
    }

    private static void setHeight(View view, int h) {
        ViewGroup.LayoutParams lp = view.getLayoutParams();
        if (lp.height != h) {
            lp.height = h;
            view.setLayoutParams(lp);
        }
    }

    /** Called by the page when the theme changes. */
    void setBarColors(String bar, String nav, boolean darkNavIcons) {
        int barColor = parseColor(bar, "#0F5C5A");
        int navColor = parseColor(nav, "#FFFFFF");
        statusSpacer.setBackgroundColor(barColor);
        navSpacer.setBackgroundColor(navColor);
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 35) {
            WindowInsetsController c = window.getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(darkNavIcons ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS | WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else {
            window.setStatusBarColor(barColor);
            if (Build.VERSION.SDK_INT >= 26) {
                window.setNavigationBarColor(navColor);
                View decor = window.getDecorView();
                int flags = decor.getSystemUiVisibility();
                flags = darkNavIcons ? (flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                decor.setSystemUiVisibility(flags);
            }
        }
    }

    private static int parseColor(String s, String fallback) {
        try {
            return Color.parseColor(s);
        } catch (RuntimeException e) {
            return Color.parseColor(fallback);
        }
    }

    void setSecure(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        Storage.prefs(this).edit().putBoolean(Storage.KEY_SECURE, on).apply();
    }

    /* ------------------------------------------------------------ web view */

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false); // nothing is loaded from the internet
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.addJavascriptInterface(new AppBridge(this), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (scheme.equals("tel")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_DIAL, uri));
                    } catch (ActivityNotFoundException e) {
                        Log.w(TAG, "No dialer", e);
                    }
                    return true;
                }
                // Stay inside the app; never navigate anywhere else.
                return !uri.toString().startsWith(BASE_URL);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("data:") || url.startsWith("blob:")) return null;
                // The page is fully self-contained; refuse every network request.
                return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", null,
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (BuildConfig.DEBUG) Log.d(TAG, m.message() + " (" + m.lineNumber() + ")");
                return true;
            }
        });
    }

    private void loadApp() {
        try (InputStream in = getAssets().open("index.html")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            String html = new String(out.toByteArray(), StandardCharsets.UTF_8);
            // A real https base URL gives the page a stable, secure origin for its storage.
            web.loadDataWithBaseURL(BASE_URL, html, "text/html", "utf-8", null);
        } catch (Exception e) {
            Log.e(TAG, "Could not load the app page", e);
            web.loadData("<h3>Deposit Manager could not start.</h3>", "text/html", "utf-8");
        }
    }

    /* ------------------------------------------------------------ page <-> native */

    /** Deliver the result of an asynchronous request to the page. */
    void callback(String id, JSONObject result) {
        if (id == null) return;
        final String js = "window.DMNativeCallback && window.DMNativeCallback(" + JSONObject.quote(id) + ","
                + JSONObject.quote(result.toString()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    void sendEvent(String name) {
        if (!pageLoaded) return;
        final String js = "window.DMNativeEvent && window.DMNativeEvent(" + JSONObject.quote(name) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private void handleBack() {
        if (!pageLoaded) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("(window.DMNativeEvent ? window.DMNativeEvent('back') : false)", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack(); // Android 12 and older
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String dep = intent.getStringExtra(Reminders.EXTRA_DEPOSIT);
        if (dep != null && !dep.isEmpty()) launchTarget = dep;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        sendEvent("resume");
    }

    @Override
    protected void onPause() {
        sendEvent("pause"); // lets the page finish saving to Excel; JS timers keep running
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
        }
        web.removeJavascriptInterface("AndroidBridge");
        web.destroy();
        super.onDestroy();
    }

    /* ------------------------------------------------------------ pickers & permissions */

    void startOpen(String cb) {
        pendingOpenCb = cb;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{Storage.XLSX_MIME, "application/vnd.ms-excel", "application/octet-stream", "application/zip"});
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launch(i, REQ_OPEN, cb);
    }

    void startCreate(String cb, String name, String mime, byte[] bytes, boolean link) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        if (link) {
            pendingCreateCb = cb;
            pendingCreateBytes = bytes;
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            launch(i, REQ_CREATE, cb);
        } else {
            pendingCopyCb = cb;
            pendingCopyBytes = bytes;
            launch(i, REQ_COPY, cb);
        }
    }

    @SuppressWarnings("deprecation")
    private void launch(Intent i, int req, String cb) {
        try {
            startActivityForResult(i, req);
        } catch (ActivityNotFoundException e) {
            callback(cb, Json.error("This phone has no file picker app."));
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
        switch (requestCode) {
            case REQ_OPEN: {
                String cb = pendingOpenCb;
                pendingOpenCb = null;
                if (uri == null) { callback(cb, Json.cancelled()); return; }
                new Thread(() -> callback(cb, Storage.readPicked(this, uri, data.getFlags()))).start();
                break;
            }
            case REQ_CREATE: {
                String cb = pendingCreateCb;
                byte[] bytes = pendingCreateBytes;
                pendingCreateCb = null;
                pendingCreateBytes = null;
                if (uri == null) { callback(cb, Json.cancelled()); return; }
                new Thread(() -> callback(cb, Storage.writeNewAndLink(this, uri, bytes))).start();
                break;
            }
            case REQ_COPY: {
                String cb = pendingCopyCb;
                byte[] bytes = pendingCopyBytes;
                pendingCopyCb = null;
                pendingCopyBytes = null;
                if (uri == null) { callback(cb, Json.cancelled()); return; }
                new Thread(() -> callback(cb, Storage.writeCopy(this, uri, bytes))).start();
                break;
            }
            default:
                break;
        }
    }

    void requestNotifyPermission(String cb) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingNotifyCb = cb;
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            return;
        }
        if (!Reminders.enabledInSettings(this)) {
            // Turned off in the phone's settings: open the app's notification settings.
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
                startActivity(i);
            } catch (ActivityNotFoundException e) {
                Log.w(TAG, "No notification settings screen", e);
            }
        }
        callback(cb, Json.of("granted", Reminders.canNotify(this)));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFY) {
            String cb = pendingNotifyCb;
            pendingNotifyCb = null;
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            callback(cb, Json.of("granted", granted));
            Reminders.schedule(this);
        }
    }
}
