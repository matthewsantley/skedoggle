import {
    Alert,
    AppState,
    NativeEventEmitter,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

let customCodeInstalled = false;
let currentWebView = null;
let replayInProgress = false;

const parseWebViewMessage = (event) => {
    try {
        const rawMessage =
            event?.nativeEvent?.data ??
            event?.data ??
            event;

        if (typeof rawMessage === 'string') {
            return JSON.parse(rawMessage);
        }

        return rawMessage;
    } catch (error) {
        return null;
    }
};

const preserveRef = (
    originalRef,
    webView
) => {
    try {
        if (
            typeof originalRef ===
            'function'
        ) {
            originalRef(webView);
            return;
        }

        if (
            originalRef &&
            typeof originalRef ===
                'object'
        ) {
            originalRef.current =
                webView;
        }
    } catch (error) {
        /*
         Do not prevent Skedoggle from retaining the WebView reference.
        */
    }
};

const sendMessageIntoWebView = (
    payload
) => {
    if (
        !currentWebView ||
        typeof currentWebView
            .injectJavaScript !==
            'function'
    ) {
        return false;
    }

    try {
        const message =
            typeof payload === 'string'
                ? payload
                : JSON.stringify(payload);

        /*
         Encode the JSON string safely before inserting it into
         JavaScript executed inside the WebView.
        */
        const encodedMessage =
            JSON.stringify(message);

        const script = `
            (function () {
                try {
                    var data = ${encodedMessage};

                    function dispatchMessage(target) {
                        var event;

                        try {
                            event = new MessageEvent(
                                'message',
                                {
                                    data: data
                                }
                            );
                        } catch (error) {
                            event =
                                document.createEvent(
                                    'MessageEvent'
                                );

                            event.initMessageEvent(
                                'message',
                                true,
                                true,
                                data,
                                '',
                                '',
                                window,
                                null
                            );
                        }

                        target.dispatchEvent(event);
                    }

                    dispatchMessage(window);
                    dispatchMessage(document);
                } catch (error) {
                    /* Leave the point buffered for later replay. */
                }
            })();

            true;
        `;

        currentWebView.injectJavaScript(
            script
        );

        return true;
    } catch (error) {
        return false;
    }
};

const acknowledgeLocation = async (
    locationData
) => {
    if (
        locationData?.ts == null ||
        typeof BuddybossCustomCode
            ?.acknowledgeLocation !==
            'function'
    ) {
        return;
    }

    await BuddybossCustomCode
        .acknowledgeLocation(
            locationData.ts
        );
};

const forwardLocationToWebView =
    async (locationData) => {
        if (!locationData) {
            return false;
        }

        const sent =
            sendMessageIntoWebView(
                locationData
            );

        if (!sent) {
            /*
             Do not acknowledge it.

             The native module will keep it in persistent storage.
            */
            return false;
        }

        await acknowledgeLocation(
            locationData
        );

        return true;
    };

const replayBufferedLocations =
    async () => {
        if (replayInProgress) {
            return;
        }

        if (
            typeof BuddybossCustomCode
                ?.getBufferedLocations !==
            'function'
        ) {
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
                return;
            }

            const orderedLocations = [
                ...bufferedLocations,
            ].sort(
                (first, second) =>
                    Number(first?.ts || 0) -
                    Number(second?.ts || 0)
            );

            for (
                const locationData
                of orderedLocations
            ) {
                const forwarded =
                    await forwardLocationToWebView(
                        locationData
                    );

                if (!forwarded) {
                    break;
                }
            }
        } catch (error) {
            /*
             Any unacknowledged points remain in native storage.
            */
        } finally {
            replayInProgress = false;
        }
    };

