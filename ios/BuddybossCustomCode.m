#import <os/log.h>
#import "BuddybossCustomCode.h"

#import <React/RCTLog.h>
#import <React/RCTRootView.h>
#import <CoreLocation/CoreLocation.h>

static NSString *const SkedoggleBufferedLocationsKey =
    @"SkedoggleBufferedLocations";

@implementation BuddybossCustomCode
{
    CLLocationManager *_locationManager;

    BOOL _isTracking;

    CLLocation *_lastGoodLocation;

    /*
     Used to reject cached locations created before the current walk.
    */
    NSDate *_trackingStartedAt;

    /*
     Every accepted point remains here until React Native confirms that
     it has been forwarded into the WebView.
    */
    NSMutableArray<NSDictionary *> *_bufferedLocations;
}

RCT_EXPORT_MODULE()

#pragma mark - React Native setup

+ (BOOL)requiresMainQueueSetup
{
    return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[
        @"SkedoggleLocation"
    ];
}

#pragma mark - BuddyBoss lifecycle methods

+ (void)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
    withBridge:(RCTBridge *)bridge
{
    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_CUSTOM_CODE_LOADED"
    );
}

+ (void)rootViewVisible:(RCTRootView *)rootView
{
    /*
     Required by the BuddyBoss custom-code structure.
    */
}

#pragma mark - Initialisation

- (instancetype)init
{
    self = [super init];

    if (self) {
        _isTracking = NO;
        _lastGoodLocation = nil;
        _trackingStartedAt = nil;

        [self loadBufferedLocations];
        [self setupLocationManager];
    }

    return self;
}

#pragma mark - Persistent location buffer

- (void)loadBufferedLocations
{
    NSArray *savedLocations = [
        [NSUserDefaults standardUserDefaults]
            arrayForKey:SkedoggleBufferedLocationsKey
    ];

    if ([savedLocations isKindOfClass:[NSArray class]]) {
        _bufferedLocations = [savedLocations mutableCopy];
    } else {
        _bufferedLocations = [NSMutableArray array];
    }

    RCTLogInfo(
        @"Skedoggle loaded %lu buffered locations",
        (unsigned long)_bufferedLocations.count
    );
}

- (void)saveBufferedLocations
{
    if (!_bufferedLocations) {
        _bufferedLocations = [NSMutableArray array];
    }

    [
        [NSUserDefaults standardUserDefaults]
            setObject:_bufferedLocations
               forKey:SkedoggleBufferedLocationsKey
    ];

    [
        [NSUserDefaults standardUserDefaults]
            synchronize
    ];
}

- (void)clearBufferedLocations
{
    if (!_bufferedLocations) {
        _bufferedLocations = [NSMutableArray array];
    }

    [_bufferedLocations removeAllObjects];

    [
        [NSUserDefaults standardUserDefaults]
            removeObjectForKey:SkedoggleBufferedLocationsKey
    ];

    [
        [NSUserDefaults standardUserDefaults]
            synchronize
    ];

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_BUFFER_CLEARED"
    );
}

- (void)addLocationToBuffer:(NSDictionary *)payload
{
    if (!payload) {
        return;
    }

    if (!_bufferedLocations) {
        _bufferedLocations = [NSMutableArray array];
    }

    [_bufferedLocations addObject:payload];

    /*
     Protect against unlimited storage growth.

     Ten thousand points is far more than a normal walk should need.
    */
    while (_bufferedLocations.count > 10000) {
        [_bufferedLocations removeObjectAtIndex:0];
    }

    [self saveBufferedLocations];

    RCTLogInfo(
        @"Skedoggle buffered location; count=%lu",
        (unsigned long)_bufferedLocations.count
    );
}

#pragma mark - Location manager setup

- (void)setupLocationManager
{
    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_LOCATION_MANAGER_CREATED"
    );

    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self setupLocationManager];
        });

        return;
    }

    if (_locationManager) {
        return;
    }

    _locationManager = [[CLLocationManager alloc] init];
    _locationManager.delegate = self;

    _locationManager.desiredAccuracy =
        kCLLocationAccuracyBest;

    _locationManager.distanceFilter = 5.0;

    _locationManager.pausesLocationUpdatesAutomatically =
        NO;

    _locationManager.allowsBackgroundLocationUpdates =
        YES;

    _locationManager.showsBackgroundLocationIndicator =
        YES;

    _locationManager.activityType =
        CLActivityTypeFitness;

    RCTLogInfo(
        @"Skedoggle CLLocationManager configured"
    );
}

#pragma mark - React Native tracking methods

