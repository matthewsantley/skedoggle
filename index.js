import {
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

const nativeLog = (stage, data = {}) => {
    try {
        if (
            BuddybossCustomCode &&
            typeof BuddybossCustomCode.logDiagnostic ===
                'function'
        ) {
            BuddybossCustomCode.logDiagnostic(
                JSON.stringify({
                    stage,
                    platform: Platform.OS,
                    ...data,
                })
            );
        }
    } catch (error) {
        // We intentionally avoid console.log because it may not
        // appear in the macOS device Console.
    }
};

const inspectApi = (
    name,
    api
) => {
    try {
        if (!api) {
            nativeLog('API_MISSING', {
                name,
            });
            return;
        }

        const keys = Object.keys(api);

        nativeLog('API_KEYS', {
            name,
            keys,
        });

        keys.forEach((key) => {
            let valueType = 'unknown';

            try {
                valueType = typeof api[key];
            } catch (error) {
                valueType = 'error';
            }

            nativeLog('API_PROPERTY', {
                api: name,
                key,
                valueType,
            });
        });
    } catch (error) {
        nativeLog('API_INSPECTION_ERROR', {
            name,
            error: String(error),
        });
    }
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    nativeLog('APPLY_CUSTOM_CODE_STARTED', {
        nativeModulePresent:
            Boolean(BuddybossCustomCode),

        nativeModuleKeys:
            BuddybossCustomCode
                ? Object.keys(
                      BuddybossCustomCode
                  )
                : [],
    });

    if (!BuddybossCustomCode) {
        return;
    }

    if (!externalCodeSetup) {
        nativeLog(
            'EXTERNAL_CODE_SETUP_MISSING'
        );
        return;
    }

    const setupKeys =
        Object.keys(externalCodeSetup);

    nativeLog(
        'EXTERNAL_CODE_SETUP_KEYS',
        {
            keys: setupKeys,
        }
    );

    /*
     Inspect every top-level BuddyBoss API.
    */
    setupKeys.forEach((key) => {
        inspectApi(
            key,
            externalCodeSetup[key]
        );
    });

    /*
     Highlight APIs whose names suggest that they may provide
     WebView or message handling.
    */
    const possibleWebApis =
        setupKeys.filter((key) => {
            const name =
                key.toLowerCase();

            return (
                name.includes('web') ||
                name.includes('message') ||
                name.includes('browser') ||
                name.includes('html') ||
                name.includes('page')
            );
        });

    nativeLog(
        'POSSIBLE_WEB_APIS',
        {
            keys: possibleWebApis,
        }
    );

    nativeLog(
        'APPLY_CUSTOM_CODE_COMPLETE'
    );
};
