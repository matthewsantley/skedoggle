import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { BuddybossCustomCode } = NativeModules;

export const applyCustomCode = (externalCodeSetup: any) => {

    if (!BuddybossCustomCode) return;

    const emitter = new NativeEventEmitter(BuddybossCustomCode);

    // Forward native location events into the WebView
    emitter.addListener('SkedoggleLocation', (locationJson) => {
        if (externalCodeSetup.webviewHooksApi?.sendMessageToWebView) {
            externalCodeSetup.webviewHooksApi.sendMessageToWebView(locationJson);
        }
    });

    // Handle messages FROM the WebView
    if (externalCodeSetup.webviewHooksApi?.addMessageHandler) {
        externalCodeSetup.webviewHooksApi.addMessageHandler((message) => {
            try {
                const msg = JSON.parse(message);
                if (msg.action === 'startTracking') {
                    BuddybossCustomCode.startBackgroundTracking();
                } else if (msg.action === 'stopTracking') {
                    BuddybossCustomCode.stopBackgroundTracking();
                }
            } catch (e) {}
        });
    }

};
