import {
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } =
    NativeModules;

const safeKeys = (value) => {
    try {
        if (
            value === null ||
            value === undefined
        ) {
            return [];
        }

        return Object.keys(value);
    } catch (error) {
        return [
            `KEY_ERROR:${String(error)}`,
        ];
    }
};

const nativeLog = (
    stage,
    details = {}
) => {
    try {
        if (
            !BuddybossCustomCode ||
            typeof BuddybossCustomCode
                .logDiagnostic !==
                'function'
        ) {
            return;
        }

        const message =
            JSON.stringify({
                stage,
                platform: Platform.OS,
                timestamp:
                    new Date().toISOString(),
                ...details,
            });

        BuddybossCustomCode
            .logDiagnostic(message);
    } catch (error) {
        /*
         There is deliberately no console logging here.
         All useful output is written to the native text file.
        */
    }
};

const inspectApi = (
    apiName,
    apiValue
) => {
    try {
        if (
            apiValue === null ||
            apiValue === undefined
        ) {
            nativeLog(
                'API_MISSING',
                {
                    apiName,
                }
            );

            return;
        }

        const keys =
            safeKeys(apiValue);

        nativeLog(
            'API_KEYS',
            {
                apiName,
                keys,
            }
        );

        keys.forEach((key) => {
            let valueType =
                'unknown';

            try {
                valueType =
                    typeof apiValue[key];
            } catch (error) {
                valueType =
                    `ERROR:${String(error)}`;
            }

            nativeLog(
                'API_PROPERTY',
                {
                    apiName,
                    key,
                    valueType,
                }
            );
        });
    } catch (error) {
        nativeLog(
            'API_INSPECTION_ERROR',
            {
                apiName,
                error:
                    String(error),
            }
        );
    }
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    nativeLog(
        'APPLY_CUSTOM_CODE_STARTED',
        {
            nativeModulePresent:
                Boolean(
                    BuddybossCustomCode
                ),

            nativeModuleKeys:
                safeKeys(
                    BuddybossCustomCode
                ),
        }
    );

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
        safeKeys(
            externalCodeSetup
        );

    nativeLog(
        'EXTERNAL_CODE_SETUP_KEYS',
        {
            keys: setupKeys,
        }
    );

    setupKeys.forEach((key) => {
        inspectApi(
            key,
            externalCodeSetup[key]
        );
    });

    const possibleWebApis =
        setupKeys.filter((key) => {
            const normalised =
                String(key)
                    .toLowerCase();

            return (
                normalised.includes(
                    'web'
                ) ||
                normalised.includes(
                    'message'
                ) ||
                normalised.includes(
                    'browser'
                ) ||
                normalised.includes(
                    'html'
                ) ||
                normalised.includes(
                    'page'
                )
            );
        });

    nativeLog(
        'POSSIBLE_WEB_APIS',
        {
            keys:
                possibleWebApis,
        }
    );

    nativeLog(
        'APPLY_CUSTOM_CODE_COMPLETE'
    );
};