RCT_REMAP_METHOD(
    startBackgroundTracking,
    startWithResolver:(RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_START_BACKGROUND_TRACKING_CALLED"
    );

    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self->_locationManager) {
            [self setupLocationManager];
        }

        if (!self->_locationManager) {
            reject(
                @"location_manager_unavailable",
                @"The location manager could not be created.",
                nil
            );

            return;
        }

        CLAuthorizationStatus status =
            self->_locationManager.authorizationStatus;

        if (
            status == kCLAuthorizationStatusDenied ||
            status == kCLAuthorizationStatusRestricted
        ) {
            reject(
                @"location_permission_denied",
                @"Location permission has been denied or restricted.",
                nil
            );

            return;
        }

        /*
         A new walk must not replay points from an older walk.
        */
        [self clearBufferedLocations];

        self->_trackingStartedAt = [NSDate date];
        self->_lastGoodLocation = nil;
        self->_isTracking = YES;

        if (
            status !=
            kCLAuthorizationStatusAuthorizedAlways
        ) {
            [
                self->_locationManager
                    requestAlwaysAuthorization
            ];
        }

        [
            self->_locationManager
                startUpdatingLocation
        ];

        RCTLogInfo(
            @"Skedoggle background tracking started; "
             "permission status: %d",
            (int)status
        );

        resolve(@{
            @"started": @YES,
            @"authorizationStatus": @(status)
        });
    });
}

RCT_REMAP_METHOD(
    stopBackgroundTracking,
    stopWithResolver:(RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [
            self->_locationManager
                stopUpdatingLocation
        ];

        self->_isTracking = NO;
        self->_lastGoodLocation = nil;
        self->_trackingStartedAt = nil;

        RCTLogInfo(
            @"Skedoggle background tracking stopped; "
             "%lu points remain buffered",
            (unsigned long)
                self->_bufferedLocations.count
        );

        resolve(@{
            @"stopped": @YES,
            @"bufferedCount":
                @(self->_bufferedLocations.count)
        });
    });
}

#pragma mark - Buffered point methods

RCT_REMAP_METHOD(
    getBufferedLocations,
    getBufferedLocationsWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        NSArray *locations =
            [self->_bufferedLocations copy];

        os_log(
            OS_LOG_DEFAULT,
            "SKEDOGGLE_NATIVE_RETURNING_BUFFERED_LOCATIONS count=%{public}lu",
            (unsigned long)locations.count
        );

        resolve(locations ?: @[]);
    });
}

RCT_REMAP_METHOD(
    acknowledgeLocation,
    acknowledgeLocationWithTimestamp:
        (nonnull NSNumber *)timestamp
    withResolver:(RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!timestamp) {
            reject(
                @"invalid_timestamp",
                @"A timestamp is required.",
                nil
            );

            return;
        }

        double acknowledgedTimestamp =
            [timestamp doubleValue];

        NSIndexSet *indexesToRemove = [
            self->_bufferedLocations
                indexesOfObjectsPassingTest:
                    ^BOOL(
                        NSDictionary *point,
                        NSUInteger index,
                        BOOL *stop
                    ) {
                        NSNumber *pointTimestamp =
                            point[@"ts"];

                        if (!pointTimestamp) {
                            return NO;
                        }

                        return
                            [pointTimestamp doubleValue]
                            <= acknowledgedTimestamp;
                    }
        ];

        NSUInteger removedCount =
            indexesToRemove.count;

        if (removedCount > 0) {
            [
                self->_bufferedLocations
                    removeObjectsAtIndexes:
                        indexesToRemove
            ];

            [self saveBufferedLocations];
        }

        RCTLogInfo(
            @"Skedoggle acknowledged timestamp %.0f; "
             "removed=%lu remaining=%lu",
            acknowledgedTimestamp,
            (unsigned long)removedCount,
            (unsigned long)
                self->_bufferedLocations.count
        );

        resolve(@{
            @"acknowledged": @YES,
            @"removed": @(removedCount),
            @"remaining":
                @(self->_bufferedLocations.count)
        });
    });
}

RCT_REMAP_METHOD(
    clearBufferedLocations,
    clearBufferedLocationsWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self clearBufferedLocations];

        resolve(@{
            @"cleared": @YES
        });
    });
}

#pragma mark - Permission changes

- (void)locationManagerDidChangeAuthorization:
    (CLLocationManager *)manager
{
    [
        self handleAuthorizationChange:
            manager.authorizationStatus
    ];
}

- (void)locationManager:
        (CLLocationManager *)manager
    didChangeAuthorizationStatus:
        (CLAuthorizationStatus)status
{
    [self handleAuthorizationChange:status];
}

- (void)handleAuthorizationChange:
    (CLAuthorizationStatus)status
{
    RCTLogInfo(
        @"Skedoggle location permission changed: %d",
        (int)status
    );

    if (!self->_isTracking) {
        return;
    }

    if (
        status ==
            kCLAuthorizationStatusAuthorizedAlways ||
        status ==
            kCLAuthorizationStatusAuthorizedWhenInUse
    ) {
        [
            self->_locationManager
                startUpdatingLocation
        ];
    }

    if (
        status == kCLAuthorizationStatusDenied ||
        status == kCLAuthorizationStatusRestricted
    ) {
        [
            self->_locationManager
                stopUpdatingLocation
        ];

        self->_isTracking = NO;

        RCTLogWarn(
            @"Skedoggle tracking stopped because "
             "location permission was denied or restricted"
        );
    }
}

#pragma mark - Location updates

