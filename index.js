import {
    NativeModules,
    NativeEventEmitter,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

export const applyCustomCode = (externalCodeSetup: any) => {
    console.log(
        'SKEDOGGLE_RN_APPLY_CUSTOM_CODE',
        Platform.OS,
        Boolean(BuddybossCustomCode)
    );

    if (!BuddybossCustomCode) {
        console.error(
            'SKEDOGGLE_RN_NATIVE_MODULE_MISSING',
            Object.keys(NativeModules)
        );

        return;
    }

    /*
     Listen for locations produced by the native iOS
     CLLocationManager module.
    */
    const emitter = new NativeEventEmitter(
        BuddybossCustomCode
    );

    emitter.addListener(
        'SkedoggleLocation',
        (locationData) => {
            console.log(
                'SKEDOGGLE_RN_NATIVE_LOCATION_RECEIVED',
                locationData
            );

            const sendMessageToWebView =
                externalCodeSetup
                    .webviewHooksApi
                    ?.sendMessageToWebView;

            if (
                typeof sendMessageToWebView !== 'function'
            ) {
                console.error(
                    'SKEDOGGLE_RN_SEND_TO_WEBVIEW_UNAVAILABLE'
                );

                return;
            }

            try {
                const message =
                    typeof locationData === 'string'
                        ? locationData
                        : JSON.stringify(locationData);

                sendMessageToWebView(message);

                console.log(
                    'SKEDOGGLE_RN_LOCATION_FORWARDED_TO_WEBVIEW'
                );
            } catch (error) {
                console.error(
                    'SKEDOGGLE_RN_LOCATION_FORWARD_FAILED',
                    error
                );
            }
        }
    );

    /*
     Obtain BuddyBoss's WebView hooks.
    */
    const webviewHooksApi =
        externalCodeSetup.webviewHooksApi;

    if (!webviewHooksApi) {
        console.error(
            'SKEDOGGLE_RN_WEBVIEW_HOOKS_UNAVAILABLE'
        );

        return;
    }

    /*
     This function handles messages sent by the website using:

     window.ReactNativeWebView.postMessage(...)
    */
    const messageHandler = (message) => {
        console.log(
            'SKEDOGGLE_RN_WEBVIEW_MESSAGE_RECEIVED',
            message
        );

        try {
            /*
             BuddyBoss may provide:

             1. A plain JSON string
             2. An object
             3. A React Native event containing nativeEvent.data
             4. An object containing data
            */
            const rawMessage =
                message?.nativeEvent?.data ??
                message?.data ??
                message;

            const parsedMessage =
                typeof rawMessage === 'string'
                    ? JSON.parse(rawMessage)
                    : rawMessage;

            if (
                !parsedMessage ||
                typeof parsedMessage !== 'object'
            ) {
                console.error(
                    'SKEDOGGLE_RN_INVALID_WEBVIEW_MESSAGE',
                    message
                );

                return;
            }

            if (
                parsedMessage.action ===
                'startTracking'
            ) {
                console.log(
                    'SKEDOGGLE_RN_START_TRACKING_RECEIVED'
                );

                Promise.resolve(
                    BuddybossCustomCode
                        .startBackgroundTracking()
                )
                    .then((result) => {
                        console.log(
                            'SKEDOGGLE_RN_NATIVE_START_SUCCESS',
                            result
                        );
                    })
                    .catch((error) => {
                        console.error(
                            'SKEDOGGLE_RN_NATIVE_START_FAILED',
                            error
                        );
                    });

                return;
            }

            if (
                parsedMessage.action ===
                'stopTracking'
            ) {
                console.log(
                    'SKEDOGGLE_RN_STOP_TRACKING_RECEIVED'
                );

                Promise.resolve(
                    BuddybossCustomCode
                        .stopBackgroundTracking()
                )
                    .then((result) => {
                        console.log(
                            'SKEDOGGLE_RN_NATIVE_STOP_SUCCESS',
                            result
                        );
                    })
                    .catch((error) => {
                        console.error(
                            'SKEDOGGLE_RN_NATIVE_STOP_FAILED',
                            error
                        );
                    });

                return;
            }

            console.log(
                'SKEDOGGLE_RN_UNHANDLED_WEBVIEW_ACTION',
                parsedMessage.action
            );
        } catch (error) {
            console.error(
                'SKEDOGGLE_RN_WEBVIEW_MESSAGE_ERROR',
                error,
                message
            );
        }
    };

    /*
     Register the handler using the BuddyBoss API already
     present in your original file.
    */
    if (
        typeof webviewHooksApi.addMessageHandler ===
        'function'
    ) {
        webviewHooksApi.addMessageHandler(
            messageHandler
        );

        console.log(
            'SKEDOGGLE_RN_MESSAGE_HANDLER_REGISTERED'
        );

        return;
    }

    console.error(
        'SKEDOGGLE_RN_ADD_MESSAGE_HANDLER_UNAVAILABLE'
    );
};
