#import <os/log.h>
#import "BuddybossCustomCode.h"

#import <React/RCTLog.h>
#import <React/RCTRootView.h>
#import <CoreLocation/CoreLocation.h>

@implementation BuddybossCustomCode
{
    CLLocationManager *_locationManager;

    BOOL _isTracking;

    CLLocation *_lastGoodLocation;

    /*
     Used to reject cached locations that were created before the
     current walk began.

     We do not reject locations simply because iOS delivered them late.
    */
    NSDate *_trackingStartedAt;
}

RCT_EXPORT_MODULE()

#pragma mark - React Native setup

/*
 React Native should create this module on the main thread because
 CLLocationManager is configured and used from the main thread.
*/
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
    /*
     Required by the BuddyBoss custom-code structure.

     No additional setup is needed here because CLLocationManager is
     created when the native module is initialised.
    */
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

        [self setupLocationManager];
    }

    return self;
}

- (void)setupLocationManager
{
os_log(
    OS_LOG_DEFAULT,
    "SKEDOGGLE_NATIVE_LOCATION_MANAGER_CREATED"
);
    /*
     CLLocationManager should be created on the main thread.
    */
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

    /*
     Best accuracy is appropriate while actively recording a walk.
    */
    _locationManager.desiredAccuracy = kCLLocationAccuracyBest;

    /*
     Request an update after approximately five metres of movement.
     Core Location may still deliver updates differently depending on
     signal quality and system conditions.
    */
    _locationManager.distanceFilter = 5.0;

    /*
     Do not allow iOS to automatically pause the walk because it thinks
     the user has stopped moving.
    */
    _locationManager.pausesLocationUpdatesAutomatically = NO;

    /*
     Required for continuous standard location updates while the app is
     in the background.
    */
    _locationManager.allowsBackgroundLocationUpdates = YES;

    /*
     Displays the blue background-location indicator when appropriate.
    */
    _locationManager.showsBackgroundLocationIndicator = YES;

    /*
     Tell Core Location this is a walking/fitness activity.
    */
    _locationManager.activityType = CLActivityTypeFitness;

    RCTLogInfo(@"Skedoggle CLLocationManager configured");
}

#pragma mark - React Native methods

RCT_REMAP_METHOD(startBackgroundTracking,
                 startWithResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
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

        if (status == kCLAuthorizationStatusDenied ||
            status == kCLAuthorizationStatusRestricted) {

            reject(
                @"location_permission_denied",
                @"Location permission has been denied or restricted.",
                nil
            );

            return;
        }

        /*
         Begin a fresh filtering session.

         Resetting _lastGoodLocation prevents the first point of a new
         walk being compared with the final point of an earlier walk.
        */
        self->_trackingStartedAt = [NSDate date];
        self->_lastGoodLocation = nil;
        self->_isTracking = YES;

        /*
         Request Always permission when it has not yet been granted.

         The user may need to approve the upgrade in iOS Settings or in
         a subsequent iOS permission prompt.
        */
        if (status != kCLAuthorizationStatusAuthorizedAlways) {
            [self->_locationManager requestAlwaysAuthorization];
        }

        [self->_locationManager startUpdatingLocation];

        RCTLogInfo(
            @"Skedoggle background tracking started; permission status: %d",
            (int)status
        );

        resolve(@{
            @"started": @YES,
            @"authorizationStatus": @(status)
        });
    });
}

RCT_REMAP_METHOD(stopBackgroundTracking,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_locationManager stopUpdatingLocation];

        self->_isTracking = NO;
        self->_lastGoodLocation = nil;
        self->_trackingStartedAt = nil;

        RCTLogInfo(@"Skedoggle background tracking stopped");

        resolve(@{
            @"stopped": @YES
        });
    });
}

#pragma mark - Permission changes

/*
 iOS 14 and later.
*/
- (void)locationManagerDidChangeAuthorization:
    (CLLocationManager *)manager
{
    [self handleAuthorizationChange:manager.authorizationStatus];
}

/*
 Older iOS versions.
*/
- (void)locationManager:(CLLocationManager *)manager
    didChangeAuthorizationStatus:(CLAuthorizationStatus)status
{
    [self handleAuthorizationChange:status];
}

- (void)handleAuthorizationChange:(CLAuthorizationStatus)status
{
    RCTLogInfo(
        @"Skedoggle location permission changed: %d",
        (int)status
    );

    if (!self->_isTracking) {
        return;
    }

    if (status == kCLAuthorizationStatusAuthorizedAlways ||
        status == kCLAuthorizationStatusAuthorizedWhenInUse) {

        [self->_locationManager startUpdatingLocation];
    }

    if (status == kCLAuthorizationStatusDenied ||
        status == kCLAuthorizationStatusRestricted) {

        [self->_locationManager stopUpdatingLocation];
        self->_isTracking = NO;

        RCTLogWarn(
            @"Skedoggle tracking stopped because location permission "
             "was denied or restricted"
        );
    }
}

#pragma mark - Location updates

- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations
{
    if (!self->_isTracking || locations.count == 0) {
        return;
    }

    /*
     iOS can deliver multiple queued locations in one callback,
     particularly around background execution.

     Process every location in chronological order. Do not use only
     locations.lastObject.
    */
    RCTLogInfo(
        @"Skedoggle received location batch containing %lu points",
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

    CLLocationAccuracy accuracy = location.horizontalAccuracy;

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

    /*
     A negative accuracy means the location is invalid.

     Background fixes may be less accurate than foreground fixes, so
     100 metres is used initially rather than the previous 45 metres.
     This can be tightened later after checking real device logs.
    */
    if (accuracy < 0 || accuracy > 100.0) {
        RCTLogInfo(
            @"Skedoggle rejected point: accuracy %.1f metres",
            accuracy
        );

        return;
    }

    /*
     Reject only cached locations created before this tracking session.

     Crucially, there is no "older than 15 seconds" check here.
     A genuine point may be delivered late when iOS supplies a queued
     batch of background locations.
    */
    if (self->_trackingStartedAt) {
        NSTimeInterval relativeToStart =
            [location.timestamp
                timeIntervalSinceDate:self->_trackingStartedAt];

        if (relativeToStart < -5.0) {
            RCTLogInfo(
                @"Skedoggle rejected point: predates tracking session"
            );

            return;
        }
    }

    if (self->_lastGoodLocation) {
        NSTimeInterval timeDifference =
            [location.timestamp
                timeIntervalSinceDate:
                    self->_lastGoodLocation.timestamp];

        /*
         Ignore duplicate or out-of-order points.
        */
        if (timeDifference <= 0) {
            RCTLogInfo(
                @"Skedoggle rejected point: duplicate or out of order"
            );

            return;
        }

        CLLocationDistance distance =
            [location
                distanceFromLocation:self->_lastGoodLocation];

        /*
         Apply spike filtering only when points are reasonably close
         together in time.

         After a long gap, the new point is allowed to become the new
         anchor. Otherwise a legitimate move during a lengthy background
         gap could be rejected.
        */
        if (timeDifference <= 60.0) {
            /*
             13.5 metres per second is approximately 30 mph.

             Add the uncertainty of both readings so that two inaccurate
             but genuine points are not mistaken for an impossible jump.
            */
            CLLocationDistance maximumWalkingSpeed = 13.5;

            CLLocationDistance accuracyAllowance =
                MAX(
                    30.0,
                    location.horizontalAccuracy +
                    self->_lastGoodLocation.horizontalAccuracy
                );

            CLLocationDistance maximumAllowedDistance =
                (maximumWalkingSpeed * timeDifference) +
                accuracyAllowance;

            if (distance > maximumAllowedDistance) {
                RCTLogInfo(
                    @"Skedoggle rejected spike: "
                     "distance=%.1f time=%.1f allowed=%.1f",
                    distance,
                    timeDifference,
                    maximumAllowedDistance
                );

                return;
            }
        }
    }

    /*
     The point passed all validation.
    */
    self->_lastGoodLocation = location;

    /*
     React Native and JavaScript use milliseconds since 1 January 1970.
    */
    NSTimeInterval timestampMilliseconds =
        location.timestamp.timeIntervalSince1970 * 1000.0;

    NSMutableDictionary *payload = [
        @{
            @"type": @"location",
            @"lat": @(location.coordinate.latitude),
            @"lng": @(location.coordinate.longitude),
            @"ts": @(timestampMilliseconds),
            @"accuracy": @(location.horizontalAccuracy),
            @"altitude": @(location.altitude)
        }
        mutableCopy
    ];

    /*
     CLLocation uses negative values when course or speed is invalid.
    */
    if (location.speed >= 0) {
        payload[@"speed"] = @(location.speed);
    }

    if (location.course >= 0) {
        payload[@"course"] = @(location.course);
    }

    /*
     Send the original timestamp with every point. The WebView
     JavaScript must preserve msg.ts instead of replacing it with the
     current time.
    */
    [self sendEventWithName:@"SkedoggleLocation"
                       body:payload];

    RCTLogInfo(
        @"Skedoggle accepted point: "
         "lat=%.6f lng=%.6f accuracy=%.1f timestamp=%.0f",
        location.coordinate.latitude,
        location.coordinate.longitude,
        location.horizontalAccuracy,
        timestampMilliseconds
    );
}

#pragma mark - Location errors

- (void)locationManager:(CLLocationManager *)manager
       didFailWithError:(NSError *)error
{
    if (error.code == kCLErrorLocationUnknown) {
        /*
         This error is normally temporary. Core Location should continue
         trying to produce another location.
        */
        RCTLogWarn(
            @"Skedoggle temporary location error: %@",
            error.localizedDescription
        );

        return;
    }

    if (error.code == kCLErrorDenied) {
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

RCT_REMAP_METHOD(multiply,
                 multiplyWithA:(nonnull NSNumber *)a
                 withB:(nonnull NSNumber *)b
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    resolve(@([a floatValue] * [b floatValue]));
}

@end