- (void)locationManager:
        (CLLocationManager *)manager
    didUpdateLocations:
        (NSArray<CLLocation *> *)locations
{
    if (
        !self->_isTracking ||
        locations.count == 0
    ) {
        return;
    }

    RCTLogInfo(
        @"Skedoggle received location batch "
         "containing %lu points",
        (unsigned long)locations.count
    );

    for (CLLocation *location in locations) {
        [self processLocation:location];
    }
}

- (void)processLocation:(CLLocation *)location
{
    if (!location || !self->_isTracking) {
        return;
    }

    CLLocationAccuracy accuracy =
        location.horizontalAccuracy;

    NSTimeInterval deliveryAge =
        -[location.timestamp timeIntervalSinceNow];

    RCTLogInfo(
        @"Skedoggle raw point: "
         "lat=%.6f lng=%.6f accuracy=%.1f age=%.1f",
        location.coordinate.latitude,
        location.coordinate.longitude,
        accuracy,
        deliveryAge
    );

    if (
        accuracy < 0 ||
        accuracy > 100.0
    ) {
        RCTLogInfo(
            @"Skedoggle rejected point: "
             "accuracy %.1f metres",
            accuracy
        );

        return;
    }

    if (self->_trackingStartedAt) {
        NSTimeInterval relativeToStart = [
            location.timestamp
                timeIntervalSinceDate:
                    self->_trackingStartedAt
        ];

        if (relativeToStart < -5.0) {
            RCTLogInfo(
                @"Skedoggle rejected point: "
                 "predates tracking session"
            );

            return;
        }
    }

    if (self->_lastGoodLocation) {
        NSTimeInterval timeDifference = [
            location.timestamp
                timeIntervalSinceDate:
                    self->_lastGoodLocation.timestamp
        ];

        if (timeDifference <= 0) {
            RCTLogInfo(
                @"Skedoggle rejected point: "
                 "duplicate or out of order"
            );

            return;
        }

        CLLocationDistance distance = [
            location
                distanceFromLocation:
                    self->_lastGoodLocation
        ];

        if (timeDifference <= 60.0) {
            CLLocationDistance
                maximumWalkingSpeed = 13.5;

            CLLocationDistance accuracyAllowance =
                MAX(
                    30.0,
                    location.horizontalAccuracy +
                    self->_lastGoodLocation
                        .horizontalAccuracy
                );

            CLLocationDistance
                maximumAllowedDistance =
                    (
                        maximumWalkingSpeed *
                        timeDifference
                    ) +
                    accuracyAllowance;

            if (
                distance >
                maximumAllowedDistance
            ) {
                RCTLogInfo(
                    @"Skedoggle rejected spike: "
                     "distance=%.1f time=%.1f "
                     "allowed=%.1f",
                    distance,
                    timeDifference,
                    maximumAllowedDistance
                );

                return;
            }
        }
    }

    self->_lastGoodLocation = location;

    NSTimeInterval timestampMilliseconds =
        location.timestamp.timeIntervalSince1970 *
        1000.0;

    NSMutableDictionary *payload = [
        @{
            @"type": @"location",
            @"lat":
                @(location.coordinate.latitude),
            @"lng":
                @(location.coordinate.longitude),
            @"ts":
                @(timestampMilliseconds),
            @"accuracy":
                @(location.horizontalAccuracy),
            @"altitude":
                @(location.altitude)
        }
        mutableCopy
    ];

    if (location.speed >= 0) {
        payload[@"speed"] =
            @(location.speed);
    }

    if (location.course >= 0) {
        payload[@"course"] =
            @(location.course);
    }

    /*
     Save before attempting to emit the event.

     If React Native is asleep, the persistent copy remains available
     when the app wakes.
    */
    [self addLocationToBuffer:payload];

    /*
     This delivers immediately when React Native is awake.
    */
    [
        self
            sendEventWithName:
                @"SkedoggleLocation"
            body:payload
    ];

    RCTLogInfo(
        @"Skedoggle accepted point: "
         "lat=%.6f lng=%.6f accuracy=%.1f "
         "timestamp=%.0f",
        location.coordinate.latitude,
        location.coordinate.longitude,
        location.horizontalAccuracy,
        timestampMilliseconds
    );
}

#pragma mark - Location errors

- (void)locationManager:
        (CLLocationManager *)manager
    didFailWithError:(NSError *)error
{
    if (
        error.code ==
        kCLErrorLocationUnknown
    ) {
        RCTLogWarn(
            @"Skedoggle temporary location error: %@",
            error.localizedDescription
        );

        return;
    }

    if (
        error.code ==
        kCLErrorDenied
    ) {
        self->_isTracking = NO;

        RCTLogWarn(
            @"Skedoggle location access denied: %@",
            error.localizedDescription
        );

        return;
    }

    RCTLogWarn(
        @"Skedoggle location error %ld: %@",
        (long)error.code,
        error.localizedDescription
    );
}

#pragma mark - Existing example method

RCT_REMAP_METHOD(
    multiply,
    multiplyWithA:(nonnull NSNumber *)a
    withB:(nonnull NSNumber *)b
    withResolver:(RCTPromiseResolveBlock)resolve
    withRejecter:(RCTPromiseRejectBlock)reject
)
{
    resolve(
        @(
            [a floatValue] *
            [b floatValue]
        )
    );
}

@end
