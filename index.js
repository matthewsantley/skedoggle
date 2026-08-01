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

    const emitter = new NativeEventEmitter(BuddybossCustomCode);

    // Forward native location events into the WebView.
    emitter.addListener('SkedoggleLocation', (locationData) => {
        console.log(
            'SKEDOGGLE_RN_NATIVE_LOCATION_RECEIVED',
            locationData
        );

        const sendMessage =
            externalCodeSetup.webviewHooksApi?.sendMessageToWebView;

        if (!sendMessage) {
            console.error(
                'SKEDOGGLE_RN_SEND_TO_WEBVIEW_UNAVAILABLE'
            );
            return;
        }

        try {
            /*
             Send a JSON string so the WebView receives a consistent
             message format.
            */
            sendMessage(
                typeof locationData === 'string'
                    ? locationData
                    : JSON.stringify(locationData)
            );

            console.log(
                'SKEDOGGLE_RN_LOCATION_FORWARDED_TO_WEBVIEW'
            );
        } catch (error) {
            console.error(
                'SKEDOGGLE_RN_LOCATION_FORWARD_FAILED',
                error
            );
        }
    });

    const addMessageHandler =
        externalCodeSetup.webviewHooksApi?.addMessageHandler;

    if (!addMessageHandler) {
        console.error(
            'SKEDOGGLE_RN_MESSAGE_HANDLER_UNAVAILABLE'
        );
        return;
    }

    // Handle messages coming from the WebView.
    addMessageHandler((message) => {
        console.log(
            'SKEDOGGLE_RN_WEBVIEW_MESSAGE_RECEIVED',
            message
        );

        try {
            const msg =
                typeof message === 'string'
                    ? JSON.parse(message)
                    : message;

            if (!msg || typeof msg !== 'object') {
                console.error(
                    'SKEDOGGLE_RN_INVALID_WEBVIEW_MESSAGE',
                    message
                );
                return;
            }

            if (msg.action === 'startTracking') {
                console.log(
                    'SKEDOGGLE_RN_START_TRACKING_RECEIVED'
                );

                Promise.resolve(
                    BuddybossCustomCode.startBackgroundTracking()
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

            if (msg.action === 'stopTracking') {
                console.log(
                    'SKEDOGGLE_RN_STOP_TRACKING_RECEIVED'
                );

                Promise.resolve(
                    BuddybossCustomCode.stopBackgroundTracking()
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
                msg.action
            );
        } catch (error) {
            console.error(
                'SKEDOGGLE_RN_WEBVIEW_MESSAGE_ERROR',
                error,
                message
            );
        }
    });

    console.log(
        'SKEDOGGLE_RN_MESSAGE_HANDLER_REGISTERED'
    );
};
