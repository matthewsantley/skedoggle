import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import {
    ActivityIndicator,
    Alert,
    AppState,
    NativeEventEmitter,
    NativeModules,
    Platform,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import {
    WebView,
} from 'react-native-webview';

const {
    BuddybossCustomCode,
} = NativeModules;

const TRACKER_PATH =
    'skedoggle.com/track-walk';

const DEFAULT_URL =
    'https://skedoggle.com/track-walk/';

const getPageUrl = (props) => {
    const candidates = [
        props?.url,
        props?.source?.uri,
        props?.route?.params?.url,
        props?.route?.params?.uri,
        props?.route?.params?.item?.link,
        props?.route?.params?.item?.url,
        props?.item?.link,
        props?.item?.url,
    ];

    for (const candidate of candidates) {
        if (
            typeof candidate ===
                'string' &&
            candidate.length > 0
        ) {
            return candidate;
        }
    }

    return DEFAULT_URL;
};

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(TRACKER_PATH)
    );
};

const parseWebsiteMessage = (
    event
) => {
    try {
        const raw =
            event?.nativeEvent?.data;

        if (
            typeof raw !== 'string'
        ) {
            return raw;
        }

        try {
            return JSON.parse(raw);
        } catch (error) {
            /*
             Messages such as SKEDOGGLE_DIRECT_TEST are plain text.
            */
            return raw;
        }
    } catch (error) {
        return null;
    }
};

const buildLocationScript = (
    location
) => {
    const message =
        JSON.stringify(location);

    const encodedMessage =
        JSON.stringify(message);

    return `
        (function () {
            try {
                var messageData =
                    ${encodedMessage};

                function dispatchTo(
                    target
                ) {
                    var messageEvent;

                    try {
                        messageEvent =
                            new MessageEvent(
                                'message',
                                {
                                    data:
                                        messageData
                                }
                            );
                    } catch (error) {
                        messageEvent =
                            document
                                .createEvent(
                                    'MessageEvent'
                                );

                        messageEvent
                            .initMessageEvent(
                                'message',
                                true,
                                true,
                                messageData,
                                '',
                                '',
                                window,
                                null
                            );
                    }

                    target.dispatchEvent(
                        messageEvent
                    );
                }

                dispatchTo(window);
                dispatchTo(document);
            } catch (error) {
                console.warn(
                    'Skedoggle native location dispatch failed',
                    error
                );
            }
        })();

        true;
    `;
};

