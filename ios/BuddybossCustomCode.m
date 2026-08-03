#import <os/log.h>
#import "BuddybossCustomCode.h"

#import <React/RCTLog.h>
#import <React/RCTRootView.h>
#import <CoreLocation/CoreLocation.h>

static NSString *const SkedoggleBufferedLocationsKey =
    @"SkedoggleBufferedLocations";

static NSString *const SkedoggleWalkLocationIntroSeenKey =
    @"SkedoggleWalkLocationIntroSeenV2";

static NSString *SkedoggleDebugLogPath(void)
{
    NSArray<NSString *> *paths =
        NSSearchPathForDirectoriesInDomains(
            NSDocumentDirectory,
            NSUserDomainMask,
            YES
        );

    NSString *documentsDirectory =
        paths.firstObject;

    if (!documentsDirectory) {
        return nil;
    }

    return [
        documentsDirectory
            stringByAppendingPathComponent:
                @"skedoggle-debug.txt"
    ];
}

static void SkedoggleAppendDebugLog(
    NSString *message
)
{
    if (!message) {
        return;
    }

    @try {
        NSDateFormatter *formatter =
            [[NSDateFormatter alloc] init];

        formatter.locale = [
            NSLocale
                localeWithLocaleIdentifier:
                    @"en_US_POSIX"
        ];

        formatter.dateFormat =
            @"yyyy-MM-dd HH:mm:ss.SSS";

        NSString *timestamp = [
            formatter
                stringFromDate:[NSDate date]
        ];

        NSString *line = [
            NSString stringWithFormat:
                @"%@ %@\n",
                timestamp,
                message
        ];

        NSString *path =
            SkedoggleDebugLogPath();

        if (!path) {
            return;
        }

        NSData *data = [
            line dataUsingEncoding:
                NSUTF8StringEncoding
        ];

        if (!data) {
            return;
        }

        NSFileManager *fileManager =
            [NSFileManager defaultManager];

        if (
            ![fileManager
                fileExistsAtPath:path]
        ) {
            NSError *writeError = nil;

            BOOL written = [
                data writeToFile:path
                         options:
                            NSDataWritingAtomic
                           error:&writeError
            ];

            if (!written) {
                os_log(
                    OS_LOG_DEFAULT,
                    "SKEDOGGLE_DEBUG_FILE_CREATE_FAILED %{public}@",
                    writeError.localizedDescription
                );
            }

            return;
        }

        NSFileHandle *handle = [
            NSFileHandle
                fileHandleForWritingAtPath:path
        ];

        if (!handle) {
            return;
        }

        @try {
            [handle seekToEndOfFile];
            [handle writeData:data];

            if (
                [handle
                    respondsToSelector:
                        @selector(synchronizeAndReturnError:)]
            ) {
                NSError *syncError = nil;

                [handle
                    synchronizeAndReturnError:
                        &syncError];
            } else {
                [handle synchronizeFile];
            }
        } @finally {
            [handle closeFile];
        }
    } @catch (NSException *exception) {
        os_log(
            OS_LOG_DEFAULT,
            "SKEDOGGLE_DEBUG_FILE_EXCEPTION %{public}@",
            exception.reason
        );
    }
}

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
     Every accepted point remains here until React Native confirms
     that it has been forwarded into the WebView.
    */
    NSMutableArray<NSDictionary *> *_bufferedLocations;

    /*
     The initial iOS permission request is asynchronous. Keep the
     React Native promise until the user has made a choice.
    */
    RCTPromiseResolveBlock _pendingStartResolve;
    RCTPromiseRejectBlock _pendingStartReject;
}

RCT_EXPORT_MODULE()

#pragma mark - Diagnostic logging

RCT_EXPORT_METHOD(
    logDiagnostic:
        (NSString *)message
)
{
    NSString *safeMessage =
        message ?: @"(null)";

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"JS %@",
            safeMessage
    ]);

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_DIAG %{public}@",
        safeMessage
    );
}

