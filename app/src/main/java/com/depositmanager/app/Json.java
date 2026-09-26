package com.depositmanager.app;

import org.json.JSONException;
import org.json.JSONObject;

/** Tiny helpers for building the JSON results sent back to the page. */
final class Json {
    private Json() {}

    static JSONObject of(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (JSONException ignored) {
            // keys are always plain strings here
        }
        return o;
    }

    static JSONObject ok() {
        return of("ok", true);
    }

    static JSONObject error(String message) {
        return of("ok", false, "error", message == null ? "Unknown error" : message);
    }

    static JSONObject cancelled() {
        return of("ok", false, "cancelled", true);
    }
}
