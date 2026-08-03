import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;

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
            ?.setOnShouldStartLoadWithRequest !==
        'function'
    ) {
        Alert.alert(
            'Skedoggle GPS',
            'The BuddyBoss navigation hook is unavailable.'
        );

        return;
    }

    pageApi
        .setOnShouldStartLoadWithRequest(
            (props) => {
                const requestedUrl =
                    props?.req?.url || '';

                if (
                    requestedUrl ===
                    'skedoggle://start-tracking' ||
                    requestedUrl.startsWith(
                        'skedoggle://start-tracking/'
                    )
                ) {
                    BuddybossCustomCode
                        .startBackgroundTracking()
                        .then((result) => {
                            Alert.alert(
                                'Native GPS Started',
                                [
                                    'The website command reached the native app.',
                                    '',
                                    `Permission status: ${
                                        result
                                            ?.authorizationStatus ??
                                        'unknown'
                                    }`,
                                ].join('\n')
                            );
                        })
                        .catch((error) => {
                            Alert.alert(
                                'Native GPS Error',
                                String(
                                    error
                                        ?.message ??
                                    error
                                )
                            );
                        });

                    /*
                     Cancel navigation so the walk-tracker page remains open.
                    */
                    return false;
                }

                if (
                    requestedUrl ===
                    'skedoggle://stop-tracking' ||
                    requestedUrl.startsWith(
                        'skedoggle://stop-tracking/'
                    )
                ) {
                    BuddybossCustomCode
                        .stopBackgroundTracking()
                        .then(() => {
                            Alert.alert(
                                'Native GPS Stopped',
                                'The native tracker was stopped.'
                            );
                        })
                        .catch((error) => {
                            Alert.alert(
                                'Native GPS Error',
                                String(
                                    error
                                        ?.message ??
                                    error
                                )
                            );
                        });

                    return false;
                }

                /*
                 Allow every normal website request.
                */
                return true;
            }
        );

    Alert.alert(
        'Skedoggle GPS',
        'Native URL bridge installed.'
    );
};