RCT_REMAP_METHOD(
    getDebugLog,
    getDebugLogWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    NSString *path =
        SkedoggleDebugLogPath();

    if (!path) {
        reject(
            @"debug_log_path_unavailable",
            @"The debug log path could not be created.",
            nil
        );

        return;
    }

    if (
        ![
            [NSFileManager defaultManager]
                fileExistsAtPath:path
        ]
    ) {
        resolve(@"");
        return;
    }

    NSError *error = nil;

    NSString *contents = [
        NSString
            stringWithContentsOfFile:path
                            encoding:
                                NSUTF8StringEncoding
                               error:&error
    ];

    if (error) {
        reject(
            @"debug_log_read_failed",
            error.localizedDescription,
            error
        );

        return;
    }

    resolve(contents ?: @"");
}

RCT_REMAP_METHOD(
    clearDebugLog,
    clearDebugLogWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    NSString *path =
        SkedoggleDebugLogPath();

    if (!path) {
        reject(
            @"debug_log_path_unavailable",
            @"The debug log path could not be created.",
            nil
        );

        return;
    }

    NSFileManager *fileManager =
        [NSFileManager defaultManager];

    if (
        [fileManager
            fileExistsAtPath:path]
    ) {
        NSError *error = nil;

        BOOL removed = [
            fileManager
                removeItemAtPath:path
                           error:&error
        ];

        if (!removed && error) {
            reject(
                @"debug_log_clear_failed",
                error.localizedDescription,
                error
            );

            return;
        }
    }

    SkedoggleAppendDebugLog(
        @"NATIVE debug log cleared"
    );

    resolve(@{
        @"cleared": @YES
    });
}

#pragma mark - Walk location introduction

RCT_REMAP_METHOD(
    hasSeenWalkLocationIntro,
    hasSeenWalkLocationIntroWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    BOOL seen = [
        [NSUserDefaults standardUserDefaults]
            boolForKey:
                SkedoggleWalkLocationIntroSeenKey
    ];

    resolve(@{
        @"seen": @(seen)
    });
}

RCT_REMAP_METHOD(
    markWalkLocationIntroSeen,
    markWalkLocationIntroSeenWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    [
        [NSUserDefaults standardUserDefaults]
            setBool:YES
             forKey:
                 SkedoggleWalkLocationIntroSeenKey
    ];

    [
        [NSUserDefaults standardUserDefaults]
            synchronize
    ];

    SkedoggleAppendDebugLog(
        @"NATIVE walk location introduction marked as seen"
    );

    resolve(@{
        @"saved": @YES
    });
}

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

+ (void)application:
        (UIApplication *)application
    didFinishLaunchingWithOptions:
        (NSDictionary *)launchOptions
    withBridge:
        (RCTBridge *)bridge
{
    SkedoggleAppendDebugLog(
        @"NATIVE didFinishLaunchingWithOptions called"
    );

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_CUSTOM_CODE_LOADED"
    );
}

+ (void)rootViewVisible:
    (RCTRootView *)rootView
{
    SkedoggleAppendDebugLog(
        @"NATIVE rootViewVisible called"
    );
}

#pragma mark - Initialisation

- (instancetype)init
{
    self = [super init];

    if (self) {
        SkedoggleAppendDebugLog(
            @"NATIVE BuddybossCustomCode init started"
        );

        _isTracking = NO;
        _lastGoodLocation = nil;
        _trackingStartedAt = nil;

        [self loadBufferedLocations];
        [self setupLocationManager];

        SkedoggleAppendDebugLog(
            @"NATIVE BuddybossCustomCode init complete"
        );
    }

    return self;
}

#pragma mark - Persistent location buffer

- (void)loadBufferedLocations
{
    NSArray *savedLocations = [
        [NSUserDefaults standardUserDefaults]
            arrayForKey:
                SkedoggleBufferedLocationsKey
    ];

    if (
        [savedLocations
            isKindOfClass:[NSArray class]]
    ) {
        _bufferedLocations =
            [savedLocations mutableCopy];
    } else {
        _bufferedLocations =
            [NSMutableArray array];
    }

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE loaded buffered locations count=%lu",
            (unsigned long)
                _bufferedLocations.count
    ]);

    RCTLogInfo(
        @"Skedoggle loaded %lu buffered locations",
        (unsigned long)
            _bufferedLocations.count
    );
}