const SkedogglePageComponent = (
    props
) => {
    const webViewRef =
        useRef(null);

    const appStateRef =
        useRef(
            AppState.currentState
        );

    const replayingRef =
        useRef(false);

    const trackingRef =
        useRef(false);

    const [loading, setLoading] =
        useState(true);

    const [pageError, setPageError] =
        useState('');

    const pageUrl =
        getPageUrl(props);

    const isTracker =
        isWalkTrackerUrl(pageUrl);

    const acknowledgeLocation =
        useCallback(
            async (location) => {
                if (
                    location?.ts == null ||
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocation !==
                        'function'
                ) {
                    return;
                }

                try {
                    await BuddybossCustomCode
                        .acknowledgeLocation(
                            location.ts
                        );
                } catch (error) {
                    /*
                     Leave the point buffered if acknowledgement fails.
                    */
                }
            },
            []
        );

    const sendLocationToWebsite =
        useCallback(
            async (location) => {
                if (
                    !location ||
                    !webViewRef.current ||
                    typeof webViewRef
                        .current
                        .injectJavaScript !==
                        'function'
                ) {
                    return false;
                }

                try {
                    const payload = {
                        type:
                            'location',

                        lat:
                            Number(
                                location.lat ??
                                location.latitude
                            ),

                        lng:
                            Number(
                                location.lng ??
                                location.longitude
                            ),

                        accuracy:
                            Number(
                                location.accuracy ??
                                10
                            ),

                        ts:
                            Number(
                                location.ts ??
                                location.timestamp ??
                                Date.now()
                            ),

                        native:
                            true,
                    };

                    if (
                        !Number.isFinite(
                            payload.lat
                        ) ||
                        !Number.isFinite(
                            payload.lng
                        )
                    ) {
                        return false;
                    }

                    webViewRef.current
                        .injectJavaScript(
                            buildLocationScript(
                                payload
                            )
                        );

                    await acknowledgeLocation(
                        payload
                    );

                    return true;
                } catch (error) {
                    return false;
                }
            },
            [
                acknowledgeLocation,
            ]
        );

    const replayBufferedLocations =
        useCallback(
            async () => {
                if (
                    replayingRef.current ||
                    !isTracker ||
                    typeof BuddybossCustomCode
                        ?.getBufferedLocations !==
                        'function'
                ) {
                    return;
                }

                replayingRef.current =
                    true;

                try {
                    const buffered =
                        await BuddybossCustomCode
                            .getBufferedLocations();

                    if (
                        !Array.isArray(
                            buffered
                        ) ||
                        buffered.length === 0
                    ) {
                        return;
                    }

                    const ordered = [
                        ...buffered,
                    ].sort(
                        (
                            first,
                            second
                        ) =>
                            Number(
                                first?.ts ??
                                first?.timestamp ??
                                0
                            ) -
                            Number(
                                second?.ts ??
                                second?.timestamp ??
                                0
                            )
                    );

                    for (
                        const location
                        of ordered
                    ) {
                        const sent =
                            await sendLocationToWebsite(
                                location
                            );

                        if (!sent) {
                            break;
                        }
                    }
                } catch (error) {
                    /*
                     Unacknowledged points stay in the native buffer.
                    */
                } finally {
                    replayingRef.current =
                        false;
                }
            },
            [
                isTracker,
                sendLocationToWebsite,
            ]
        );

    const startNativeTracking =
        useCallback(
            async () => {
                if (!isTracker) {
                    return;
                }

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

                    trackingRef.current =
                        true;

                    Alert.alert(
                        'Native GPS Started',
                        [
                            'The walk tracker reached the native GPS module.',
                            '',
                            `Permission status: ${
                                result
                                    ?.authorizationStatus ??
                                'unknown'
                            }`,
                        ].join('\n')
                    );

                    await replayBufferedLocations();
                } catch (error) {
                    Alert.alert(
                        'Native GPS Error',
                        String(
                            error?.message ??
                            error
                        )
                    );
                }
            },
            [
                isTracker,
                replayBufferedLocations,
            ]
        );

    const stopNativeTracking =
        useCallback(
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
                     Replay before stopping while the website is still
                     expecting native location points.
                    */
                    await replayBufferedLocations();

                    await BuddybossCustomCode
                        .stopBackgroundTracking();

                    /*
                     Catch a final point delivered during shutdown.
                    */
                    await replayBufferedLocations();

                    trackingRef.current =
                        false;

                    Alert.alert(
                        'Native GPS Stopped',
                        'The native background tracker was stopped.'
                    );
                } catch (error) {
                    Alert.alert(
                        'Native GPS Error',
                        String(
                            error?.message ??
                            error
                        )
                    );
                }
            },
            [
                replayBufferedLocations,
            ]
        );

    const handleWebsiteMessage =
        useCallback(
            async (event) => {
                if (!isTracker) {
                    return;
                }

                const message =
                    parseWebsiteMessage(
                        event
                    );

                /*
                 The temporary direct diagnostic message proves that
                 this real WebView onMessage handler works.
                */
                if (
                    message ===
                    'SKEDOGGLE_DIRECT_TEST'
                ) {
                    Alert.alert(
                        'Direct WebView Test',
                        'The replacement WebView received the website message.'
                    );

                    return;
                }

                if (
                    !message ||
                    typeof message !==
                        'object'
                ) {
                    return;
                }

                if (
                    message.action ===
                    'startTracking'
                ) {
                    await startNativeTracking();
                    return;
                }

                if (
                    message.action ===
                    'stopTracking'
                ) {
                    await stopNativeTracking();
                }
            },
            [
                isTracker,
                startNativeTracking,
                stopNativeTracking,
            ]
        );

    useEffect(
        () => {
            if (
                Platform.OS !== 'ios' ||
                !BuddybossCustomCode ||
                !isTracker
            ) {
                return undefined;
            }

            let subscription = null;

            try {
                const emitter =
                    new NativeEventEmitter(
                        BuddybossCustomCode
                    );

                subscription =
                    emitter.addListener(
                        'SkedoggleLocation',
                        async (
                            location
                        ) => {
                            await sendLocationToWebsite(
                                location
                            );
                        }
                    );
            } catch (error) {
                Alert.alert(
                    'Skedoggle GPS',
                    `Could not attach the native GPS listener: ${
                        error?.message ??
                        error
                    }`
                );
            }

            return () => {
                try {
                    subscription?.remove();
                } catch (error) {
                    // Ignore cleanup errors.
                }
            };
        },
        [
            isTracker,
            sendLocationToWebsite,
        ]
    );

    useEffect(
        () => {
            const subscription =
                AppState.addEventListener(
                    'change',
                    (
                        nextState
                    ) => {
                        const previousState =
                            appStateRef.current;

                        appStateRef.current =
                            nextState;

                        const returned =
                            nextState ===
                                'active' &&
                            (
                                previousState ===
                                    'inactive' ||
                                previousState ===
                                    'background'
                            );

                        if (
                            returned &&
                            isTracker
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

            return () => {
                subscription.remove();
            };
        },
        [
            isTracker,
            replayBufferedLocations,
        ]
    );

    const handleLoadEnd =
        useCallback(
            () => {
                setLoading(false);

                if (isTracker) {
                    setTimeout(
                        () => {
                            replayBufferedLocations();
                        },
                        750
                    );
                }
            },
            [
                isTracker,
                replayBufferedLocations,
            ]
        );

    const source =
        props?.source &&
        typeof props.source ===
            'object'
            ? props.source
            : {
                  uri: pageUrl,
              };

    const inheritedWebViewProps =
        props?.webViewProps &&
        typeof props.webViewProps ===
            'object'
            ? props.webViewProps
            : {};

    return (
        <View style={styles.container}>
            <WebView
                {...inheritedWebViewProps}

                ref={webViewRef}

                source={source}

                sharedCookiesEnabled={
                    true
                }

                thirdPartyCookiesEnabled={
                    true
                }

                javaScriptEnabled={
                    true
                }

                domStorageEnabled={
                    true
                }

                geolocationEnabled={
                    true
                }

                allowsInlineMediaPlayback={
                    true
                }

                mediaPlaybackRequiresUserAction={
                    false
                }

                startInLoadingState={
                    false
                }

                onMessage={
                    handleWebsiteMessage
                }

                onLoadStart={() => {
                    setLoading(true);
                    setPageError('');
                }}

                onLoadEnd={
                    handleLoadEnd
                }

                onNavigationStateChange={
                    props
                        ?.onNavigationStateChange
                }

                onShouldStartLoadWithRequest={
                    props
                        ?.onShouldStartLoadWithRequest
                }

                onError={(event) => {
                    const description =
                        event
                            ?.nativeEvent
                            ?.description ||
                        'The page could not be loaded.';

                    setPageError(
                        description
                    );

                    setLoading(false);
                }}
            />

            {loading && (
                <View
                    pointerEvents="none"
                    style={
                        styles.loadingOverlay
                    }
                >
                    <ActivityIndicator
                        size="large"
                    />

                    <Text
                        style={
                            styles.loadingText
                        }
                    >
                        Loading…
                    </Text>
                </View>
            )}

            {!!pageError && (
                <View
                    style={
                        styles.errorOverlay
                    }
                >
                    <Text
                        style={
                            styles.errorTitle
                        }
                    >
                        Page loading error
                    </Text>

                    <Text
                        style={
                            styles.errorText
                        }
                    >
                        {pageError}
                    </Text>
                </View>
            )}
        </View>
    );
};

const styles =
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor:
                '#ffffff',
        },

        loadingOverlay: {
            ...StyleSheet.absoluteFillObject,
            alignItems:
                'center',
            justifyContent:
                'center',
            backgroundColor:
                '#ffffff',
        },

        loadingText: {
            marginTop: 12,
            fontSize: 15,
        },

        errorOverlay: {
            ...StyleSheet.absoluteFillObject,
            alignItems:
                'center',
            justifyContent:
                'center',
            padding: 24,
            backgroundColor:
                '#ffffff',
        },

        errorTitle: {
            marginBottom: 10,
            fontSize: 18,
            fontWeight:
                '700',
        },

        errorText: {
            textAlign:
                'center',
            fontSize: 14,
        },
    });

export default SkedogglePageComponent;
