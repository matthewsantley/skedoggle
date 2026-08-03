import React, {
    useCallback,
    useEffect,
    useRef,
} from 'react';

import {
    Alert,
    AppState,
    NativeEventEmitter,
    NativeModules,
    Platform,
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
    const point = {
        type:
            'location',

        lat:
            Number(
                location?.lat ??
                location?.latitude
            ),

        lng:
            Number(
                location?.lng ??
                location?.longitude
            ),

        accuracy:
            Number(
                location?.accuracy ??
                10
            ),

        ts:
            Number(
                location?.ts ??
                location?.timestamp ??
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

const WalkNativeSidecar = ({
    defaultComponent,
}) => {
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

                        const result =
                            await BuddybossCustomCode
                                .startBackgroundTracking();

                        trackingRef.current =
                            true;

                        Alert.alert(
                            'Native GPS Started',
                            [
                                'The WordPress walk tracker reached the native module.',
                                '',
                                `Permission status: ${
                                    result
                                        ?.authorizationStatus ??
                                    'unknown'
                                }`,
                            ].join(
                                '\n'
                            )
                        );

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
                    Alert.alert(
                        'Native GPS Error',
                        String(
                            error?.message ??
                            error
                        )
                    );
                } finally {
                    await acknowledgeCommand(
                        commandId
                    );
                }
            },
            [
                acknowledgeCommand,
                flushBufferedPoints,
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
                Platform.OS !==
                    'ios' ||
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
