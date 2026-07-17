#import <React/RCTBridgeModule.h>
#import <React/RCTRootView.h>
#import <React/RCTEventEmitter.h>
#import <CoreLocation/CoreLocation.h>

@interface BuddybossCustomCode : RCTEventEmitter <RCTBridgeModule, CLLocationManagerDelegate>

+ (void)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions withBridge:(RCTBridge *)bridge;
+ (void)rootViewVisible:(RCTRootView *)rootView;

@end
