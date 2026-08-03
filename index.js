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

const sendMessageIntoWebView = (payload) => {
    if (
        !currentWebView ||
        typeof currentWebView.injectJavaScript !==
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
         JSON.stringify is used again so the message is safely embedded
         inside the JavaScript injected into the WebView.
        */
        const encodedMessage =
            JSON.stringify(message);

        const script = `
            (function () {
                try {
                    var data = ${encodedMessage};

                    var windowEvent;

                    try {
                        windowEvent = new MessageEvent(
                            'message',
                            {
                                data: data
                            }
                        );
                    } catch (error) {
                        windowEvent =
                            document.createEvent(
                                'MessageEvent'
                            );

                        windowEvent.initMessageEvent(
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

                    window.dispatchEvent(
                        windowEvent
                    );

                    var documentEvent;

                    try {
                        documentEvent =
                            new MessageEvent(
                                'message',
                                {
                                    data: data
                                }
                            );
                    } catch (error) {
                        documentEvent =
                            document.createEvent(
                                'MessageEvent'
                            );

                        documentEvent
                            .initMessageEvent(
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

                    document.dispatchEvent(
                        documentEvent
                    );
                } catch (error) {
                    /* Ignore WebView dispatch errors. */
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
             Do not acknowledge the point.

             It remains in the native buffer until the WebView becomes
             available again.
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
                    /*
                     Stop replaying if the WebView is unavailable.

                     Remaining points stay in native storage.
                    */
                    break;
                }
            }
        } catch (error) {
            /*
             Points remain in native storage and can be retried later.
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
                'The native startBackgroundTracking method is unavailable.'
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
             Try to forward buffered points before stopping.

             Any points that cannot be forwarded remain safely stored
             in the native buffer.
            */
            await replayBufferedLocations();

            await BuddybossCustomCode
                .stopBackgroundTracking();

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

const preserveOriginalRef = (
    originalRef,
    webView
) => {
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
            'BuddyBoss pageScreenHooksApi.setWebViewProps is unavailable.'
        );

        return;
    }

    /*
     BuddyBoss exposes its current WebView properties here.

     Preserve those properties and add our own ref and onMessage
     handlers.
    */
    const existingWebViewProps =
        pageScreenHooksApi
            .webViewProps &&
        typeof pageScreenHooksApi
            .webViewProps ===
            'object'
            ? pageScreenHooksApi
                  .webViewProps
            : {};

    const originalOnMessage =
        existingWebViewProps
            .onMessage;

    const originalRef =
        existingWebViewProps.ref;

    pageScreenHooksApi
        .setWebViewProps({
            ...existingWebViewProps,

            ref: (webView) => {
                currentWebView =
                    webView;

                preserveOriginalRef(
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

            onMessage: async (event) => {
                /*
                 Preserve any BuddyBoss message handler already attached
                 to the WebView.
                */
                if (
                    typeof originalOnMessage ===
                    'function'
                ) {
                    try {
                        originalOnMessage(
                            event
                        );
                    } catch (error) {
                        /*
                         Do not prevent the Skedoggle handler from running.
                        */
                    }
                }

                await handleWebViewMessage(
                    event
                );
            },
        });

    /*
     Receive live native GPS points while React Native is awake.
    */
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
                 The point remains in the native buffer.
                */
            }
        }
    );

    /*
     Replay locations collected while the screen was locked or the app
     was backgrounded.
    */
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

    /*
     Replay any locations left from an interrupted previous session.
    */
    setTimeout(
        () => {
            replayBufferedLocations();
        },
        1500
    );
};