- (void)saveBufferedLocations
{
    if (!_bufferedLocations) {
        _bufferedLocations =
            [NSMutableArray array];
    }

    [
        [NSUserDefaults standardUserDefaults]
            setObject:_bufferedLocations
               forKey:
                   SkedoggleBufferedLocationsKey
    ];

    [
        [NSUserDefaults standardUserDefaults]
            synchronize
    ];
}

- (void)clearBufferedLocations
{
    if (!_bufferedLocations) {
        _bufferedLocations =
            [NSMutableArray array];
    }

    [_bufferedLocations removeAllObjects];

    [
        [NSUserDefaults standardUserDefaults]
            removeObjectForKey:
                SkedoggleBufferedLocationsKey
    ];

    [
        [NSUserDefaults standardUserDefaults]
            synchronize
    ];

    SkedoggleAppendDebugLog(
        @"NATIVE buffered locations cleared"
    );

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_BUFFER_CLEARED"
    );
}

- (void)addLocationToBuffer:
    (NSDictionary *)payload
{
    if (!payload) {
        return;
    }

    if (!_bufferedLocations) {
        _bufferedLocations =
            [NSMutableArray array];
    }

    [_bufferedLocations addObject:payload];

    while (
        _bufferedLocations.count >
        10000
    ) {
        [
            _bufferedLocations
                removeObjectAtIndex:0
        ];
    }

    [self saveBufferedLocations];

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE buffered location count=%lu",
            (unsigned long)
                _bufferedLocations.count
    ]);

    RCTLogInfo(
        @"Skedoggle buffered location; count=%lu",
        (unsigned long)
            _bufferedLocations.count
    );
}

#pragma mark - Location manager setup

- (void)setupLocationManager
{
    SkedoggleAppendDebugLog(
        @"NATIVE setupLocationManager called"
    );

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_LOCATION_MANAGER_CREATED"
    );

    if (![NSThread isMainThread]) {
        SkedoggleAppendDebugLog(
            @"NATIVE setupLocationManager moved to main thread"
        );

        dispatch_async(
            dispatch_get_main_queue(),
            ^{
                [self setupLocationManager];
            }
        );

        return;
    }

    if (_locationManager) {
        SkedoggleAppendDebugLog(
            @"NATIVE location manager already exists"
        );

        return;
    }

    _locationManager =
        [[CLLocationManager alloc] init];

    _locationManager.delegate =
        self;

    _locationManager.desiredAccuracy =
        kCLLocationAccuracyBest;

    _locationManager.distanceFilter =
        5.0;

    _locationManager
        .pausesLocationUpdatesAutomatically =
            NO;

    _locationManager
        .allowsBackgroundLocationUpdates =
            YES;

    _locationManager
        .showsBackgroundLocationIndicator =
            YES;

    _locationManager.activityType =
        CLActivityTypeFitness;

    SkedoggleAppendDebugLog(
        @"NATIVE CLLocationManager configured"
    );

    RCTLogInfo(
        @"Skedoggle CLLocationManager configured"
    );
}

#pragma mark - React Native tracking methods

- (BOOL)isPreciseLocationEnabled
{
    if (@available(iOS 14.0, *)) {
        return
            self->_locationManager
                .accuracyAuthorization ==
            CLAccuracyAuthorizationFullAccuracy;
    }

    /*
     The Precise Location control was introduced in iOS 14.
    */
    return YES;
}

- (NSDictionary *)trackingStartResultForStatus:
    (CLAuthorizationStatus)status
{
    return @{
        @"started": @YES,
        @"authorizationStatus":
            @(status),
        @"preciseLocationEnabled":
            @([self isPreciseLocationEnabled])
    };
}

- (void)clearPendingStartPromise
{
    self->_pendingStartResolve = nil;
    self->_pendingStartReject = nil;
}

