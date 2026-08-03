package com.buddybosscustomcode;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Persists accepted GPS points so they survive:
 *
 * - the screen being locked;
 * - the React Native runtime being paused;
 * - the BuddyBoss WebView being temporarily unavailable.
 *
 * Points are removed only after index.js confirms that they were
 * successfully posted to the WordPress relay.
 */
public final class LocationBuffer {

    private static final String TAG =
            "SkedoggleLocation";

    private static final String PREFERENCES_NAME =
            "skedoggle_location_buffer";

    private static final String KEY_POINTS =
            "points";

    /*
     At one point every three seconds, 5,000 points is a little over
     four hours of tracking.
    */
    private static final int MAX_POINTS =
            5000;

    private LocationBuffer() {
    }

    public static synchronized void addLocation(
            Context context,
            double latitude,
            double longitude,
            long timestamp,
            float accuracy
    ) {
        try {
            JSONArray existing =
                    readArray(context);

            JSONArray updated =
                    new JSONArray();

            /*
             Remove any existing point with the same timestamp before
             adding the new copy.
            */
            for (int index = 0;
                 index < existing.length();
                 index++) {

                JSONObject point =
                        existing.optJSONObject(index);

                if (point == null) {
                    continue;
                }

                if (point.optLong("ts", -1L)
                        == timestamp) {
                    continue;
                }

                updated.put(point);
            }

            JSONObject point =
                    new JSONObject();

            point.put(
                    "type",
                    "location"
            );

            point.put(
                    "lat",
                    latitude
            );

            point.put(
                    "lng",
                    longitude
            );

            point.put(
                    "ts",
                    timestamp
            );

            point.put(
                    "accuracy",
                    accuracy
            );

            point.put(
                    "native",
                    true
            );

            updated.put(point);

            /*
             Keep only the newest MAX_POINTS readings.
            */
            if (updated.length() > MAX_POINTS) {
                JSONArray trimmed =
                        new JSONArray();

                int firstIndex =
                        updated.length()
                                - MAX_POINTS;

                for (int index = firstIndex;
                     index < updated.length();
                     index++) {

                    JSONObject retained =
                            updated.optJSONObject(index);

                    if (retained != null) {
                        trimmed.put(retained);
                    }
                }

                updated = trimmed;
            }

            saveArray(
                    context,
                    updated
            );

        } catch (JSONException exception) {
            Log.e(
                    TAG,
                    "Could not buffer location",
                    exception
            );
        }
    }

    public static synchronized JSONArray getLocations(
            Context context
    ) {
        JSONArray stored =
                readArray(context);

        /*
         Return a copy so callers cannot modify the stored instance.
        */
        try {
            return new JSONArray(
                    stored.toString()
            );
        } catch (JSONException exception) {
            return new JSONArray();
        }
    }

    public static synchronized void acknowledgeLocation(
            Context context,
            long timestamp
    ) {
        JSONArray existing =
                readArray(context);

        JSONArray retained =
                new JSONArray();

        for (int index = 0;
             index < existing.length();
             index++) {

            JSONObject point =
                    existing.optJSONObject(index);

            if (point == null) {
                continue;
            }

            if (point.optLong("ts", -1L)
                    == timestamp) {
                continue;
            }

            retained.put(point);
        }

        saveArray(
                context,
                retained
        );
    }

    public static synchronized void clear(
            Context context
    ) {
        getPreferences(context)
                .edit()
                .remove(KEY_POINTS)
                .apply();
    }

    private static JSONArray readArray(
            Context context
    ) {
        String value =
                getPreferences(context)
                        .getString(
                                KEY_POINTS,
                                "[]"
                        );

        try {
            return new JSONArray(
                    value != null
                            ? value
                            : "[]"
            );
        } catch (JSONException exception) {
            Log.e(
                    TAG,
                    "Could not read buffered locations",
                    exception
            );

            return new JSONArray();
        }
    }

    private static void saveArray(
            Context context,
            JSONArray points
    ) {
        getPreferences(context)
                .edit()
                .putString(
                        KEY_POINTS,
                        points.toString()
                )
                .apply();
    }

    private static SharedPreferences getPreferences(
            Context context
    ) {
        return context
                .getApplicationContext()
                .getSharedPreferences(
                        PREFERENCES_NAME,
                        Context.MODE_PRIVATE
                );
    }
}
