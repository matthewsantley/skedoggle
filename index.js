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
    Linking,
    NativeEventEmitter,
    PermissionsAndroid,
    NativeModules,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const {
    BuddybossCustomCode,
} = NativeModules;

const BRIDGE_URL =
    'https://skedoggle.com/wp-json/skedoggle/v1/native-walk-bridge';

const BRIDGE_SECRET =
    'sk-test-7d4b1e9c-83a2-4f61-b909-2f0c9eeb6a41';

let installed = false;


const ANDROID_NOTIFICATION_PERMISSION =
    PermissionsAndroid
        ?.PERMISSIONS
        ?.POST_NOTIFICATIONS ||
    'android.permission.POST_NOTIFICATIONS';

const requestAndroidWalkPermissions =
    async () => {
        if (
            Platform.OS !==
                'android' ||
            Number(
                Platform.Version
            ) < 23
        ) {
            return {
                locationGranted:
                    true,

                fineLocationGranted:
                    true,

                coarseLocationGranted:
                    true,

                notificationsGranted:
                    true,
            };
        }

        const finePermission =
            PermissionsAndroid
                .PERMISSIONS
                .ACCESS_FINE_LOCATION;

        const coarsePermission =
            PermissionsAndroid
                .PERMISSIONS
                .ACCESS_COARSE_LOCATION;

        const locationResults =
            await PermissionsAndroid
                .requestMultiple([
                    finePermission,
                    coarsePermission,
                ]);

        const fineLocationGranted =
            locationResults[
                finePermission
            ] ===
            PermissionsAndroid
                .RESULTS
                .GRANTED;

        const coarseLocationGranted =
            locationResults[
                coarsePermission
            ] ===
            PermissionsAndroid
                .RESULTS
                .GRANTED;

        let notificationsGranted =
            true;

        if (
            Number(
                Platform.Version
            ) >= 33
        ) {
            notificationsGranted =
                await PermissionsAndroid
                    .check(
                        ANDROID_NOTIFICATION_PERMISSION
                    );

            if (
                !notificationsGranted
            ) {
                const result =
                    await PermissionsAndroid
                        .request(
                            ANDROID_NOTIFICATION_PERMISSION
                        );

                notificationsGranted =
                    result ===
                    PermissionsAndroid
                        .RESULTS
                        .GRANTED;
            }
        }

        return {
            locationGranted:
                fineLocationGranted ||
                coarseLocationGranted,

            fineLocationGranted,

            coarseLocationGranted,

            notificationsGranted,
        };
    };

const getPageUrl = (props) => {
    return (
        props?.url ||
        props?.source?.uri ||
        props?.route?.params?.url ||
        props?.route?.params?.uri ||
        props?.route?.params?.item?.link ||
        props?.route?.params?.item?.url ||
        props?.item?.link ||
        props?.item?.url ||
        ''
    );
};

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(
            'skedoggle.com/track-walk'
        )
    );
};

const postToBridge = async (
    payload
) => {
    const response = await fetch(
        BRIDGE_URL,
        {
            method: 'POST',

            headers: {
                Accept:
                    'application/json',

                'Content-Type':
                    'application/json',
            },

            body: JSON.stringify({
                secret:
                    BRIDGE_SECRET,

                ...payload,
            }),
        }
    );

    if (!response.ok) {
        throw new Error(
            `Bridge request failed: ${response.status}`
        );
    }

    return response.json();
};