- (void)beginLocationTrackingWithStatus:
        (CLAuthorizationStatus)status
    resolver:
        (RCTPromiseResolveBlock)resolve
{
    [self clearBufferedLocations];

    self->_trackingStartedAt =
        [NSDate date];

    self->_lastGoodLocation =
        nil;

    self->_isTracking =
        YES;

    [
        self->_locationManager
            startUpdatingLocation
    ];

    BOOL preciseLocationEnabled =
        [self isPreciseLocationEnabled];

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE startUpdatingLocation executed status=%d precise=%@",
            (int)status,
            preciseLocationEnabled
                ? @"YES"
                : @"NO"
    ]);

    resolve(
        [self
            trackingStartResultForStatus:
                status]
    );
}

RCT_REMAP_METHOD(
    startBackgroundTracking,
    startWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    SkedoggleAppendDebugLog(
        @"NATIVE startBackgroundTracking called"
    );

    os_log(
        OS_LOG_DEFAULT,
        "SKEDOGGLE_NATIVE_START_BACKGROUND_TRACKING_CALLED"
    );

    dispatch_async(
        dispatch_get_main_queue(),
        ^{
            if (!self->_locationManager) {
                [self setupLocationManager];
            }

            if (!self->_locationManager) {
                SkedoggleAppendDebugLog(
                    @"NATIVE start failed: location manager unavailable"
                );

                reject(
                    @"location_manager_unavailable",
                    @"The location manager could not be created.",
                    nil
                );

                return;
            }

            if (self->_pendingStartResolve) {
                reject(
                    @"location_start_in_progress",
                    @"A location permission request is already in progress.",
                    nil
                );

                return;
            }

            CLAuthorizationStatus status =
                self->_locationManager
                    .authorizationStatus;

            SkedoggleAppendDebugLog([
                NSString stringWithFormat:
                    @"NATIVE start permission status=%d",
                    (int)status
            ]);

            if (
                status ==
                    kCLAuthorizationStatusDenied ||
                status ==
                    kCLAuthorizationStatusRestricted
            ) {
                SkedoggleAppendDebugLog(
                    @"NATIVE start rejected: permission denied or restricted"
                );

                reject(
                    @"location_permission_denied",
                    @"Location permission has been denied or restricted.",
                    nil
                );

                return;
            }

            if (
                status ==
                    kCLAuthorizationStatusNotDetermined
            ) {
                self->_pendingStartResolve =
                    [resolve copy];

                self->_pendingStartReject =
                    [reject copy];

                SkedoggleAppendDebugLog(
                    @"NATIVE requesting While Using the App location permission"
                );

                [
                    self->_locationManager
                        requestWhenInUseAuthorization
                ];

                return;
            }

            if (
                status ==
                    kCLAuthorizationStatusAuthorizedAlways ||
                status ==
                    kCLAuthorizationStatusAuthorizedWhenInUse
            ) {
                [
                    self
                        beginLocationTrackingWithStatus:
                            status
                        resolver:
                            resolve
                ];

                return;
            }

            reject(
                @"location_permission_unavailable",
                @"Location permission is not available.",
                nil
            );
        }
    );
}

RCT_REMAP_METHOD(
    stopBackgroundTracking,
    stopWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    SkedoggleAppendDebugLog(
        @"NATIVE stopBackgroundTracking called"
    );

    dispatch_async(
        dispatch_get_main_queue(),
        ^{
            if (self->_pendingStartReject) {
                RCTPromiseRejectBlock pendingReject =
                    self->_pendingStartReject;

                [self clearPendingStartPromise];

                pendingReject(
                    @"location_start_cancelled",
                    @"Location tracking was cancelled before permission was granted.",
                    nil
                );
            }

            if (self->_locationManager) {
                [
                    self->_locationManager
                        stopUpdatingLocation
                ];
            }

            self->_isTracking =
                NO;

            self->_lastGoodLocation =
                nil;

            self->_trackingStartedAt =
                nil;

            NSUInteger bufferedCount =
                self->_bufferedLocations
                    .count;

            SkedoggleAppendDebugLog([
                NSString stringWithFormat:
                    @"NATIVE tracking stopped buffered=%lu",
                    (unsigned long)
                        bufferedCount
            ]);

            resolve(@{
                @"stopped": @YES,
                @"bufferedCount":
                    @(bufferedCount)
            });
        }
    );
}

#pragma mark - Buffered point methods

