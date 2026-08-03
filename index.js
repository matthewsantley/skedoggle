import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

export const applyCustomCode = (
    externalCodeSetup
) => {
    const showDiagnostics = () => {
        const setupKeys = externalCodeSetup
            ? Object.keys(externalCodeSetup)
            : [];

        const nativeKeys = BuddybossCustomCode
            ? Object.keys(BuddybossCustomCode)
            : [];

        const possibleWebApis =
            setupKeys.filter((key) => {
                const name =
                    String(key).toLowerCase();

                return (
                    name.includes('web') ||
                    name.includes('message') ||
                    name.includes('browser') ||
                    name.includes('html') ||
                    name.includes('page')
                );
            });

        const message = [
            `Platform: ${Platform.OS}`,
            '',
            `Native module present: ${
                BuddybossCustomCode
                    ? 'YES'
                    : 'NO'
            }`,
            '',
            'externalCodeSetup keys:',
            setupKeys.length
                ? setupKeys.join(', ')
                : '(none)',
            '',
            'Possible WebView APIs:',
            possibleWebApis.length
                ? possibleWebApis.join(', ')
                : '(none)',
            '',
            'Native module methods:',
            nativeKeys.length
                ? nativeKeys.join(', ')
                : '(none)',
        ].join('\n');

        Alert.alert(
            'Skedoggle Diagnostics',
            message,
            [
                {
                    text: 'OK',
                },
            ]
        );
    };

    if (
        externalCodeSetup &&
        externalCodeSetup.indexJsApi &&
        typeof externalCodeSetup
            .indexJsApi
            .addIndexJsFunction ===
            'function'
    ) {
        externalCodeSetup
            .indexJsApi
            .addIndexJsFunction(
                () => {
                    setTimeout(
                        showDiagnostics,
                        3000
                    );
                }
            );

        return;
    }

    /*
     Fallback in case applyCustomCode runs but indexJsApi is missing.
    */
    setTimeout(
        () => {
            Alert.alert(
                'Skedoggle Diagnostics',
                [
                    'applyCustomCode ran, but',
                    'indexJsApi.addIndexJsFunction',
                    'was not available.',
                    '',
                    'Available APIs:',
                    externalCodeSetup
                        ? Object.keys(
                              externalCodeSetup
                          ).join(', ')
                        : '(externalCodeSetup missing)',
                ].join('\n')
            );
        },
        3000
    );
};
