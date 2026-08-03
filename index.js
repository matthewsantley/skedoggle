import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(
            'skedoggle.com/track-walk'
        )
    );
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
            'Skedoggle Bridge Test',
            'Native module unavailable.'
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
            'Skedoggle Bridge Test',
            'setWebViewProps is unavailable.'
        );

        return;
    }

    /*
     BuddyBoss passes page information here:

     {
         url,
         index,
         online,
         screenProps,
         source
     }

     It does NOT pass the existing WebView props.
    */
    pageApi.setWebViewProps(
        (pageInfo = {}) => {
            const url =
                pageInfo.url ||
                pageInfo.source?.uri ||
                '';

            if (!isWalkTrackerUrl(url)) {
                /*
                 Do not alter any other BuddyBoss page.
                */
                return {};
            }

            return {
                /*
                 This runs inside the walk tracker WebView after the
                 page has loaded.

                 It proves these props were applied to the correct
                 WebView.
                */
                injectedJavaScript: `
                    (function () {
                        setTimeout(function () {
                            alert(
                                'Native bridge attached to walk tracker'
                            );
                        }, 1000);
                    })();

                    true;
                `,

                onMessage: async (
                    event
                ) => {
                    const raw =
                        event?.nativeEvent
                            ?.data ??
                        '(no message data)';

                    Alert.alert(
                        'WebView Message Received',
                        String(raw)
                    );

                    let message = null;

                    try {
                        message =
                            typeof raw ===
                                'string'
                                ? JSON.parse(raw)
                                : raw;
                    } catch (error) {
                        /*
                         The direct diagnostic message is plain text,
                         so parsing failure is expected.
                        */
                    }

                    if (
                        message?.action ===
                        'startTracking'
                    ) {
                        try {
                            const result =
                                await BuddybossCustomCode
                                    .startBackgroundTracking();

                            Alert.alert(
                                'Native GPS Started',
                                [
                                    'The walk tracker reached the native module.',
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
                                    error
                                        ?.message ??
                                    error
                                )
                            );
                        }
                    }
                },
            };
        }
    );

    Alert.alert(
        'Skedoggle Bridge Test',
        [
            'Corrected PageScreen hook installed.',
            '',
            'Open the walk tracker.',
        ].join('\n')
    );
};
