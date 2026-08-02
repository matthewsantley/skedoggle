import {
    AppState,
    NativeEventEmitter,
    NativeModules,
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

    const webviewHooksApi =
        externalCodeSetup.webviewHooksApi;

    if (!webviewHooksApi) {
        console.error(
            'SKEDOGGLE_RN_WEBVIEW_HOOKS_UNAVAILABLE'
        );

        return;
    }

    const sendMessageToWebView =
        webviewHooksApi.sendMessageToWebView;

    if (
        typeof sendMessageToWebView !== 'function'
    ) {
        console.error(
            'SKEDOGGLE_RN_SEND_TO_WEBVIEW_UNAVAILABLE'
        );

        return;
    }

    /*
     Prevent simultaneous replay attempts.
    */
    let replayInProgress = false;

    /*
     Forward one location into the WebView.

     Only acknowledge it after sendMessageToWebView completes without
     throwing. Unacknowledged points remain in native storage.
    */
    const forwardLocation = async (
        locationData: any
    ) => {
        if (!locationData) {
            return;
        }

        try {
            const message =
                typeof locationData === 'string'
                    ? locationData
                    : JSON.stringify(locationData);

            sendMessageToWebView(message);

            console.log(
                'SKEDOGGLE_RN_LOCATION_FORWARDED_TO_WEBVIEW',
                locationData?.ts
            );

            if (
                locationData?.ts != null &&
                typeof BuddybossCustomCode
                    .acknowledgeLocation ===
                    'function'
            ) {
                await BuddybossCustomCode
                    .acknowledgeLocation(
                        locationData.ts
                    );
            }
        } catch (error) {
            console.error(
                'SKEDOGGLE_RN_LOCATION_FORWARD_FAILED',
                error,
                locationData
            );

            throw error;
        }
    };

    /*
     Retrieve points that were collected while React Native or the
     WebView was suspended.
    */
    const replayBufferedLocations =
        async () => {
            if (replayInProgress) {
                return;
            }

            if (
                typeof BuddybossCustomCode
                    .getBufferedLocations !==
                    'function'
            ) {
                console.error(
                    'SKEDOGGLE_RN_BUFFER_METHOD_UNAVAILABLE'
                );

                return;
            }

            replayInProgress = true;

            try {
                const bufferedLocations =
                    await BuddybossCustomCode
                        .getBufferedLocations();

                if (
                    !Array.isArray(
                        bufferedLocations
                    ) ||
                    bufferedLocations.length === 0
                ) {
                    console.log(
                        'SKEDOGGLE_RN_NO_BUFFERED_LOCATIONS'
                    );

                    return;
                }

                /*
                 Preserve the original native timestamps and replay
                 chronologically.
                */
                const orderedLocations = [
                    ...bufferedLocations,
                ].sort(
                    (a, b) =>
                        Number(a?.ts || 0) -
                        Number(b?.ts || 0)
                );

                console.log(
                    'SKEDOGGLE_RN_REPLAYING_BUFFERED_LOCATIONS',
                    orderedLocations.length
                );

                for (
                    const locationData
                    of orderedLocations
                ) {
                    await forwardLocation(
                        locationData
                    );
                }

                console.log(
                    'SKEDOGGLE_RN_BUFFER_REPLAY_COMPLETE'
                );
            } catch (error) {
                console.error(
                    'SKEDOGGLE_RN_BUFFER_REPLAY_FAILED',
                    error
                );
            } finally {
                replayInProgress = false;
            }
        };

    /*
     Receive live events while React Native is awake.
    */
    const emitter =
        new NativeEventEmitter(
            BuddybossCustomCode
        );

    emitter.addListener(
        'SkedoggleLocation',
        async (locationData) => {
            console.log(
                'SKEDOGGLE_RN_NATIVE_LOCATION_RECEIVED',
                locationData
            );

            try {
                await forwardLocation(
                    locationData
                );
            } catch (error) {
                /*
                 Do nothing else here.

                 The point remains in native storage and will be retried
                 after the app becomes active.
                */
            }
        }
    );

    /*
     Replay native points whenever the app becomes active after being
     locked or backgrounded.
    */
    AppState.addEventListener(
        'change',
        (nextAppState) => {
            console.log(
                'SKEDOGGLE_RN_APP_STATE',
                nextAppState
            );

            if (nextAppState === 'active') {
                setTimeout(
                    () => {
                        replayBufferedLocations();
                    },
                    750
                );
            }
        }
    );

    const messageHandler = async (
        message: any
    ) => {
        console.log(
            'SKEDOGGLE_RN_WEBVIEW_MESSAGE_RECEIVED',
            message
        );

        try {
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

                const result =
                    await BuddybossCustomCode
                        .startBackgroundTracking();

                console.log(
                    'SKEDOGGLE_RN_NATIVE_START_SUCCESS',
                    result
                );

                return;
            }

            if (
                parsedMessage.action ===
                'stopTracking'
            ) {
                console.log(
                    'SKEDOGGLE_RN_STOP_TRACKING_RECEIVED'
                );

                /*
                 First replay anything collected during the locked-screen
                 part of the walk.
                */
                await replayBufferedLocations();

                const result =
                    await BuddybossCustomCode
                        .stopBackgroundTracking();

                /*
                 A final replay catches a point that may have arrived
                 during the stop operation.
                */
                await replayBufferedLocations();

                console.log(
                    'SKEDOGGLE_RN_NATIVE_STOP_SUCCESS',
                    result
                );

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

    if (
        typeof webviewHooksApi
            .addMessageHandler ===
        'function'
    ) {
        webviewHooksApi
            .addMessageHandler(
                messageHandler
            );

        console.log(
            'SKEDOGGLE_RN_MESSAGE_HANDLER_REGISTERED'
        );
    } else {
        console.error(
            'SKEDOGGLE_RN_ADD_MESSAGE_HANDLER_UNAVAILABLE'
        );

        return;
    }

    /*
     Replay anything still present when custom code initially loads.
    */
    setTimeout(
        () => {
            replayBufferedLocations();
        },
        1000
    );
};
