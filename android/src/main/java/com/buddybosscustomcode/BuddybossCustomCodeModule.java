package com.buddybosscustomcode;

import android.Manifest;
import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

@ReactModule(name = BuddybossCustomCodeModule.NAME)
public class BuddybossCustomCodeModule
        extends ReactContextBaseJavaModule {

    public static final String NAME =
            "BuddybossCustomCode";

    private static final String TAG =
            "SkedoggleLocation";

    private static final String POST_NOTIFICATIONS_PERMISSION =
            "android.permission.POST_NOTIFICATIONS";

    /*
     Application-level context.

     This lets the foreground service send events without requiring
     the Activity to remain visible.
    */
    private static ReactApplicationContext reactAppContext;

    private int listenerCount =
            0;

    public BuddybossCustomCodeModule(
            ReactApplicationContext reactContext
    ) {
        super(
                reactContext
        );

        reactAppContext =
                reactContext;
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    /**
     * Legacy wrapper retained for compatibility with older service code.
     */
    public static boolean onLocationUpdate(
            double latitude,
            double longitude,
            long timestamp,
            float accuracy
    ) {
        return onLocationUpdate(
                latitude,
                longitude,
                timestamp,
                accuracy,
                "",
                0L
        );
    }

    /**
     * Called by LocationForegroundService for every accepted point.
     *
     * The point has already been saved in LocationBuffer before this
     * method is called. If React Native is asleep, the point remains
     * available for getBufferedLocations().
     */
    public static boolean onLocationUpdate(
            double latitude,
            double longitude,
            long timestamp,
            float accuracy,
            String trackingMode,
            long sessionId
    ) {
        try {
            ReactApplicationContext context =
                    reactAppContext;

            if (context == null) {
                Log.w(
                        TAG,
                        "Location not emitted: React context is null"
                );

                return false;
            }

            if (!context.hasActiveCatalystInstance()) {
                Log.w(
                        TAG,
                        "Location not emitted: React runtime inactive"
                );

                return false;
            }

            WritableMap point =
                    Arguments.createMap();

            point.putString(
                    "type",
                    "location"
            );

            point.putDouble(
                    "lat",
                    latitude
            );

            point.putDouble(
                    "lng",
                    longitude
            );

            point.putDouble(
                    "ts",
                    timestamp
            );

            point.putDouble(
                    "accuracy",
                    accuracy
            );

            point.putBoolean(
                    "native",
                    true
            );

            point.putString(
                    "trackingMode",
                    trackingMode != null
                            ? trackingMode
                            : ""
            );

            point.putDouble(
                    "sessionId",
                    sessionId
            );

            context
                    .getJSModule(
                            DeviceEventManagerModule
                                    .RCTDeviceEventEmitter.class
                    )
                    .emit(
                            "SkedoggleLocation",
                            point
                    );

            return true;

        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "Could not emit location to React Native",
                    exception
            );

            return false;
        }
    }

    /**
     * Existing Walk Tracker API. Kept unchanged for index.js compatibility.
     */
    @ReactMethod
    public void startBackgroundTracking(
            Promise promise
    ) {
        startTrackingInternal(
                LocationForegroundService.MODE_WALK,
                0L,
                promise
        );
    }

    /**
     * Mode-aware API already supported by the current index.js.
     */
    @ReactMethod
    public void startBackgroundTrackingForMode(
            String trackingMode,
            double sessionId,
            Promise promise
    ) {
        startTrackingInternal(
                normaliseTrackingMode(
                        trackingMode
                ),
                (long) sessionId,
                promise
        );
    }

    /**
     * Search Party convenience API already checked by current index.js.
     *
     * userId/token remain in JavaScript where the HTTPS upload occurs;
     * the native service only needs the Search Party session identity.
     */
    @ReactMethod
    public void startSearchPartyTracking(
            double sessionId,
            double userId,
            String token,
            Promise promise
    ) {
        startTrackingInternal(
                LocationForegroundService.MODE_SEARCH_PARTY,
                (long) sessionId,
                promise
        );
    }

    private void startTrackingInternal(
            String trackingMode,
            long sessionId,
            Promise promise
    ) {
        try {
            ReactApplicationContext context =
                    getReactApplicationContext();

            boolean fineGranted =
                    ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_FINE_LOCATION
                    ) == PackageManager.PERMISSION_GRANTED;

            boolean coarseGranted =
                    ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    ) == PackageManager.PERMISSION_GRANTED;

            /*
             Precise location is required for a route. The current index.js
             already recognises this error code and offers Open Settings.
            */
            if (!fineGranted) {
                promise.reject(
                        "location_permission_denied",
                        "Precise location must be enabled before tracking can start."
                );

                return;
            }

            /*
             index.js flushes the existing buffer immediately before calling
             start. Clear any remaining points for this mode so a failed upload
             from a previous walk/search cannot contaminate the new route.
            */
            LocationBuffer.clearMode(
                    context,
                    trackingMode
            );

            Intent intent =
                    new Intent(
                            context,
                            LocationForegroundService.class
                    );

            intent.setAction(
                    LocationForegroundService.ACTION_START
            );

            intent.putExtra(
                    LocationForegroundService.EXTRA_TRACKING_MODE,
                    trackingMode
            );

            intent.putExtra(
                    LocationForegroundService.EXTRA_SESSION_ID,
                    sessionId
            );

            ContextCompat.startForegroundService(
                    context,
                    intent
            );

            boolean notificationsGranted =
                    Build.VERSION.SDK_INT < 33
                            || ContextCompat.checkSelfPermission(
                            context,
                            POST_NOTIFICATIONS_PERMISSION
                    ) == PackageManager.PERMISSION_GRANTED;

            WritableMap result =
                    Arguments.createMap();

            result.putBoolean(
                    "started",
                    true
            );

            result.putBoolean(
                    "fineLocationGranted",
                    fineGranted
            );

            result.putBoolean(
                    "coarseLocationGranted",
                    coarseGranted
            );

            result.putBoolean(
                    "notificationsGranted",
                    notificationsGranted
            );

            result.putString(
                    "platform",
                    "android"
            );

            result.putString(
                    "trackingMode",
                    trackingMode
            );

            result.putDouble(
                    "sessionId",
                    sessionId
            );

            /*
             Android still uploads through the React Native sidecar.
            */
            result.putBoolean(
                    "nativeDirectUpload",
                    false
            );

            promise.resolve(
                    result
            );

        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "Could not start background tracking",
                    exception
            );

            promise.reject(
                    "START_TRACKING_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    @ReactMethod
    public void stopBackgroundTracking(
            Promise promise
    ) {
        try {
            ReactApplicationContext context =
                    getReactApplicationContext();

            boolean stopped =
                    context.stopService(
                            new Intent(
                                    context,
                                    LocationForegroundService.class
                            )
                    );

            promise.resolve(
                    stopped
            );

        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "Could not stop background tracking",
                    exception
            );

            promise.reject(
                    "STOP_TRACKING_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    @ReactMethod
    public void getBufferedLocations(
            Promise promise
    ) {
        try {
            JSONArray stored =
                    LocationBuffer.getLocations(
                            getReactApplicationContext()
                    );

            WritableArray result =
                    Arguments.createArray();

            for (
                    int index = 0;
                    index < stored.length();
                    index++
            ) {
                JSONObject point =
                        stored.optJSONObject(
                                index
                        );

                if (point == null) {
                    continue;
                }

                WritableMap item =
                        Arguments.createMap();

                item.putString(
                        "type",
                        point.optString(
                                "type",
                                "location"
                        )
                );

                item.putDouble(
                        "lat",
                        point.optDouble(
                                "lat"
                        )
                );

                item.putDouble(
                        "lng",
                        point.optDouble(
                                "lng"
                        )
                );

                item.putDouble(
                        "ts",
                        point.optLong(
                                "ts"
                        )
                );

                item.putDouble(
                        "accuracy",
                        point.optDouble(
                                "accuracy",
                                10.0
                        )
                );

                item.putBoolean(
                        "native",
                        true
                );

                item.putString(
                        "trackingMode",
                        point.optString(
                                "trackingMode",
                                ""
                        )
                );

                item.putDouble(
                        "sessionId",
                        point.optLong(
                                "sessionId",
                                0L
                        )
                );

                result.pushMap(
                        item
                );
            }

            promise.resolve(
                    result
            );

        } catch (Exception exception) {
            promise.reject(
                    "GET_BUFFERED_LOCATIONS_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    /**
     * Legacy acknowledgement retained for old index.js builds.
     */
    @ReactMethod
    public void acknowledgeLocation(
            double timestamp,
            Promise promise
    ) {
        try {
            LocationBuffer.acknowledgeLocation(
                    getReactApplicationContext(),
                    (long) timestamp
            );

            promise.resolve(
                    true
            );

        } catch (Exception exception) {
            promise.reject(
                    "ACKNOWLEDGE_LOCATION_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    /**
     * Mode-aware acknowledgement already preferred by current index.js.
     */
    @ReactMethod
    public void acknowledgeLocationForMode(
            double timestamp,
            String trackingMode,
            double sessionId,
            Promise promise
    ) {
        try {
            LocationBuffer.acknowledgeLocationForMode(
                    getReactApplicationContext(),
                    (long) timestamp,
                    normaliseTrackingMode(
                            trackingMode
                    ),
                    (long) sessionId
            );

            promise.resolve(
                    true
            );

        } catch (Exception exception) {
            promise.reject(
                    "ACKNOWLEDGE_LOCATION_FOR_MODE_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    @ReactMethod
    public void clearBufferedLocations(
            Promise promise
    ) {
        try {
            LocationBuffer.clear(
                    getReactApplicationContext()
            );

            promise.resolve(
                    true
            );

        } catch (Exception exception) {
            promise.reject(
                    "CLEAR_BUFFERED_LOCATIONS_ERROR",
                    exception.getMessage(),
                    exception
            );
        }
    }

    /*
     Required by NativeEventEmitter on recent React Native versions.
     These do not start or stop GPS tracking.
    */
    @ReactMethod
    public void addListener(
            String eventName
    ) {
        listenerCount++;
    }

    @ReactMethod
    public void removeListeners(
            double count
    ) {
        listenerCount =
                Math.max(
                        0,
                        listenerCount
                                - (int) count
                );
    }

    private String normaliseTrackingMode(
            String value
    ) {
        if (
                LocationForegroundService.MODE_SEARCH_PARTY.equals(
                        value
                )
        ) {
            return LocationForegroundService.MODE_SEARCH_PARTY;
        }

        return LocationForegroundService.MODE_WALK;
    }

    // Lifecycle methods required by BuddyBoss — do not delete.

    public static void onCreateApplication(
            Application application
    ) {
    }

    public static void onCreateActivity(
            Activity activity,
            Bundle savedInstanceState
    ) {
    }

    public static void onStart(
            Activity activity
    ) {
    }

    public static void onNewIntent(
            Activity activity,
            Intent intent
    ) {
    }

    public static void getPackages(
            List<ReactPackage> packages
    ) {
    }

    @ReactMethod
    public void multiply(
            int a,
            int b,
            Promise promise
    ) {
        promise.resolve(
                a * b
        );
    }
}
