package com.buddybosscustomcode;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.ContextCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class LocationForegroundService
        extends Service
        implements LocationListener {

    public static final String ACTION_START =
            "ACTION_START";

    public static final String ACTION_STOP =
            "ACTION_STOP";

    private static final String TAG =
            "SkedoggleLocation";

    private static final String CHANNEL_ID =
            "sk_walk_tracker";

    private static final int NOTIFICATION_ID =
            1001;

    /*
     Request a new reading after approximately three seconds
     and five metres.
    */
    private static final long MIN_TIME_MS =
            3000L;

    private static final float MIN_DISTANCE_METRES =
            5.0f;

    /*
     Background fixes can be less accurate than foreground fixes.
    */
    private static final float MAX_ACCURACY_METRES =
            100.0f;

    /*
     Approximately 30 mph / 48 km/h.
    */
    private static final double MAX_SPEED_METRES_PER_SECOND =
            13.5;

    /*
     Only compare movement speed across relatively close readings.
    */
    private static final double MAX_FILTER_GAP_SECONDS =
            60.0;

    private LocationManager locationManager;

    private Location lastGoodLocation;

    private long trackingStartedElapsedNanos;

    private boolean updatesRequested;

    @Override
    public void onCreate() {
        super.onCreate();

        locationManager =
                (LocationManager) getSystemService(
                        Context.LOCATION_SERVICE
                );

        trackingStartedElapsedNanos = 0L;
        updatesRequested = false;

        Log.i(
                TAG,
                "Location foreground service created"
        );
    }

    @Override
    public int onStartCommand(
            Intent intent,
            int flags,
            int startId
    ) {
        String action =
                intent != null
                        ? intent.getAction()
                        : null;

        if (ACTION_STOP.equals(action)) {
            stopTrackingService();

            return START_NOT_STICKY;
        }

        /*
         This also handles a sticky restart where intent is null.
        */
        startForegroundWithNotification();

        if (!updatesRequested) {
            lastGoodLocation = null;

            trackingStartedElapsedNanos =
                    SystemClock.elapsedRealtime()
                            * 1_000_000L;

            startLocationUpdates();
        }

        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        createNotificationChannel();

        Notification notification =
                new NotificationCompat.Builder(
                        this,
                        CHANNEL_ID
                )
                .setContentTitle(
                        "Skedoggle Walk Tracker"
                )
                .setContentText(
                        "Tracking your walk…"
                )
                .setSmallIcon(
                        android.R.drawable.ic_menu_mylocation
                )
                .setPriority(
                        NotificationCompat.PRIORITY_LOW
                )
                .setCategory(
                        NotificationCompat.CATEGORY_SERVICE
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();

        int foregroundServiceType = 0;

        if (Build.VERSION.SDK_INT
                >= Build.VERSION_CODES.Q) {

            foregroundServiceType =
                    ServiceInfo
                            .FOREGROUND_SERVICE_TYPE_LOCATION;
        }

        ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                foregroundServiceType
        );

        Log.i(
                TAG,
                "Location foreground notification started"
        );
    }

    private boolean hasLocationPermission() {
        boolean fineGranted =
                ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED;

        boolean coarseGranted =
                ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED;

        return fineGranted || coarseGranted;
    }

    private void startLocationUpdates() {
        if (locationManager == null) {
            Log.e(
                    TAG,
                    "LocationManager is unavailable"
            );

            stopTrackingService();
            return;
        }

        if (!hasLocationPermission()) {
            Log.e(
                    TAG,
                    "Location permission has not been granted"
            );

            stopTrackingService();
            return;
        }

        try {
            locationManager.removeUpdates(this);

            boolean providerRegistered = false;

            if (locationManager.isProviderEnabled(
                    LocationManager.GPS_PROVIDER
            )) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_METRES,
                        this
                );

                providerRegistered = true;

                Log.i(
                        TAG,
                        "GPS location provider registered"
                );
            }

            if (locationManager.isProviderEnabled(
                    LocationManager.NETWORK_PROVIDER
            )) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_METRES,
                        this
                );

                providerRegistered = true;

                Log.i(
                        TAG,
                        "Network location provider registered"
                );
            }

            if (!providerRegistered) {
                Log.e(
                        TAG,
                        "No location provider is enabled"
                );

                stopTrackingService();
                return;
            }

            updatesRequested = true;

        } catch (SecurityException exception) {
            Log.e(
                    TAG,
                    "Location permission failure",
                    exception
            );

            stopTrackingService();

        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "Could not request location updates",
                    exception
            );

            stopTrackingService();
        }
    }

    private void stopLocationUpdates() {
        try {
            if (locationManager != null) {
                locationManager.removeUpdates(this);
            }
        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "Could not remove location updates",
                    exception
            );
        }

        updatesRequested = false;
        lastGoodLocation = null;
        trackingStartedElapsedNanos = 0L;
    }

    private void stopTrackingService() {
        stopLocationUpdates();

        ServiceCompat.stopForeground(
                this,
                ServiceCompat.STOP_FOREGROUND_REMOVE
        );

        stopSelf();

        Log.i(
                TAG,
                "Location foreground service stopped"
        );
    }

    @Override
    public void onLocationChanged(
            Location location
    ) {
        if (location == null) {
            return;
        }

        if (!location.hasAccuracy()) {
            Log.d(
                    TAG,
                    "Rejected location without accuracy"
            );

            return;
        }

        float accuracy =
                location.getAccuracy();

        Log.d(
                TAG,
                "Raw point: provider="
                        + location.getProvider()
                        + " lat="
                        + location.getLatitude()
                        + " lng="
                        + location.getLongitude()
                        + " accuracy="
                        + accuracy
        );

        if (accuracy < 0
                || accuracy > MAX_ACCURACY_METRES) {

            Log.d(
                    TAG,
                    "Rejected inaccurate point: "
                            + accuracy
                            + " metres"
            );

            return;
        }

        long locationElapsedNanos =
                getLocationElapsedRealtimeNanos(
                        location
                );

        if (trackingStartedElapsedNanos > 0) {
            long sessionDifferenceNanos =
                    locationElapsedNanos
                            - trackingStartedElapsedNanos;

            if (sessionDifferenceNanos
                    < -5_000_000_000L) {

                Log.d(
                        TAG,
                        "Rejected point from before tracking session"
                );

                return;
            }
        }

        if (lastGoodLocation != null) {
            long previousElapsedNanos =
                    getLocationElapsedRealtimeNanos(
                            lastGoodLocation
                    );

            long differenceNanos =
                    locationElapsedNanos
                            - previousElapsedNanos;

            if (differenceNanos <= 0) {
                Log.d(
                        TAG,
                        "Rejected duplicate or out-of-order point"
                );

                return;
            }

            double differenceSeconds =
                    differenceNanos
                            / 1_000_000_000.0;

            float distanceMetres =
                    lastGoodLocation.distanceTo(
                            location
                    );

            if (differenceSeconds
                    <= MAX_FILTER_GAP_SECONDS) {

                double accuracyAllowance =
                        Math.max(
                                30.0,
                                location.getAccuracy()
                                        + lastGoodLocation
                                        .getAccuracy()
                        );

                double maximumAllowedDistance =
                        (
                            MAX_SPEED_METRES_PER_SECOND
                                    * differenceSeconds
                        )
                        + accuracyAllowance;

                if (distanceMetres
                        > maximumAllowedDistance) {

                    Log.w(
                            TAG,
                            "Rejected GPS spike: distance="
                                    + distanceMetres
                                    + "m time="
                                    + differenceSeconds
                                    + "s allowed="
                                    + maximumAllowedDistance
                                    + "m"
                    );

                    return;
                }
            }
        }

        lastGoodLocation =
                new Location(location);

        long timestamp =
                location.getTime();

        /*
         Save first. If React Native is asleep while the screen is
         locked, this point remains available for replay after unlock.
        */
        LocationBuffer.addLocation(
                getApplicationContext(),
                location.getLatitude(),
                location.getLongitude(),
                timestamp,
                location.getAccuracy()
        );

        boolean emitted =
                BuddybossCustomCodeModule
                        .onLocationUpdate(
                                location.getLatitude(),
                                location.getLongitude(),
                                timestamp,
                                location.getAccuracy()
                        );

        Log.i(
                TAG,
                "Accepted and buffered point: lat="
                        + location.getLatitude()
                        + " lng="
                        + location.getLongitude()
                        + " accuracy="
                        + location.getAccuracy()
                        + " emittedToReactNative="
                        + emitted
        );
    }

    private long getLocationElapsedRealtimeNanos(
            Location location
    ) {
        if (Build.VERSION.SDK_INT >= 17) {
            return location
                    .getElapsedRealtimeNanos();
        }

        /*
         API 16 fallback. Modern BuddyBoss apps will normally never
         use this branch.
        */
        return location.getTime()
                * 1_000_000L;
    }

    @Override
    public void onProviderEnabled(
            String provider
    ) {
        Log.i(
                TAG,
                "Location provider enabled: "
                        + provider
        );
    }

    @Override
    public void onProviderDisabled(
            String provider
    ) {
        Log.w(
                TAG,
                "Location provider disabled: "
                        + provider
        );
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(
            String provider,
            int status,
            Bundle extras
    ) {
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT
                >= Build.VERSION_CODES.O) {

            NotificationChannel channel =
                    new NotificationChannel(
                            CHANNEL_ID,
                            "Walk Tracker",
                            NotificationManager
                                    .IMPORTANCE_LOW
                    );

            channel.setDescription(
                    "Shows when Skedoggle is recording a walk"
            );

            channel.setShowBadge(false);

            NotificationManager manager =
                    getSystemService(
                            NotificationManager.class
                    );

            if (manager != null) {
                manager.createNotificationChannel(
                        channel
                );
            }
        }
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();

        Log.i(
                TAG,
                "Location foreground service destroyed"
        );

        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(
            Intent intent
    ) {
        return null;
    }
}