const fetchCommand = async () => {
    const url =
        BRIDGE_URL +
        '?mode=command' +
        '&secret=' +
        encodeURIComponent(
            BRIDGE_SECRET
        ) +
        '&_=' +
        Date.now();

    const response = await fetch(
        url,
        {
            headers: {
                Accept:
                    'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(
            `Command request failed: ${response.status}`
        );
    }

    return response.json();
};

const normaliseLocation = (
    location
) => {
    let value =
        location;

    if (
        typeof value ===
        'string'
    ) {
        try {
            value =
                JSON.parse(
                    value
                );
        } catch (error) {
            return null;
        }
    }

    const point = {
        type:
            'location',

        lat:
            Number(
                value?.lat ??
                value?.latitude
            ),

        lng:
            Number(
                value?.lng ??
                value?.longitude
            ),

        accuracy:
            Number(
                value?.accuracy ??
                10
            ),

        ts:
            Number(
                value?.ts ??
                value?.timestamp ??
                Date.now()
            ),

        native:
            true,
    };

    if (
        !Number.isFinite(
            point.lat
        ) ||
        !Number.isFinite(
            point.lng
        )
    ) {
        return null;
    }

    return point;
};

const WalkLocationIntroduction = ({
    loading,
    saving,
    onContinue,
}) => {
    return (
        <SafeAreaView
            style={
                styles.introSafeArea
            }
        >
            <ScrollView
                contentContainerStyle={
                    styles.introContent
                }
                showsVerticalScrollIndicator={
                    false
                }
            >
                <View
                    style={
                        styles.introPawCircle
                    }
                >
                    <Text
                        style={
                            styles.introPaw
                        }
                    >
                        🐾
                    </Text>
                </View>

                <Text
                    style={
                        styles.introTitle
                    }
                >
                    Location helps map every step
                </Text>

                <Text
                    style={
                        styles.introLead
                    }
                >
                    Skedoggle uses your location only when you choose to record a dog walk.
                </Text>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        Accurate routes
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        When iOS asks, choose Allow While Using App and make sure Precise Location is on in Location Settings.
                    </Text>
                </View>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        Lock your screen
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        You can lock your phone while your walk is active. Skedoggle continues collecting your route and updates the map when the app becomes active again.
                    </Text>
                </View>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        You stay in control
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        Walk tracking starts only when you press Start and stops when you end your walk.
                    </Text>
                </View>

                {loading ? (
                    <View
                        style={
                            styles.introLoading
                        }
                    >
                        <ActivityIndicator
                            size="large"
                        />
                    </View>
                ) : (
                    <TouchableOpacity
                        activeOpacity={
                            0.85
                        }
                        disabled={
                            saving
                        }
                        onPress={
                            onContinue
                        }
                        style={[
                            styles.introButton,
                            saving &&
                                styles.introButtonDisabled,
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator
                                color="#ffffff"
                            />
                        ) : (
                            <Text
                                style={
                                    styles.introButtonText
                                }
                            >
                                Continue to walk tracking
                            </Text>
                        )}
                    </TouchableOpacity>
                )}

                <Text
                    style={
                        styles.introFooter
                    }
                >
                    You can change location access at any time in your iPhone Settings.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
};

const WalkNativeSidecar = ({
    defaultComponent,
}) => {
    const [walkIntroState, setWalkIntroState] =
        useState(
            Platform.OS === 'ios'
                ? 'checking'
                : 'hidden'
        );

    const lastCommandIdRef =
        useRef('');

    const uploadRunningRef =
        useRef(false);

    const flushRunningRef =
        useRef(false);

    const trackingRef =
        useRef(false);

    const appStateRef =
        useRef(
            AppState.currentState
        );

    useEffect(
        () => {
            let cancelled =
                false;

            const checkWalkIntroduction =
                async () => {
                    if (
                        Platform.OS !==
                        'ios'
                    ) {
                        if (!cancelled) {
                            setWalkIntroState(
                                'hidden'
                            );
                        }

                        return;
                    }

                    if (
                        typeof BuddybossCustomCode
                            ?.hasSeenWalkLocationIntro !==
                        'function'
                    ) {
                        /*
                         Fail open: show the explanation even if the
                         native saved-preference method is unavailable.
                        */
                        if (!cancelled) {
                            setWalkIntroState(
                                'visible'
                            );
                        }

                        return;
                    }

                    try {
                        const result =
                            await BuddybossCustomCode
                                .hasSeenWalkLocationIntro();

                        if (!cancelled) {
                            setWalkIntroState(
                                result?.seen
                                    ? 'hidden'
                                    : 'visible'
                            );
                        }
                    } catch (error) {
                        /*
                         Do not silently skip the location explanation
                         if reading the saved preference fails.
                        */
                        if (!cancelled) {
                            setWalkIntroState(
                                'visible'
                            );
                        }
                    }
                };

            checkWalkIntroduction();

            return () => {
                cancelled =
                    true;
            };
        },
        []
    );

    const continueToWalkTracking =
        useCallback(
            async () => {
                setWalkIntroState(
                    'saving'
                );

                try {
                    if (
                        typeof BuddybossCustomCode
                            ?.markWalkLocationIntroSeen ===
                        'function'
                    ) {
                        await BuddybossCustomCode
                            .markWalkLocationIntroSeen();
                    }
                } catch (error) {
                    /*
                     Do not prevent access to the walk tracker if the
                     preference could not be saved.
                    */
                } finally {
                    setWalkIntroState(
                        'hidden'
                    );
                }
            },
            []
        );

    const acknowledgePoints =
        useCallback(
            async (points) => {
                if (
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocation !==
                        'function'
                ) {
                    return;
                }

                for (const point of points) {
                    if (
                        point?.ts == null
                    ) {
                        continue;
                    }

                    try {
                        await BuddybossCustomCode
                            .acknowledgeLocation(
                                point.ts
                            );
                    } catch (error) {
                        /*
                         Unacknowledged points remain buffered.
                        */
                    }
                }
            },
            []
        );

    const uploadPoints =
        useCallback(
            async (
                rawPoints
            ) => {
                if (
                    uploadRunningRef.current ||
                    !Array.isArray(
                        rawPoints
                    ) ||
                    rawPoints.length === 0
                ) {
                    return false;
                }

                const points =
                    rawPoints
                        .map(
                            normaliseLocation
                        )
                        .filter(Boolean);

                if (
                    points.length === 0
                ) {
                    return false;
                }

                uploadRunningRef.current =
                    true;

                try {
                    await postToBridge({
                        action:
                            'points',

                        points,
                    });

                    await acknowledgePoints(
                        points
                    );

                    return true;
                } catch (error) {
                    return false;
                } finally {
                    uploadRunningRef.current =
                        false;
                }
            },
            [
                acknowledgePoints,
            ]
        );

    const flushBufferedPoints =
        useCallback(
            async () => {
                if (
                    flushRunningRef.current ||
                    typeof BuddybossCustomCode
                        ?.getBufferedLocations !==
                        'function'
                ) {
                    return;
                }

                flushRunningRef.current =
                    true;

                try {
                    const buffered =
                        await BuddybossCustomCode
                            .getBufferedLocations();

                    if (
                        Array.isArray(
                            buffered
                        ) &&
                        buffered.length > 0
                    ) {
                        await uploadPoints(
                            buffered
                        );
                    }
                } catch (error) {
                    /*
                     Native points remain buffered.
                    */
                } finally {
                    flushRunningRef.current =
                        false;
                }
            },
            [
                uploadPoints,
            ]
        );

    const acknowledgeCommand =
        useCallback(
            async (
                commandId
            ) => {
                try {
                    await postToBridge({
                        action:
                            'ack_command',

                        command_id:
                            commandId,
                    });
                } catch (error) {
                    // The next poll may see it again.
                }
            },
            []
        );

    const processCommand =
        useCallback(
            async (
                commandData
            ) => {
                if (
                    Platform.OS ===
                        'ios' &&
                    walkIntroState !==
                        'hidden'
                ) {
                    return;
                }

                const command =
                    commandData
                        ?.command;

                const commandId =
                    String(
                        commandData
                            ?.command_id ||
                        ''
                    );

                if (
                    !command ||
                    !commandId ||
                    commandId ===
                        lastCommandIdRef
                            .current
                ) {
                    return;
                }

                lastCommandIdRef.current =
                    commandId;

                try {
                    if (
                        command ===
                        'start'
                    ) {
                        if (
                            typeof BuddybossCustomCode
                                ?.startBackgroundTracking !==
                                'function'
                        ) {
                            throw new Error(
                                'startBackgroundTracking is unavailable.'
                            );
                        }

                        let androidPermissions =
                            null;

                        if (
                            Platform.OS ===
                            'android'
                        ) {
                            androidPermissions =
                                await requestAndroidWalkPermissions();

                            if (
                                !androidPermissions
                                    .locationGranted
                            ) {
                                trackingRef.current =
                                    false;

                                Alert.alert(
                                    'Location permission needed',
                                    [
                                        'Skedoggle needs location access to record your walk.',
                                        '',
                                        'Tap Open Settings and allow location while using the app. For the best route, enable precise location.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Cancel',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );

                                return;
                            }
                        }

                        const result =
                            await BuddybossCustomCode
                                .startBackgroundTracking();

                        trackingRef.current =
                            true;

                        if (
                            Platform.OS ===
                            'ios'
                        ) {
                            const permissionStatus =
                                Number(
                                    result?.authorizationStatus
                                );

                            /*
                             iOS permission values:
                             3 = Always
                             4 = While Using the App
                            */
                            const locationGranted =
                                permissionStatus === 3 ||
                                permissionStatus === 4;

                            const preciseLocationEnabled =
                                result?.preciseLocationEnabled !==
                                false;

                            if (
                                locationGranted &&
                                preciseLocationEnabled
                            ) {
                                Alert.alert(
                                    'Walk tracking started',
                                    [
                                        'Your location is being recorded.',
                                        '',
                                        'You can lock your phone while your walk is active. Your route will update when Skedoggle becomes active again.'
                                    ].join('\n')
                                );
                            } else if (
                                locationGranted &&
                                !preciseLocationEnabled
                            ) {
                                Alert.alert(
                                    'Precise Location is off',
                                    [
                                        'Skedoggle needs precise location to map your walk accurately.',
                                        '',
                                        'Please make sure Precise Location is on in Skedoggle’s Location Settings.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Continue Anyway',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                async () => {
                                                    trackingRef.current =
                                                        false;

                                                    try {
                                                        if (
                                                            typeof BuddybossCustomCode
                                                                ?.stopBackgroundTracking ===
                                                            'function'
                                                        ) {
                                                            await BuddybossCustomCode
                                                                .stopBackgroundTracking();
                                                        }
                                                    } catch (error) {
                                                        /*
                                                         Open Settings even if stopping fails.
                                                        */
                                                    }

                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            } else {
                                trackingRef.current =
                                    false;

                                Alert.alert(
                                    'Location permission needed',
                                    [
                                        'Skedoggle needs location access to record your walk.',
                                        '',
                                        'Open Settings, select While Using the App, and make sure Precise Location is on.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Cancel',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            }
                        } else if (
                            Platform.OS ===
                            'android'
                        ) {
                            const preciseLocation =
                                Boolean(
                                    result
                                        ?.fineLocationGranted ??
                                    androidPermissions
                                        ?.fineLocationGranted
                                );

                            const notificationsGranted =
                                Boolean(
                                    result
                                        ?.notificationsGranted ??
                                    androidPermissions
                                        ?.notificationsGranted
                                );

                            if (
                                preciseLocation &&
                                notificationsGranted
                            ) {
                                Alert.alert(
                                    'Walk tracking started',
                                    [
                                        'Background tracking is enabled.',
                                        '',
                                        'Keep the Skedoggle walk notification visible while your walk is active. Your route should continue recording when the screen is locked.'
                                    ].join('\n')
                                );
                            } else {
                                const messages = [
                                    'Background tracking has started.'
                                ];

                                if (
                                    !preciseLocation
                                ) {
                                    messages.push(
                                        '',
                                        'Android is using approximate location. For a more accurate route, open Settings and enable precise location for Skedoggle.'
                                    );
                                }

                                if (
                                    !notificationsGranted
                                ) {
                                    messages.push(
                                        '',
                                        'Notifications are disabled. Enable Skedoggle notifications so Android can clearly show that your walk is still being tracked.'
                                    );
                                }

                                Alert.alert(
                                    'Walk tracking started',
                                    messages.join(
                                        '\n'
                                    ),
                                    [
                                        {
                                            text:
                                                'Continue',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            }
                        } else {
                            Alert.alert(
                                'Walk tracking started',
                                'Background tracking is enabled.'
                            );
                        }

                        await flushBufferedPoints();
                    }

                    if (
                        command ===
                        'stop'
                    ) {
                        await flushBufferedPoints();

                        if (
                            typeof BuddybossCustomCode
                                ?.stopBackgroundTracking ===
                                'function'
                        ) {
                            await BuddybossCustomCode
                                .stopBackgroundTracking();
                        }

                        await flushBufferedPoints();

                        trackingRef.current =
                            false;
                    }
                } catch (error) {
                    const errorCode =
                        String(
                            error?.code ||
                            ''
                        );

                    if (
                        errorCode ===
                            'location_permission_denied' ||
                        errorCode ===
                            'location_permission_unavailable'
                    ) {
                        trackingRef.current =
                            false;

                        Alert.alert(
                            'Location permission needed',
                            [
                                'Skedoggle needs location access to record your walk.',
                                '',
                                'Open Settings, select While Using the App, and make sure Precise Location is on.'
                            ].join('\n'),
                            [
                                {
                                    text:
                                        'Cancel',
                                    style:
                                        'cancel'
                                },
                                {
                                    text:
                                        'Open Settings',
                                    onPress:
                                        () => {
                                            Linking
                                                .openSettings();
                                        }
                                }
                            ]
                        );
                    } else {
                        Alert.alert(
                            'Native GPS Error',
                            String(
                                error?.message ??
                                error
                            )
                        );
                    }
                } finally {
                    await acknowledgeCommand(
                        commandId
                    );
                }
            },
            [
                acknowledgeCommand,
                flushBufferedPoints,
                walkIntroState,
            ]
        );

    useEffect(
        () => {
            let cancelled = false;

            const poll = async () => {
                try {
                    const command =
                        await fetchCommand();

                    if (!cancelled) {
                        await processCommand(
                            command
                        );
                    }
                } catch (error) {
                    /*
                     A later poll will retry.
                    */
                }
            };

            poll();

            const timer =
                setInterval(
                    poll,
                    1000
                );

            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        },
        [
            processCommand,
        ]
    );

    useEffect(
        () => {
            const timer =
                setInterval(
                    () => {
                        flushBufferedPoints();
                    },
                    2000
                );

            return () => {
                clearInterval(timer);
            };
        },
        [
            flushBufferedPoints,
        ]
    );

    useEffect(
        () => {
            if (
                (
                    Platform.OS !==
                        'ios' &&
                    Platform.OS !==
                        'android'
                ) ||
                !BuddybossCustomCode
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
                        (
                            location
                        ) => {
                            uploadPoints([
                                location,
                            ]);
                        }
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

            return () => {
                try {
                    subscription
                        ?.remove();
                } catch (error) {
                    // Ignore cleanup error.
                }
            };
        },
        [
            uploadPoints,
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
                        const previous =
                            appStateRef
                                .current;

                        appStateRef.current =
                            nextState;

                        if (
                            nextState ===
                                'active' &&
                            (
                                previous ===
                                    'background' ||
                                previous ===
                                    'inactive'
                            )
                        ) {
                            setTimeout(
                                flushBufferedPoints,
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
            flushBufferedPoints,
        ]
    );

    if (
        Platform.OS ===
            'ios' &&
        walkIntroState !==
            'hidden'
    ) {
        return (
            <WalkLocationIntroduction
                loading={
                    walkIntroState ===
                    'checking'
                }
                saving={
                    walkIntroState ===
                    'saving'
                }
                onContinue={
                    continueToWalkTracking
                }
            />
        );
    }

    return (
        <View
            style={{
                flex: 1,
            }}
        >
            {defaultComponent}
        </View>
    );
};

const styles = StyleSheet.create({
    introSafeArea: {
        flex: 1,
        backgroundColor:
            '#ffffff',
    },

    introContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 36,
        paddingBottom: 28,
        justifyContent:
            'center',
    },

    introPawCircle: {
        width: 78,
        height: 78,
        borderRadius: 39,
        alignItems:
            'center',
        justifyContent:
            'center',
        alignSelf:
            'center',
        backgroundColor:
            '#f8e7f4',
        marginBottom: 22,
    },

    introPaw: {
        fontSize: 38,
    },

    introTitle: {
        color:
            '#261e8c',
        fontSize: 29,
        fontWeight:
            '700',
        lineHeight: 35,
        textAlign:
            'center',
        marginBottom: 14,
    },

    introLead: {
        color:
            '#3f3f46',
        fontSize: 17,
        lineHeight: 25,
        textAlign:
            'center',
        marginBottom: 24,
    },

    introCard: {
        backgroundColor:
            '#f7f7fa',
        borderRadius: 16,
        paddingHorizontal: 18,
        paddingVertical: 16,
        marginBottom: 12,
    },

    introCardTitle: {
        color:
            '#261e8c',
        fontSize: 17,
        fontWeight:
            '700',
        marginBottom: 6,
    },

    introCardText: {
        color:
            '#52525b',
        fontSize: 15,
        lineHeight: 22,
    },

    introLoading: {
        minHeight: 62,
        alignItems:
            'center',
        justifyContent:
            'center',
        marginTop: 14,
    },

    introButton: {
        minHeight: 56,
        borderRadius: 28,
        backgroundColor:
            '#d622a6',
        alignItems:
            'center',
        justifyContent:
            'center',
        paddingHorizontal: 22,
        marginTop: 16,
    },

    introButtonDisabled: {
        opacity: 0.7,
    },

    introButtonText: {
        color:
            '#ffffff',
        fontSize: 17,
        fontWeight:
            '700',
        textAlign:
            'center',
    },

    introFooter: {
        color:
            '#71717a',
        fontSize: 13,
        lineHeight: 19,
        textAlign:
            'center',
        marginTop: 16,
    },
});

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (installed) {
        return;
    }

    installed = true;

    const pageApi =
        externalCodeSetup
            ?.pageScreenHooksApi;

    if (
        !pageApi ||
        typeof pageApi
            .setPageComponent !==
            'function'
    ) {
        return;
    }

    pageApi.setPageComponent(
        (
            props,
            Component
        ) => {
            const pageUrl =
                getPageUrl(props);

            if (
                !isWalkTrackerUrl(
                    pageUrl
                )
            ) {
                return Component;
            }

            return React.createElement(
                WalkNativeSidecar,
                {
                    defaultComponent:
                        Component,
                }
            );
        }
    );
};
