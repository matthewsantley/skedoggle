#import "BuddybossCustomCode.h"
#import <React/RCTRootView.h>
#import <React/RCTLog.h>
#import <CoreLocation/CoreLocation.h>

@implementation BuddybossCustomCode
{
    CLLocationManager *_locationManager;
    BOOL _isTracking;
}

RCT_EXPORT_MODULE()

// Required for RCTEventEmitter
- (NSArray<NSString *> *)supportedEvents {
    return @[@"SkedoggleLocation"];
}

// Lifecycle methods (DO NOT DELETE)
+ (void)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions withBridge:(RCTBridge *)bridge
{}

+ (void)rootViewVisible:(RCTRootView *)rootView
{}

// Initialise location manager
- (instancetype)init {
    self = [super init];
    if (self) {
        _isTracking = NO;
        dispatch_async(dispatch_get_main_queue(), ^{
            self->_locationManager = [[CLLocationManager alloc] init];
            self->_locationManager.delegate = self;
            self->_locationManager.desiredAccuracy = kCLLocationAccuracyBest;
            self->_locationManager.distanceFilter = 5; // metres
            self->_locationManager.pausesLocationUpdatesAutomatically = NO;
            self->_locationManager.allowsBackgroundLocationUpdates = YES;
            self->_locationManager.showsBackgroundLocationIndicator = YES;
        });
    }
    return self;
}

// Start background tracking
RCT_REMAP_METHOD(startBackgroundTracking,
                 startWithResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        CLAuthorizationStatus status = [CLLocationManager authorizationStatus];
        if (status == kCLAuthorizationStatusAuthorizedAlways ||
            status == kCLAuthorizationStatusAuthorizedWhenInUse) {
            [self->_locationManager startUpdatingLocation];
            self->_isTracking = YES;
            resolve(@(YES));
        } else {
            [self->_locationManager requestAlwaysAuthorization];
            [self->_locationManager startUpdatingLocation];
            self->_isTracking = YES;
            resolve(@(YES));
        }
    });
}

// Stop background tracking
RCT_REMAP_METHOD(stopBackgroundTracking,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_locationManager stopUpdatingLocation];
        self->_isTracking = NO;
        resolve(@(YES));
    });
}

// CLLocationManagerDelegate — fires on every location update
- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations
{
    CLLocation *loc = locations.lastObject;
    if (!loc || !self->_isTracking) return;

    NSTimeInterval ts = loc.timestamp.timeIntervalSince1970 * 1000;
    NSDictionary *payload = @{
        @"type": @"location",
        @"lat":  @(loc.coordinate.latitude),
        @"lng":  @(loc.coordinate.longitude),
        @"ts":   @(ts)
    };

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];

    [self sendEventWithName:@"SkedoggleLocation" body:jsonStr];
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    RCTLogWarn(@"Skedoggle location error: %@", error.localizedDescription);
}

// Multiply example (can be deleted)
RCT_REMAP_METHOD(multiply,
                 multiplyWithA:(nonnull NSNumber*)a withB:(nonnull NSNumber*)b
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)
{
    NSNumber *result = @([a floatValue] * [b floatValue]);
    resolve(result);
}

@end
