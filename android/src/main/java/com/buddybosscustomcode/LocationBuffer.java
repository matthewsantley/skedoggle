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

    /**
     * Legacy wrapper retained for compatibility.
     */
    public static synchronized void addLocation(
            Context context,
            double latitude,
            double longitude,
            long timestamp,
            float accuracy
    ) {
        addLocation(
                context,
                latitude,
                longitude,
                timestamp,
                accuracy,
                "",
                0L,
                ""
        );
    }

    public static synchronized void addLocation(
            Context context,
            double latitude,
            double longitude,
            long timestamp,
            float accuracy,
            String trackingMode,
            long sessionId,
            String joinId
    ) {
        try {
            JSONArray existing =
                    readArray(
                            context
                    );

            JSONArray updated =
                    new JSONArray();

            String normalisedMode =
                    normaliseMode(
                            trackingMode
                    );

            /*
             Remove an exact duplicate before adding the new copy. Timestamp
             alone is not sufficient once Walk and Search Party are buffered
             independently.
            */
            for (
                    int index = 0;
                    index < existing.length();
                    index++
            ) {
                JSONObject point =
                        existing.optJSONObject(
                                index
                        );

                if (point == null) {
                    continue;
                }

                boolean sameTimestamp =
                        point.optLong(
                                "ts",
                                -1L
                        ) == timestamp;

                boolean sameMode =
                        normaliseMode(
                                point.optString(
                                        "trackingMode",
                                        ""
                                )
                        ).equals(
                                normalisedMode
                        );

                boolean sameSession =
                        point.optLong(
                                "sessionId",
                                0L
                        ) == sessionId;

                boolean sameJoin =
                        point.optString(
                                "joinId",
                                ""
                        ).equals(
                                joinId != null ? joinId : ""
                        );

                if (
                        sameTimestamp &&
                        sameMode &&
                        sameSession &&
                        sameJoin
                ) {
                    continue;
                }

                updated.put(
                        point
                );
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

            point.put(
                    "trackingMode",
                    normalisedMode
            );

            point.put(
                    "sessionId",
                    sessionId
            );

            point.put(
                    "joinId",
                    joinId != null ? joinId : ""
            );

            updated.put(
                    point
            );

            /*
             Keep only the newest MAX_POINTS readings.
            */
            if (updated.length() > MAX_POINTS) {
                JSONArray trimmed =
                        new JSONArray();

                int firstIndex =
                        updated.length()
                                - MAX_POINTS;

                for (
                        int index = firstIndex;
                        index < updated.length();
                        index++
                ) {
                    JSONObject retained =
                            updated.optJSONObject(
                                    index
                            );

                    if (retained != null) {
                        trimmed.put(
                                retained
                        );
                    }
                }

                updated =
                        trimmed;
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
                readArray(
                        context
                );

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

    /**
     * Legacy acknowledgement: remove any point with this timestamp.
     */
    public static synchronized void acknowledgeLocation(
            Context context,
            long timestamp
    ) {
        JSONArray existing =
                readArray(
                        context
                );

        JSONArray retained =
                new JSONArray();

        for (
                int index = 0;
                index < existing.length();
                index++
        ) {
            JSONObject point =
                    existing.optJSONObject(
                            index
                    );

            if (point == null) {
                continue;
            }

            if (
                    point.optLong(
                            "ts",
                            -1L
                    ) == timestamp
            ) {
                continue;
            }

            retained.put(
                    point
            );
        }

        saveArray(
                context,
                retained
        );
    }

    /**
     * Mode-aware acknowledgement used by the current index.js.
     */
    public static synchronized void acknowledgeLocationForMode(
            Context context,
            long timestamp,
            String trackingMode,
            long sessionId
    ) {
        JSONArray existing =
                readArray(
                        context
                );

        JSONArray retained =
                new JSONArray();

        String normalisedMode =
                normaliseMode(
                        trackingMode
                );

        for (
                int index = 0;
                index < existing.length();
                index++
        ) {
            JSONObject point =
                    existing.optJSONObject(
                            index
                    );

            if (point == null) {
                continue;
            }

            boolean sameTimestamp =
                    point.optLong(
                            "ts",
                            -1L
                    ) == timestamp;

            String pointMode =
                    normaliseMode(
                            point.optString(
                                    "trackingMode",
                                    ""
                            )
                    );

            long pointSessionId =
                    point.optLong(
                            "sessionId",
                            0L
                    );

            boolean sameMode =
                    pointMode.equals(
                            normalisedMode
                    );

            boolean sameSession =
                    sessionId > 0L
                            ? pointSessionId ==
                            sessionId
                            : pointSessionId ==
                            0L;

            /*
             Untagged legacy walk points can still be acknowledged by the
             Walk sidecar after an upgrade.
            */
            boolean legacyWalkMatch =
                    LocationForegroundService.MODE_WALK.equals(
                            normalisedMode
                    )
                            && sessionId == 0L
                            && pointMode.length() == 0;

            if (
                    sameTimestamp &&
                            (
                                    (
                                            sameMode &&
                                            sameSession
                                    )
                                            || legacyWalkMatch
                            )
            ) {
                continue;
            }

            retained.put(
                    point
            );
        }

        saveArray(
                context,
                retained
        );
    }

    /**
     * Remove stale points for a new tracking mode before starting it.
     *
     * Untagged points are legacy data from the old Android module. index.js
     * gets one final chance to flush them before a new session begins; after
     * that, keeping them risks injecting an old location into a new route.
     */
    public static synchronized void clearMode(
            Context context,
            String trackingMode
    ) {
        JSONArray existing =
                readArray(
                        context
                );

        JSONArray retained =
                new JSONArray();

        String normalisedMode =
                normaliseMode(
                        trackingMode
                );

        for (
                int index = 0;
                index < existing.length();
                index++
        ) {
            JSONObject point =
                    existing.optJSONObject(
                            index
                    );

            if (point == null) {
                continue;
            }

            String pointMode =
                    normaliseMode(
                            point.optString(
                                    "trackingMode",
                                    ""
                            )
                    );

            if (
                    pointMode.length() == 0 ||
                    pointMode.equals(
                            normalisedMode
                    )
            ) {
                continue;
            }

            retained.put(
                    point
            );
        }

        saveArray(
                context,
                retained
        );
    }

    public static synchronized void acknowledgeSearchPartyLocation(
            Context context,
            long timestamp,
            long sessionId,
            String joinId
    ) {
        JSONArray existing = readArray(context);
        JSONArray retained = new JSONArray();
        String safeJoinId = joinId != null ? joinId : "";

        for (int index = 0; index < existing.length(); index++) {
            JSONObject point = existing.optJSONObject(index);
            if (point == null) continue;

            boolean exact =
                    point.optLong("ts", -1L) == timestamp
                    && MODE_SEARCH_PARTY_SAFE(point.optString("trackingMode", ""))
                    && point.optLong("sessionId", 0L) == sessionId
                    && point.optString("joinId", "").equals(safeJoinId);

            if (!exact) retained.put(point);
        }

        saveArray(context, retained);
    }

    public static synchronized void clearSearchLeg(
            Context context,
            long sessionId,
            String joinId
    ) {
        JSONArray existing = readArray(context);
        JSONArray retained = new JSONArray();
        String safeJoinId = joinId != null ? joinId : "";

        for (int index = 0; index < existing.length(); index++) {
            JSONObject point = existing.optJSONObject(index);
            if (point == null) continue;

            boolean sameLeg =
                    MODE_SEARCH_PARTY_SAFE(point.optString("trackingMode", ""))
                    && point.optLong("sessionId", 0L) == sessionId
                    && point.optString("joinId", "").equals(safeJoinId);

            if (!sameLeg) retained.put(point);
        }

        saveArray(context, retained);
    }

    private static boolean MODE_SEARCH_PARTY_SAFE(String mode) {
        return LocationForegroundService.MODE_SEARCH_PARTY.equals(
                normaliseMode(mode)
        );
    }

    public static synchronized void clear(
            Context context
    ) {
        getPreferences(
                context
        )
                .edit()
                .remove(
                        KEY_POINTS
                )
                .apply();
    }

    private static JSONArray readArray(
            Context context
    ) {
        String value =
                getPreferences(
                        context
                )
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
        getPreferences(
                context
        )
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

    private static String normaliseMode(
            String value
    ) {
        if (value == null) {
            return "";
        }

        String normalised =
                value.trim();

        if (
                LocationForegroundService.MODE_WALK.equals(
                        normalised
                )
                        || LocationForegroundService.MODE_SEARCH_PARTY.equals(
                        normalised
                )
        ) {
            return normalised;
        }

        return "";
    }
}

