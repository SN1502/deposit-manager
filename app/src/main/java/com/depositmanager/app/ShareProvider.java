package com.depositmanager.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Serves the one file being shared (from the app's cache) to the app the user picks in the
 * share sheet, with temporary read permission. Read-only; nothing else is exposed.
 */
public class ShareProvider extends ContentProvider {
    static final String DIR = "share";

    static String authority(Context c) {
        return c.getPackageName() + ".share";
    }

    static Uri uriFor(Context c, String fileName) {
        return new Uri.Builder().scheme("content").authority(authority(c)).appendPath(fileName).build();
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        Context c = getContext();
        String name = uri.getLastPathSegment();
        if (c == null || name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException();
        File f = new File(new File(c.getCacheDir(), DIR), name);
        if (!f.exists()) throw new FileNotFoundException(name);
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && mode.contains("w")) throw new FileNotFoundException("read-only");
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cur = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        cur.addRow(row);
        return cur;
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        if (n != null && n.toLowerCase().endsWith(".xlsx")) return Storage.XLSX_MIME;
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
