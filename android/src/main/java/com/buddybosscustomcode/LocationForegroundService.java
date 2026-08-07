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
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class LocationForegroundService
        extends Service
        implements LocationListener {

    public static final String ACTION_START =
            "ACTION_START";

    public static final String ACTION_STOP =
            "ACTION_STOP";

    public static final String EXTRA_TRACKING_MODE =
            "tracking_mode";

    public static final String EXTRA_SESSION_ID =
            "session_id";

    public static final String MODE_WALK =
            "walk";

    public static final String MODE_SEARCH_PARTY =
            "search_party";

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
     A walk should wait for a reasonably settled first GPS fix instead
     of accepting the first approximate point Android happens to supply.
    */
    private static final float INITIAL_MAX_ACCURACY_METRES =
            25.0f;

    /*
     Once tracking is established, allow a little more variation for
     trees/buildings while still rejecting poor route points.
    */
    private static final float MAX_ACCURACY_METRES =
            40.0f;

    /*
     Search Party can fall back to NETWORK_PROVIDER only when GPS is
     unavailable. Keep that fallback tighter than the old 100m limit.
    */
    private static final float SEARCH_NETWORK_MAX_ACCURACY_METRES =
            50.0f;

    /*
     6.5 m/s is about 14.5 mph / 23.4 km/h. This is deliberately
     generous for a dog walk or run while being far below the old
     30 mph threshold.
    */
    private static final double MAX_SPEED_METRES_PER_SECOND =
            6.5;

    /*
     Very small movements are usually normal GPS jitter and add no
     useful route detail.
    */
    private static final float MIN_MEANINGFUL_MOVE_METRES =
            2.0f;

    private LocationManager locationManager;

    private Location lastGoodLocation;

    private long trackingStartedElapsedNanos;

    private boolean updatesRequested;

    private String trackingMode =
            MODE_WALK;

    private long sessionId =
            0L;

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

        String requestedMode =
                normaliseTrackingMode(
                        intent != null
                                ? intent.getStringExtra(
                                        EXTRA_TRACKING_MODE
                                )
                                : trackingMode
                );

        long requestedSessionId =
                intent != null
                        ? intent.getLongExtra(
                                EXTRA_SESSION_ID,
                                0L
                        )
                        : sessionId;

        boolean trackingIdentityChanged =
                !requestedMode.equals(
                        trackingMode
                )
                        || requestedSessionId !=
                        sessionId;

        trackingMode =
                requestedMode;

        sessionId =
                requestedSessionId;

        /*
         This also handles a sticky restart where intent is null.
        */
        startForegroundWithNotification();

        if (
                !updatesRequested ||
                trackingIdentityChanged
        ) {
            if (updatesRequested) {
                stopLocationUpdates();
            }

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

        String notificationText =
                MODE_SEARCH_PARTY.equals(
                        trackingMode
                )
                        ? "Sharing your Search Party position…"
                        : "Tracking your walk…";

        Notification notification =
                new NotificationCompat.Builder(
                        this,
                        CHANNEL_ID
                )
                        .setContentTitle(
                                "Skedoggle"
                        )
                        .setContentText(
                                notificationText
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

        /*
         Use the Android platform API directly.

         ServiceCompat.startForeground(service, id, notification, type)
         requires a recent AndroidX Core version. BuddyBoss projects can
         contain an older AndroidX Core version, which causes a compile
         failure even though the Java itself is otherwise valid.
        */
        if (Build.VERSION.SDK_INT
                >= Build.VERSION_CODES.Q) {

            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    foregroundServiceType
            );

        } else {
            startForeground(
                    NOTIFICATION_ID,
                    notification
            );
        }

        Log.i(
                TAG,
                "Location foreground notification started"
        );
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
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

        /*
         Route tracking needs precise location. Starting with only coarse
         permission creates exactly the kind of jumps this service is meant
         to prevent.
        */
        if (!hasFineLocationPermission()) {
            Log.e(
                    TAG,
                    "Precise location permission has not been granted"
            );

            stopTrackingService();
            return;
        }

        try {
            locationManager.removeUpdates(this);

            boolean providerRegistered =
                    false;

            boolean gpsEnabled =
                    locationManager.isProviderEnabled(
                            LocationManager.GPS_PROVIDER
                    );

            if (gpsEnabled) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_METRES,
                        this
                );

                providerRegistered =
                        true;

                Log.i(
                        TAG,
                        "GPS location provider registered"
                );

            } else if (
                    MODE_SEARCH_PARTY.equals(
                            trackingMode
                    )
                            && locationManager.isProviderEnabled(
                            LocationManager.NETWORK_PROVIDER
                    )
            ) {
                /*
                 Search Party gets a limited network fallback so a participant
                 can still be visible if GPS is temporarily unavailable.
                 Walk Tracking never mixes GPS and network-provider points.
                */
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_METRES,
                        this
                );

                providerRegistered =
                        true;

                Log.w(
                        TAG,
                        "Search Party using network location because GPS is unavailable"
                );
            }

            if (!providerRegistered) {
                Log.e(
                        TAG,
                        "No suitable precise location provider is enabled"
                );

                stopTrackingService();
                return;
            }

            updatesRequested =
                    true;

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

        updatesRequested =
                false;

        lastGoodLocation =
                null;

        trackingStartedElapsedNanos =
                0L;
    }

    private void stopTrackingService() {
        stopLocationUpdates();

        /*
         Use the platform stopForeground API for compatibility with
         older AndroidX versions bundled by BuddyBoss.
        */
        if (Build.VERSION.SDK_INT
                >= Build.VERSION_CODES.N) {

            stopForeground(
                    STOP_FOREGROUND_REMOVE
            );

        } else {
            //noinspection deprecation
            stopForeground(true);
        }

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

        String provider =
                location.getProvider() != null
                        ? location.getProvider()
                        : "";

        /*
         Walk Tracking is deliberately GPS-only. In the previous version,
         interleaving GPS and NETWORK_PROVIDER readings was a major source of
         route jumps.
        */
        if (
                MODE_WALK.equals(
                        trackingMode
                )
                        && !LocationManager.GPS_PROVIDER.equals(
                        provider
                )
        ) {
            Log.d(
                    TAG,
                    "Rejected non-GPS walk point from provider="
                            + provider
            );

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

        float maximumAccuracy =
                lastGoodLocation == null
                        ? INITIAL_MAX_ACCURACY_METRES
                        : MAX_ACCURACY_METRES;

        if (
                MODE_SEARCH_PARTY.equals(
                        trackingMode
                )
                        && LocationManager.NETWORK_PROVIDER.equals(
                        provider
                )
        ) {
            maximumAccuracy =
                    SEARCH_NETWORK_MAX_ACCURACY_METRES;
        }

        Log.d(
                TAG,
                "Raw point: mode="
                        + trackingMode
                        + " session="
                        + sessionId
                        + " provider="
                        + provider
                        + " lat="
                        + location.getLatitude()
                        + " lng="
                        + location.getLongitude()
                        + " accuracy="
                        + accuracy
        );

        if (
                accuracy < 0
                        || accuracy > maximumAccuracy
        ) {
            Log.d(
                    TAG,
                    "Rejected inaccurate point: "
                            + accuracy
                            + " metres; limit="
                            + maximumAccuracy
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

            if (
                    distanceMetres <
                            MIN_MEANINGFUL_MOVE_METRES
            ) {
                Log.d(
                        TAG,
                        "Rejected GPS jitter: distance="
                                + distanceMetres
                                + "m"
                );

                return;
            }

            /*
             Do not disable spike filtering after a long gap. The old code
             stopped checking after 60 seconds, which could allow a large
             jump immediately after Android resumed GPS delivery.
            */
            double accuracyAllowance =
                    Math.max(
                            15.0,
                            Math.min(
                                    40.0,
                                    Math.max(
                                            location.getAccuracy(),
                                            lastGoodLocation
                                                    .getAccuracy()
                                    )
                            )
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
                                + "m provider="
                                + provider
                );

                return;
            }
        }

        lastGoodLocation =
                new Location(
                        location
                );

        long timestamp =
                location.getTime();

        /*
         Save first. If React Native is asleep while the screen is locked,
         this point remains available for replay after unlock.
        */
        LocationBuffer.addLocation(
                getApplicationContext(),
                location.getLatitude(),
                location.getLongitude(),
                timestamp,
                location.getAccuracy(),
                trackingMode,
                sessionId
        );

        boolean emitted =
                BuddybossCustomCodeModule
                        .onLocationUpdate(
                                location.getLatitude(),
                                location.getLongitude(),
                                timestamp,
                                location.getAccuracy(),
                                trackingMode,
                                sessionId
                        );

        Log.i(
                TAG,
                "Accepted and buffered point: mode="
                        + trackingMode
                        + " session="
                        + sessionId
                        + " lat="
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

    private String normaliseTrackingMode(
            String value
    ) {
        if (
                MODE_SEARCH_PARTY.equals(
                        value
                )
        ) {
            return MODE_SEARCH_PARTY;
        }

        return MODE_WALK;
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
                    "Shows when Skedoggle is using location in the background"
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
