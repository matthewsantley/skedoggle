import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;

const parseMessage = (event) => {
    try {
        const raw =
            event?.nativeEvent?.data ??
            event?.data ??
            event;

        return typeof raw === 'string'
            ? raw
            : JSON.stringify(raw);
    } catch (error) {
        return 'Could not read message';
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
                            // Continue with test.
                        }
                    }

                    Alert.alert(
                        'WebView Message Received',
                        parseMessage(event)
                    );
                },
            };
        }
    );

    Alert.alert(
        'Skedoggle Bridge Test',
        'WebView message handler installed.'
    );
};
