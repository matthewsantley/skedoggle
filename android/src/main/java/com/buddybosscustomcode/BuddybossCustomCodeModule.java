package com.buddybosscustomcode;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.app.Activity;
import android.app.Application;
import com.facebook.react.ReactPackage;
import java.util.List;

@ReactModule(name = BuddybossCustomCodeModule.NAME)
public class BuddybossCustomCodeModule extends ReactContextBaseJavaModule {

    public static final String NAME = "BuddybossCustomCode";
    private static ReactApplicationContext reactAppContext;

    public BuddybossCustomCodeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactAppContext = reactContext;
    }

    @Override
    @NonNull
    public String getName() { return NAME; }

    // Called by LocationForegroundService when a new location arrives
    public static void onLocationUpdate(double lat, double lng, long timestamp) {
        if (reactAppContext == null) return;
        try {
            String json = "{\"type\":\"location\",\"lat\":" + lat +
                          ",\"lng\":" + lng +
                          ",\"ts\":" + timestamp + "}";
            reactAppContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("SkedoggleLocation", json);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void startBackgroundTracking(Promise promise) {
        try {
            Activity activity = getCurrentActivity();
            if (activity == null) { promise.reject("NO_ACTIVITY", "No activity"); return; }
            Intent intent = new Intent(activity, LocationForegroundService.class);
            intent.setAction(LocationForegroundService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(intent);
            } else {
                activity.startService(intent);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopBackgroundTracking(Promise promise) {
        try {
            Activity activity = getCurrentActivity();
            if (activity == null) { promise.reject("NO_ACTIVITY", "No activity"); return; }
            Intent intent = new Intent(activity, LocationForegroundService.class);
            intent.setAction(LocationForegroundService.ACTION_STOP);
            activity.startService(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    // Lifecycle methods (DO NOT DELETE)
    public static void onCreateApplication(Application application) {}
    public static void onCreateActivity(Activity activity, Bundle savedInstanceState) {}
    public static void onStart(Activity activity) {}
    public static void onNewIntent(Activity activity, Intent intent) {}
    public static void getPackages(List<ReactPackage> packages) {}

    @ReactMethod
    public void multiply(int a, int b, Promise promise) {
        promise.resolve(a * b);
    }
    public static native int nativeMultiply(int a, int b);
}
