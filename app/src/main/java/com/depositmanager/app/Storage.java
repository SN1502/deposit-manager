package com.depositmanager.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** App-private data files and the linked Excel workbook (chosen by the user through the file picker). */
final class Storage {
    static final String XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    static final String PREFS = "native";
    static final String KEY_SECURE = "secureScreen";
    private static final String KEY_LINK_URI = "linkedUri";
    private static final String KEY_LINK_NAME = "linkedName";
    private static final int MAX_BYTES = 25 * 1024 * 1024;
    private static final Object LOCK = new Object();

    private Storage() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ------------------------------------------------------------ private JSON files */

    private static AtomicFile file(Context c, String key) {
        if (!key.equals("data") && !key.equals("prefs") && !key.equals("backup")) {
            throw new IllegalArgumentException("Unknown file " + key);
        }
        return new AtomicFile(new File(c.getFilesDir(), key + ".json"));
    }

    static String load(Context c, String key) {
        synchronized (LOCK) {
            try {
                AtomicFile f = file(c, key);
                if (!f.getBaseFile().exists()) return "";
                return new String(f.readFully(), StandardCharsets.UTF_8);
            } catch (IOException | IllegalArgumentException e) {
                Log.e(MainActivity.TAG, "load " + key, e);
                return "";
            }
        }
    }

    static String save(Context c, String key, String content) {
        synchronized (LOCK) {
            AtomicFile f;
            try {
                f = file(c, key);
            } catch (IllegalArgumentException e) {
                return e.getMessage();
            }
            FileOutputStream out = null;
            try {
                out = f.startWrite();
                out.write(content.getBytes(StandardCharsets.UTF_8));
                f.finishWrite(out);
                return "ok";
            } catch (IOException e) {
                if (out != null) f.failWrite(out);
                Log.e(MainActivity.TAG, "save " + key, e);
                return "Storage error: " + e.getMessage();
            }
        }
    }

    static void delete(Context c, String key) {
        synchronized (LOCK) {
            try {
                file(c, key).delete();
            } catch (IllegalArgumentException ignored) {
                // unknown key: nothing to delete
            }
        }
    }

    /* ------------------------------------------------------------ linked workbook */

    static JSONObject linkedInfo(Context c) {
        SharedPreferences p = prefs(c);
        String uri = p.getString(KEY_LINK_URI, "");
        if (uri.isEmpty()) return null;
        return Json.of("uri", uri, "name", p.getString(KEY_LINK_NAME, "DepositManager.xlsx"));
    }

    static Uri linkedUri(Context c) {
        String s = prefs(c).getString(KEY_LINK_URI, "");
        return s.isEmpty() ? null : Uri.parse(s);
    }

    static boolean hasWriteGrant(Context c, Uri uri) {
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isWritePermission()) return true;
        }
        return false;
    }

    /** Make an already-picked file the linked workbook (only if we may write to it). */
    static JSONObject link(Context c, String uriString, String name) {
        Uri uri = Uri.parse(uriString);
        if (!hasWriteGrant(c, uri)) return Json.error("The app is not allowed to write to this file.");
        Uri old = linkedUri(c);
        prefs(c).edit().putString(KEY_LINK_URI, uri.toString()).putString(KEY_LINK_NAME, name == null || name.isEmpty() ? displayName(c, uri) : name).apply();
        if (old != null && !old.equals(uri)) release(c, old);
        return Json.ok();
    }

    static void unlink(Context c) {
        Uri old = linkedUri(c);
        prefs(c).edit().remove(KEY_LINK_URI).remove(KEY_LINK_NAME).apply();
        if (old != null) release(c, old);
    }

    private static void release(Context c, Uri uri) {
        try {
            c.getContentResolver().releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // already gone
        }
    }

    static JSONObject writeLinked(Context c, byte[] bytes) {
        Uri uri = linkedUri(c);
        if (uri == null) return Json.error("No Excel file is linked.");
        try {
            writeTo(c, uri, bytes);
            return Json.ok();
        } catch (SecurityException e) {
            return Json.error("Permission to the Excel file was lost. Open or create the file again in Settings.");
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "writeLinked", e);
            return Json.error("Could not write the Excel file: " + e.getMessage());
        }
    }

    static JSONObject readLinked(Context c) {
        Uri uri = linkedUri(c);
        if (uri == null) return Json.error("No Excel file is linked.");
        try {
            return Json.of("ok", true, "base64", Base64.encodeToString(readAll(c, uri), Base64.NO_WRAP));
        } catch (Exception e) {
            return Json.error("Could not read the Excel file: " + e.getMessage());
        }
    }

    /** After ACTION_OPEN_DOCUMENT: keep access to the file and return its bytes. */
    static JSONObject readPicked(Context c, Uri uri, int grantFlags) {
        ContentResolver cr = c.getContentResolver();
        try {
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            try {
                cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // read-only, one-time access (e.g. a messaging app attachment)
            }
        }
        try {
            byte[] bytes = readAll(c, uri);
            return Json.of("ok", true, "name", displayName(c, uri), "uri", uri.toString(),
                    "base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        } catch (Exception e) {
            return Json.error("Could not read the file: " + e.getMessage());
        }
    }

    /** After ACTION_CREATE_DOCUMENT for the workbook: write it and remember it. */
    static JSONObject writeNewAndLink(Context c, Uri uri, byte[] bytes) {
        try {
            c.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            return Json.error("The chosen place does not allow the app to keep saving there. Try Downloads or Documents.");
        }
        try {
            writeTo(c, uri, bytes);
            String name = displayName(c, uri);
            Uri old = linkedUri(c);
            prefs(c).edit().putString(KEY_LINK_URI, uri.toString()).putString(KEY_LINK_NAME, name).apply();
            if (old != null && !old.equals(uri)) release(c, old);
            return Json.of("ok", true, "name", name);
        } catch (Exception e) {
            return Json.error("Could not write the file: " + e.getMessage());
        }
    }

    static JSONObject writeCopy(Context c, Uri uri, byte[] bytes) {
        try {
            writeTo(c, uri, bytes);
            return Json.of("ok", true, "name", displayName(c, uri));
        } catch (Exception e) {
            return Json.error("Could not save the file: " + e.getMessage());
        }
    }

    /** Replace the whole file content. "wt" truncates; providers without it get an explicit truncate. */
    static void writeTo(Context c, Uri uri, byte[] bytes) throws IOException {
        ContentResolver cr = c.getContentResolver();
        synchronized (LOCK) {
            try (OutputStream out = cr.openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("Cannot open the file for writing");
                out.write(bytes);
                out.flush();
                return;
            } catch (IllegalArgumentException | UnsupportedOperationException | java.io.FileNotFoundException e) {
                Log.w(MainActivity.TAG, "wt not supported, falling back to rw + truncate", e);
            }
            try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "rw")) {
                if (pfd == null) throw new IOException("Cannot open the file for writing");
                try (FileOutputStream out = new FileOutputStream(pfd.getFileDescriptor())) {
                    out.getChannel().position(0);
                    out.write(bytes);
                    out.getChannel().truncate(bytes.length);
                    out.flush();
                }
            }
        }
    }

    static byte[] readAll(Context c, Uri uri) throws IOException {
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Cannot open the file");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            int total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IOException("The file is too large (over 25 MB)");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    static String displayName(Context c, Uri uri) {
        try (Cursor cur = c.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                String n = cur.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) {
            // fall through to the path segment
        }
        String last = uri.getLastPathSegment();
        return last == null ? "Excel file" : last;
    }
}
