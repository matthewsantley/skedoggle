import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

const getKeys = (value) => {
    try {
        return value
            ? Object.keys(value)
            : [];
    } catch (error) {
        return [
            `ERROR: ${String(error)}`,
        ];
    }
};

const getMethodStatus = () => {
    const names = [
        'logDiagnostic',
        'startBackgroundTracking',
        'stopBackgroundTracking',
        'getBufferedLocations',
        'acknowledgeLocation',
        'clearBufferedLocations',
        'getDebugLog',
        'clearDebugLog',
        'multiply',
    ];

    return names.map((name) => {
        const available =
            BuddybossCustomCode &&
            typeof BuddybossCustomCode[name] ===
                'function';

        return `${name}: ${
            available ? 'YES' : 'NO'
        }`;
    });
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    const showDiagnostics = () => {
        const apiNames = [
            'indexJsApi',
            'screenHooksApi',
            'appPagesHooksApi',
            'pageScreenHooksApi',
            'navigationApi',
            'modalApi',
        ];

        const sections = [
            `Platform: ${Platform.OS}`,
            '',
            `Native module present: ${
                BuddybossCustomCode
                    ? 'YES'
                    : 'NO'
            }`,
            '',
            'Native method availability:',
            ...getMethodStatus(),
        ];

        apiNames.forEach((apiName) => {
            const api =
                externalCodeSetup?.[apiName];

            sections.push(
                '',
                `${apiName} methods:`,
                getKeys(api).length
                    ? getKeys(api).join(', ')
                    : '(none)'
            );
        });

        Alert.alert(
            'Skedoggle API Details',
            sections.join('\n'),
            [
                {
                    text: 'OK',
                },
            ]
        );
    };

    const addIndexJsFunction =
        externalCodeSetup
            ?.indexJsApi
            ?.addIndexJsFunction;

    if (
        typeof addIndexJsFunction ===
        'function'
    ) {
        addIndexJsFunction(() => {
            setTimeout(
                showDiagnostics,
                3000
            );
        });

        return;
    }

    setTimeout(
        showDiagnostics,
        3000
    );
};
