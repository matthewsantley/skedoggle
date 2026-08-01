package com.buddybosscustomcode;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.List;

@ReactModule(name = BuddybossCustomCodeModule.NAME)
public class BuddybossCustomCodeModule
        extends ReactContextBaseJavaModule {

    public static final String NAME = "BuddybossCustomCode";

    private static final String TAG =
            "SkedoggleLocation";

    /*
     Application-level context.

     This lets the foreground service send events without requiring
     the Activity to remain visible.
    */
    private static ReactApplicationContext reactAppContext;

    private int listenerCount = 0;

    public BuddybossCustomCodeModule(
            ReactApplicationContext reactContext
    ) {
        super(reactContext);
        reactAppContext = reactContext;
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    /**
     * Called by LocationForegroundService for every accepted point.
     *
     * Returns true when the event was handed to the active React
     * Native runtime. A false return means the native service received
     * the GPS location, but React Native was not available.
     */
    public static boolean onLocationUpdate(
            double latitude,
            double longitude,
            long timestamp,
            float accuracy
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

            /*
             BuddyBoss may use a React Native version where
             hasActiveCatalystInstance() is deprecated, but the method
             remains useful for compatibility with legacy native modules.
            */
            if (!context.hasActiveCatalystInstance()) {
                Log.w(
                        TAG,
                        "Location not emitted: React runtime inactive"
                );

                return false;
            }

            /*
             Retain the existing JSON-string event format so the current
             BuddyBoss React Native forwarding code keeps working.

             timestamp is milliseconds since 1 January 1970.
            */
            String json =
                    "{"
                    + "\"type\":\"location\","
                    + "\"lat\":" + latitude + ","
                    + "\"lng\":" + longitude + ","
                    + "\"ts\":" + timestamp + ","
                    + "\"accuracy\":" + accuracy
                    + "}";

            context
                    .getJSModule(
                            DeviceEventManagerModule
                                    .RCTDeviceEventEmitter.class
                    )
                    .emit(
                            "SkedoggleLocation",
                            json
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

    @ReactMethod
    public void startBackgroundTracking(
            Promise promise
    ) {
        try {
            ReactApplicationContext context =
                    getReactApplicationContext();

            Intent intent = new Intent(
                    context,
                    LocationForegroundService.class
            );

            intent.setAction(
                    LocationForegroundService.ACTION_START
            );

            /*
             ContextCompat handles the foreground-service start
             appropriately across Android versions.
            */
            ContextCompat.startForegroundService(
                    context,
                    intent
            );

            promise.resolve(true);

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

            /*
             Stopping the service invokes onDestroy(), which removes
             the location listener and removes the foreground
             notification.

             This does not require a currently visible Activity.
            */
            boolean stopped = context.stopService(
                    new Intent(
                            context,
                            LocationForegroundService.class
                    )
            );

            promise.resolve(stopped);

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

    /*
     Required by NativeEventEmitter on recent React Native versions.
     These do not start or stop GPS tracking.
    */
    @ReactMethod
    public void addListener(String eventName) {
        listenerCount++;
    }

    @ReactMethod
    public void removeListeners(double count) {
        listenerCount = Math.max(
                0,
                listenerCount - (int) count
        );
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
        promise.resolve(a * b);
    }
}
