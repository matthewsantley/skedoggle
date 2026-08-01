package com.buddybosscustomcode;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.*;

public class LocationForegroundService extends Service {

    public static final String ACTION_START = "ACTION_START";
    public static final String ACTION_STOP  = "ACTION_STOP";
    private static final String CHANNEL_ID  = "sk_walk_tracker";
    private static final int    NOTIF_ID    = 1001;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private Location lastGoodLocation;

    // Tuning
    private static final long   INTERVAL_MS     = 3000;
    private static final float  MIN_DISTANCE_M  = 5f;
    private static final float  MAX_ACCURACY_M  = 40f;
    private static final float  MAX_JUMP_M      = 80f;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                for (Location loc : result.getLocations()) {
                    processLocation(loc);
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Handle sticky restart (intent == null)
        if (intent == null || ACTION_START.equals(intent.getAction())) {
            startForegroundWithNotification();
            startLocationUpdates();
        } else if (ACTION_STOP.equals(intent.getAction())) {
            stopLocationUpdates();
            stopForeground(true);
            stopSelf();
        }
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        createNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Skedoggle Walk Tracker")
                .setContentText("Tracking your walk…")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();
        startForeground(NOTIF_ID, notification);
    }

    private void startLocationUpdates() {
        try {
            LocationRequest request = new LocationRequest.Builder(
                    Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
                    .setMinUpdateIntervalMillis(INTERVAL_MS)
                    .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
                    .setWaitForAccurateLocation(true)
                    .build();

            fusedClient.requestLocationUpdates(
                    request,
                    locationCallback,
                    Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            e.printStackTrace();
        }
    }

    private void stopLocationUpdates() {
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
    }

    private void processLocation(Location loc) {
        if (loc == null || !loc.hasAccuracy()) return;

        // Accuracy filter
        if (loc.getAccuracy() > MAX_ACCURACY_M) return;

        // Jump filter (stops spikes)
        if (lastGoodLocation != null) {
            float distance = lastGoodLocation.distanceTo(loc);
            long timeDiffMs = loc.getTime() - lastGoodLocation.getTime();
            if (distance > MAX_JUMP_M && timeDiffMs < 15_000) {
                return;
            }
        }

        lastGoodLocation = loc;

        // Send to React Native
        BuddybossCustomCodeModule.onLocationUpdate(
                loc.getLatitude(),
                loc.getLongitude(),
                loc.getTime(),
                loc.getAccuracy()
        );
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Walk Tracker",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
