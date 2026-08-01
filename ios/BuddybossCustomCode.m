#import "BuddybossCustomCode.h"
#import <React/RCTRootView.h>
#import <React/RCTLog.h>
#import <CoreLocation/CoreLocation.h>

@implementation BuddybossCustomCode
{
    CLLocationManager *_locationManager;
    BOOL _isTracking;
    CLLocation *_lastGoodLocation;
}

RCT_EXPORT_MODULE()

- (NSArray<NSString *> *)supportedEvents {
    return @[@"SkedoggleLocation"];
}

// Lifecycle (keep)
+ (void)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions withBridge:(RCTBridge *)bridge {}
+ (void)rootViewVisible:(RCTRootView *)rootView {}

- (instancetype)init {
    self = [super init];
    if (self) {
        _isTracking = NO;
        // Create on main thread synchronously so it is ready immediately
        if ([NSThread isMainThread]) {
            [self setupLocationManager];
        } else {
            dispatch_sync(dispatch_get_main_queue(), ^{
                [self setupLocationManager];
            });
        }
    }
    return self;
}

- (void)setupLocationManager {
    _locationManager = [[CLLocationManager alloc] init];
    _locationManager.delegate = self;
    _locationManager.desiredAccuracy = kCLLocationAccuracyBest;
    _locationManager.distanceFilter = 5.0;               // metres
    _locationManager.pausesLocationUpdatesAutomatically = NO;
    _locationManager.allowsBackgroundLocationUpdates = YES;
    _locationManager.showsBackgroundLocationIndicator = YES;
    _locationManager.activityType = CLActivityTypeFitness; // important for walking
}

#pragma mark - JS methods

RCT_REMAP_METHOD(startBackgroundTracking,
                 startWithResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self->_locationManager) {
            [self setupLocationManager];
        }

        CLAuthorizationStatus status = [CLLocationManager authorizationStatus];

        // Always try to upgrade to Always if we don't have it
        if (status != kCLAuthorizationStatusAuthorizedAlways) {
            [self->_locationManager requestAlwaysAuthorization];
        }

        [self->_locationManager startUpdatingLocation];
        self->_isTracking = YES;
        resolve(@(YES));
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
        resolve(@(YES));
    });
}

#pragma mark - CLLocationManagerDelegate

// iOS 14+
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
    [self handleAuthorizationChange:manager.authorizationStatus];
}

// Older iOS
- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status {
    [self handleAuthorizationChange:status];
}

- (void)handleAuthorizationChange:(CLAuthorizationStatus)status {
    if (status == kCLAuthorizationStatusAuthorizedAlways && self->_isTracking) {
        [self->_locationManager startUpdatingLocation];
    }
}

- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations
{
    if (!self->_isTracking) return;

    CLLocation *loc = locations.lastObject;
    if (!loc) return;

    // ----- Filtering (kills spikes) -----
    // 1. Invalid or very poor accuracy
    if (loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 45.0) {
        return;
    }

    // 2. Too old (more than 15 seconds)
    NSTimeInterval age = -[loc.timestamp timeIntervalSinceNow];
    if (age > 15.0) return;

    // 3. Unrealistic jump from last good point
    if (self->_lastGoodLocation) {
        CLLocationDistance distance = [loc distanceFromLocation:self->_lastGoodLocation];
        NSTimeInterval timeDiff = [loc.timestamp timeIntervalSinceDate:self->_lastGoodLocation.timestamp];
        // Ignore jumps > 80 m that happened in less than 15 s
        if (distance > 80.0 && timeDiff < 15.0) {
            return;
        }
    }

    self->_lastGoodLocation = loc;

    // ----- Send to JS -----
    NSTimeInterval ts = loc.timestamp.timeIntervalSince1970 * 1000.0;
    NSDictionary *payload = @{
        @"type":      @"location",
        @"lat":       @(loc.coordinate.latitude),
        @"lng":       @(loc.coordinate.longitude),
        @"ts":        @(ts),
        @"accuracy":  @(loc.horizontalAccuracy)
    };

    // Send the dictionary directly (cleaner than JSON string)
    [self sendEventWithName:@"SkedoggleLocation" body:payload];
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    RCTLogWarn(@"Skedoggle location error: %@", error.localizedDescription);
}

#pragma mark - Example method (can delete)

RCT_REMAP_METHOD(multiply,
                 multiplyWithA:(nonnull NSNumber*)a withB:(nonnull NSNumber*)b
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    resolve(@([a floatValue] * [b floatValue]));
}

@end