RCT_REMAP_METHOD(
    getBufferedLocations,
    getBufferedLocationsWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    dispatch_async(
        dispatch_get_main_queue(),
        ^{
            NSArray *locations =
                [
                    self->_bufferedLocations
                        copy
                ];

            SkedoggleAppendDebugLog([
                NSString stringWithFormat:
                    @"NATIVE returning buffered locations count=%lu",
                    (unsigned long)
                        locations.count
            ]);

            os_log(
                OS_LOG_DEFAULT,
                "SKEDOGGLE_NATIVE_RETURNING_BUFFERED_LOCATIONS count=%{public}lu",
                (unsigned long)
                    locations.count
            );

            resolve(
                locations ?: @[]
            );
        }
    );
}

RCT_REMAP_METHOD(
    acknowledgeLocation,
    acknowledgeLocationWithTimestamp:
        (nonnull NSNumber *)timestamp
    withResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    dispatch_async(
        dispatch_get_main_queue(),
        ^{
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
                                [
                                    pointTimestamp
                                        doubleValue
                                ]
                                <=
                                acknowledgedTimestamp;
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

            SkedoggleAppendDebugLog([
                NSString stringWithFormat:
                    @"NATIVE acknowledged timestamp=%.0f removed=%lu remaining=%lu",
                    acknowledgedTimestamp,
                    (unsigned long)
                        removedCount,
                    (unsigned long)
                        self->_bufferedLocations
                            .count
            ]);

            resolve(@{
                @"acknowledged": @YES,
                @"removed":
                    @(removedCount),
                @"remaining":
                    @(
                        self->_bufferedLocations
                            .count
                    )
            });
        }
    );
}

RCT_REMAP_METHOD(
    clearBufferedLocations,
    clearBufferedLocationsWithResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
)
{
    dispatch_async(
        dispatch_get_main_queue(),
        ^{
            [self clearBufferedLocations];

            resolve(@{
                @"cleared": @YES
            });
        }
    );
}

#pragma mark - Permission changes

- (void)locationManagerDidChangeAuthorization:
    (CLLocationManager *)manager
{
    [
        self
            handleAuthorizationChange:
                manager.authorizationStatus
    ];
}

- (void)locationManager:
        (CLLocationManager *)manager
    didChangeAuthorizationStatus:
        (CLAuthorizationStatus)status
{
    [
        self
            handleAuthorizationChange:
                status
    ];
}

- (void)handleAuthorizationChange:
    (CLAuthorizationStatus)status
{
    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE location permission changed status=%d tracking=%@ pending=%@",
            (int)status,
            self->_isTracking
                ? @"YES"
                : @"NO",
            self->_pendingStartResolve
                ? @"YES"
                : @"NO"
    ]);

    RCTLogInfo(
        @"Skedoggle location permission changed: %d",
        (int)status
    );

    if (self->_pendingStartResolve) {
        if (
            status ==
                kCLAuthorizationStatusAuthorizedAlways ||
            status ==
                kCLAuthorizationStatusAuthorizedWhenInUse
        ) {
            RCTPromiseResolveBlock pendingResolve =
                self->_pendingStartResolve;

            [self clearPendingStartPromise];

            [
                self
                    beginLocationTrackingWithStatus:
                        status
                    resolver:
                        pendingResolve
            ];

            return;
        }

        if (
            status ==
                kCLAuthorizationStatusDenied ||
            status ==
                kCLAuthorizationStatusRestricted
        ) {
            RCTPromiseRejectBlock pendingReject =
                self->_pendingStartReject;

            [self clearPendingStartPromise];

            self->_isTracking =
                NO;

            if (pendingReject) {
                pendingReject(
                    @"location_permission_denied",
                    @"Location permission has been denied or restricted.",
                    nil
                );
            }

            return;
        }

        /*
         Ignore intermediate Not Determined callbacks while the iOS
         permission sheet is still awaiting the user's choice.
        */
        return;
    }

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

        SkedoggleAppendDebugLog(
            @"NATIVE restarted location updates after permission change"
        );
    }

    if (
        status ==
            kCLAuthorizationStatusDenied ||
        status ==
            kCLAuthorizationStatusRestricted
    ) {
        [
            self->_locationManager
                stopUpdatingLocation
        ];

        self->_isTracking =
            NO;

        SkedoggleAppendDebugLog(
            @"NATIVE tracking stopped after permission denial"
        );

        RCTLogWarn(
            @"Skedoggle tracking stopped because location permission was denied or restricted"
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

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE received location batch count=%lu",
            (unsigned long)
                locations.count
    ]);

    for (
        CLLocation *location
        in locations
    ) {
        [self processLocation:location];
    }
}

