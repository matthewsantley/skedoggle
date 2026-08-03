import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;
let lastCommandUrl = '';

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(
            'skedoggle.com/track-walk'
        )
    );
};

const processCommandUrl = async (url) => {
    if (
        !url ||
        url === lastCommandUrl
    ) {
        return;
    }

    if (
        !url.includes(
            '#skedoggle-native-'
        )
    ) {
        return;
    }

    lastCommandUrl = url;

    if (
        url.includes(
            '#skedoggle-native-start-'
        )
    ) {
        try {
            const result =
                await BuddybossCustomCode
                    .startBackgroundTracking();

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
        } catch (error) {
            Alert.alert(
                'Native GPS Error',
                String(
                    error?.message ??
                    error
                )
            );
        }

        return;
    }

    if (
        url.includes(
            '#skedoggle-native-stop-'
        )
    ) {
        try {
            await BuddybossCustomCode
                .stopBackgroundTracking();

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
    }
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (installed) {
        return;
    }

    installed = true;

    if (
        Platform.OS !== 'ios' ||
        !BuddybossCustomCode
    ) {
        Alert.alert(
            'Skedoggle GPS',
            'The native GPS module is unavailable.'
        );

        return;
    }

    const pageApi =
        externalCodeSetup
            ?.pageScreenHooksApi;

    if (
        typeof pageApi
            ?.setWebViewProps !==
        'function'
    ) {
        Alert.alert(
            'Skedoggle GPS',
            'BuddyBoss WebView properties are unavailable.'
        );

        return;
    }

    pageApi.setWebViewProps(
        (pageInfo = {}) => {
            const url =
                pageInfo.url ||
                pageInfo.source?.uri ||
                '';

            if (!isWalkTrackerUrl(url)) {
                return {};
            }

            return {
                injectedJavaScript: `
                    (function () {
                        if (
                            window
                                .__skedoggleNativeBridgeInstalled
                        ) {
                            return;
                        }

                        window
                            .__skedoggleNativeBridgeInstalled =
                            true;

                        var originalPostMessage =
                            window.ReactNativeWebView &&
                            window.ReactNativeWebView
                                .postMessage
                                ? window
                                      .ReactNativeWebView
                                      .postMessage
                                      .bind(
                                          window
                                              .ReactNativeWebView
                                      )
                                : null;

                        function sendCommandByUrl(
                            command
                        ) {
                            window.location.hash =
                                'skedoggle-native-' +
                                command +
                                '-' +
                                Date.now();
                        }

                        if (
                            window.ReactNativeWebView
                        ) {
                            window
                                .ReactNativeWebView
                                .postMessage =
                                function(message) {
                                    try {
                                        var parsed =
                                            typeof message ===
                                                'string'
                                                ? JSON.parse(
                                                      message
                                                  )
                                                : message;

                                        if (
                                            parsed &&
                                            parsed.action ===
                                                'startTracking'
                                        ) {
                                            sendCommandByUrl(
                                                'start'
                                            );
                                        }

                                        if (
                                            parsed &&
                                            parsed.action ===
                                                'stopTracking'
                                        ) {
                                            sendCommandByUrl(
                                                'stop'
                                            );
                                        }
                                    } catch (error) {
                                        /*
                                         Plain diagnostic messages can
                                         safely be ignored here.
                                        */
                                    }

                                    if (
                                        originalPostMessage
                                    ) {
                                        try {
                                            originalPostMessage(
                                                message
                                            );
                                        } catch (error) {
                                        }
                                    }
                                };
                        }

                        setTimeout(function () {
                            alert(
                                'Walk tracker native command bridge attached'
                            );
                        }, 750);
                    })();

                    true;
                `,

                onNavigationStateChange: (
                    navigationState
                ) => {
                    const currentUrl =
                        navigationState?.url ||
                        '';

                    processCommandUrl(
                        currentUrl
                    );
                },
            };
        }
    );

    Alert.alert(
        'Skedoggle GPS',
        'Navigation command bridge installed.'
    );
};
