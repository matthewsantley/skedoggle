import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;
let commandRunning = false;
let lastCommandUrl = '';

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(
            'skedoggle.com/track-walk'
        )
    );
};

const handleCommandUrl = async (url) => {
    if (
        typeof url !== 'string' ||
        !url.includes(
            '#skedoggle-native-'
        )
    ) {
        return;
    }

    if (
        url === lastCommandUrl ||
        commandRunning
    ) {
        return;
    }

    lastCommandUrl = url;
    commandRunning = true;

    try {
        if (
            url.includes(
                '#skedoggle-native-start-'
            )
        ) {
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

            return;
        }

        if (
            url.includes(
                '#skedoggle-native-stop-'
            )
        ) {
            await BuddybossCustomCode
                .stopBackgroundTracking();

            Alert.alert(
                'Native GPS Stopped',
                'The native tracker was stopped.'
            );
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
        commandRunning = false;
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
            'function' ||
        typeof pageApi
            ?.setOnNavigationStateChange !==
            'function'
    ) {
        Alert.alert(
            'Skedoggle GPS',
            'The required BuddyBoss PageScreen hooks are unavailable.'
        );

        return;
    }

    /*
     Inject the website-side bridge into the confirmed
     /track-walk/ PageScreen WebView.
    */
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
                            window.__skedoggleNativeBridgeInstalled
                        ) {
                            return;
                        }

                        window.__skedoggleNativeBridgeInstalled =
                            true;

                        var originalPostMessage =
                            window.ReactNativeWebView &&
                            typeof window
                                .ReactNativeWebView
                                .postMessage ===
                                'function'
                                ? window
                                      .ReactNativeWebView
                                      .postMessage
                                      .bind(
                                          window
                                              .ReactNativeWebView
                                      )
                                : null;

                        function sendNativeCommand(
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
                            window.ReactNativeWebView
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
                                            sendNativeCommand(
                                                'start'
                                            );
                                        }

                                        if (
                                            parsed &&
                                            parsed.action ===
                                                'stopTracking'
                                        ) {
                                            sendNativeCommand(
                                                'stop'
                                            );
                                        }
                                    } catch (error) {
                                        /*
                                         Plain diagnostic messages are
                                         deliberately ignored.
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
            };
        }
    );

    /*
     This is BuddyBoss's dedicated PageScreen navigation callback.
     Do not place this inside setWebViewProps.
    */
    pageApi.setOnNavigationStateChange(
        (navigationState = {}) => {
            const url =
                navigationState.url ||
                '';

            if (
                isWalkTrackerUrl(url)
            ) {
                handleCommandUrl(url);
            }
        }
    );

    Alert.alert(
        'Skedoggle GPS',
        'Corrected navigation bridge installed.'
    );
};