const startNativeTracking =
    async () => {
        if (
            typeof BuddybossCustomCode
                ?.startBackgroundTracking !==
            'function'
        ) {
            Alert.alert(
                'Skedoggle GPS',
                'The native background GPS method is unavailable.'
            );

            return;
        }

        try {
            const result =
                await BuddybossCustomCode
                    .startBackgroundTracking();

            Alert.alert(
                'Skedoggle GPS',
                [
                    'Native background tracking started.',
                    '',
                    `Permission status: ${
                        result
                            ?.authorizationStatus ??
                        'unknown'
                    }`,
                ].join('\n')
            );
        } catch (error) {
            Alert.alert(
                'Skedoggle GPS Error',
                String(
                    error?.message ??
                    error
                )
            );
        }
    };

const stopNativeTracking =
    async () => {
        if (
            typeof BuddybossCustomCode
                ?.stopBackgroundTracking !==
            'function'
        ) {
            return;
        }

        try {
            /*
             Replay before stopping while the walk page should still
             be able to receive native points.
            */
            await replayBufferedLocations();

            await BuddybossCustomCode
                .stopBackgroundTracking();

            /*
             Catch any point delivered during the stop operation.
            */
            await replayBufferedLocations();
        } catch (error) {
            Alert.alert(
                'Skedoggle GPS Error',
                String(
                    error?.message ??
                    error
                )
            );
        }
    };

const handleWebViewMessage =
    async (event) => {
        const parsedMessage =
            parseWebViewMessage(event);

        if (
            !parsedMessage ||
            typeof parsedMessage !==
                'object'
        ) {
            return;
        }

        if (
            parsedMessage.action ===
            'startTracking'
        ) {
            await startNativeTracking();
            return;
        }

        if (
            parsedMessage.action ===
            'stopTracking'
        ) {
            await stopNativeTracking();
        }
    };

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (customCodeInstalled) {
        return;
    }

    customCodeInstalled = true;

    if (
        Platform.OS !== 'ios' ||
        !BuddybossCustomCode
    ) {
        return;
    }

    const pageScreenHooksApi =
        externalCodeSetup
            ?.pageScreenHooksApi;

    if (
        !pageScreenHooksApi ||
        typeof pageScreenHooksApi
            .setWebViewProps !==
            'function'
    ) {
        Alert.alert(
            'Skedoggle GPS',
            'BuddyBoss WebView hooks are unavailable.'
        );

        return;
    }

    /*
     IMPORTANT:

     BuddyBoss expects a FUNCTION here, not a plain props object.

     PageScreen calls this function whenever it builds its WebView
     properties.
    */
    pageScreenHooksApi
        .setWebViewProps(
            (existingProps = {}) => {
                const originalOnMessage =
                    existingProps
                        ?.onMessage;

                const originalRef =
                    existingProps
                        ?.ref;

                return {
                    ...existingProps,

                    ref: (webView) => {
                        currentWebView =
                            webView;

                        preserveRef(
                            originalRef,
                            webView
                        );

                        if (webView) {
                            setTimeout(
                                () => {
                                    replayBufferedLocations();
                                },
                                750
                            );
                        }
                    },

                    onMessage: async (
                        event
                    ) => {
                        /*
                         Keep any BuddyBoss message processing intact.
                        */
                        if (
                            typeof originalOnMessage ===
                            'function'
                        ) {
                            try {
                                await originalOnMessage(
                                    event
                                );
                            } catch (error) {
                                /*
                                 Continue to the Skedoggle handler.
                                */
                            }
                        }

                        await handleWebViewMessage(
                            event
                        );
                    },
                };
            }
        );

    const locationEmitter =
        new NativeEventEmitter(
            BuddybossCustomCode
        );

    locationEmitter.addListener(
        'SkedoggleLocation',
        async (locationData) => {
            try {
                await forwardLocationToWebView(
                    locationData
                );
            } catch (error) {
                /*
                 The location stays buffered natively.
                */
            }
        }
    );

    AppState.addEventListener(
        'change',
        (nextAppState) => {
            if (
                nextAppState ===
                'active'
            ) {
                setTimeout(
                    () => {
                        replayBufferedLocations();
                    },
                    750
                );
            }
        }
    );

    setTimeout(
        () => {
            replayBufferedLocations();
        },
        1500
    );
};
