import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

let installed = false;

const parseMessage = (event) => {
    try {
        const raw =
            event?.nativeEvent?.data ??
            event?.data ??
            event;

        return typeof raw === 'string'
            ? JSON.parse(raw)
            : raw;
    } catch (error) {
        return null;
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

    pageApi.setWebViewProps(
        (existingProps = {}) => {
            const originalOnMessage =
                existingProps.onMessage;

            return {
                ...existingProps,

                onMessage: async (
                    event
                ) => {
                    if (
                        typeof originalOnMessage ===
                        'function'
                    ) {
                        try {
                            await originalOnMessage(
                                event
                            );
                        } catch (error) {
                            // Continue to our own handler.
                        }
                    }

                    const message =
                        parseMessage(event);

                    Alert.alert(
                        'WebView Message Received',
                        JSON.stringify(
                            message ?? {
                                raw:
                                    event
                                        ?.nativeEvent
                                        ?.data ??
                                    '(none)',
                            },
                            null,
                            2
                        )
                    );

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
                                `Permission status: ${
                                    result
                                        ?.authorizationStatus ??
                                    'unknown'
                                }`
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
                },
            };
        }
    );

    Alert.alert(
        'Skedoggle Bridge Test',
        'WebView message handler installed.'
    );
};