- (void)processLocation:
    (CLLocation *)location
{
    if (
        !location ||
        !self->_isTracking
    ) {
        return;
    }

    CLLocationAccuracy accuracy =
        location.horizontalAccuracy;

    NSTimeInterval deliveryAge =
        -[
            location.timestamp
                timeIntervalSinceNow
        ];

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE raw point lat=%.6f lng=%.6f accuracy=%.1f age=%.1f",
            location.coordinate.latitude,
            location.coordinate.longitude,
            accuracy,
            deliveryAge
    ]);

    if (
        accuracy < 0 ||
        accuracy > 100.0
    ) {
        SkedoggleAppendDebugLog([
            NSString stringWithFormat:
                @"NATIVE rejected point accuracy=%.1f",
                accuracy
        ]);

        return;
    }

    if (self->_trackingStartedAt) {
        NSTimeInterval relativeToStart = [
            location.timestamp
                timeIntervalSinceDate:
                    self->_trackingStartedAt
        ];

        if (
            relativeToStart <
            -5.0
        ) {
            SkedoggleAppendDebugLog(
                @"NATIVE rejected point because it predates tracking"
            );

            return;
        }
    }

    if (self->_lastGoodLocation) {
        NSTimeInterval timeDifference = [
            location.timestamp
                timeIntervalSinceDate:
                    self->_lastGoodLocation
                        .timestamp
        ];

        if (timeDifference <= 0) {
            SkedoggleAppendDebugLog(
                @"NATIVE rejected duplicate or out-of-order point"
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
                maximumWalkingSpeed =
                    13.5;

            CLLocationDistance
                accuracyAllowance =
                    MAX(
                        30.0,
                        location
                            .horizontalAccuracy +
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
                SkedoggleAppendDebugLog([
                    NSString stringWithFormat:
                        @"NATIVE rejected spike distance=%.1f time=%.1f allowed=%.1f",
                        distance,
                        timeDifference,
                        maximumAllowedDistance
                ]);

                return;
            }
        }
    }

    self->_lastGoodLocation =
        location;

    NSTimeInterval timestampMilliseconds =
        location.timestamp
            .timeIntervalSince1970 *
        1000.0;

    NSMutableDictionary *payload = [
        @{
            @"type":
                @"location",

            @"lat":
                @(
                    location.coordinate
                        .latitude
                ),

            @"lng":
                @(
                    location.coordinate
                        .longitude
                ),

            @"ts":
                @(
                    timestampMilliseconds
                ),

            @"accuracy":
                @(
                    location
                        .horizontalAccuracy
                ),

            @"altitude":
                @(
                    location.altitude
                )
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

    [self addLocationToBuffer:payload];

    [
        self
            sendEventWithName:
                @"SkedoggleLocation"
            body:payload
    ];

    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE accepted point lat=%.6f lng=%.6f accuracy=%.1f timestamp=%.0f",
            location.coordinate.latitude,
            location.coordinate.longitude,
            location.horizontalAccuracy,
            timestampMilliseconds
    ]);
}

#pragma mark - Location errors

- (void)locationManager:
        (CLLocationManager *)manager
    didFailWithError:
        (NSError *)error
{
    SkedoggleAppendDebugLog([
        NSString stringWithFormat:
            @"NATIVE location error code=%ld message=%@",
            (long)error.code,
            error.localizedDescription
    ]);

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
        self->_isTracking =
            NO;

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
    multiplyWithA:
        (nonnull NSNumber *)a
    withB:
        (nonnull NSNumber *)b
    withResolver:
        (RCTPromiseResolveBlock)resolve
    withRejecter:
        (RCTPromiseRejectBlock)reject
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
