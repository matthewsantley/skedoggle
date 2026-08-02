import {
    NativeModules,
    Platform,
} from 'react-native';

const { BuddybossCustomCode } = NativeModules;

const describeObject = (
    label,
    value,
    depth = 0
) => {
    try {
        if (value == null) {
            console.log(
                `SKEDOGGLE_DIAG_${label}`,
                value
            );
            return;
        }

        const keys = Object.keys(value);

        console.log(
            `SKEDOGGLE_DIAG_${label}_KEYS`,
            keys
        );

        if (depth >= 2) {
            return;
        }

        keys.forEach((key) => {
            try {
                const child = value[key];

                console.log(
                    `SKEDOGGLE_DIAG_${label}_${key}_TYPE`,
                    typeof child
                );

                if (
                    child &&
                    typeof child === 'object'
                ) {
                    describeObject(
                        `${label}_${key}`,
                        child,
                        depth + 1
                    );
                }
            } catch (error) {
                console.error(
                    `SKEDOGGLE_DIAG_${label}_${key}_ERROR`,
                    error
                );
            }
        });
    } catch (error) {
        console.error(
            `SKEDOGGLE_DIAG_${label}_ERROR`,
            error
        );
    }
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    console.log(
        'SKEDOGGLE_DIAG_APPLY_CUSTOM_CODE_STARTED'
    );

    console.log(
        'SKEDOGGLE_DIAG_PLATFORM',
        Platform.OS
    );

    console.log(
        'SKEDOGGLE_DIAG_NATIVE_MODULE_PRESENT',
        Boolean(BuddybossCustomCode)
    );

    console.log(
        'SKEDOGGLE_DIAG_NATIVE_MODULES_WITH_BUDDY_NAME',
        Object.keys(NativeModules).filter(
            (name) =>
                name
                    .toLowerCase()
                    .includes('buddy')
        )
    );

    if (BuddybossCustomCode) {
        console.log(
            'SKEDOGGLE_DIAG_CUSTOM_MODULE_METHODS',
            Object.keys(BuddybossCustomCode)
        );

        if (
            typeof BuddybossCustomCode
                .getBufferedLocations ===
            'function'
        ) {
            BuddybossCustomCode
                .getBufferedLocations()
                .then((locations) => {
                    console.log(
                        'SKEDOGGLE_DIAG_EXISTING_BUFFER',
                        Array.isArray(locations)
                            ? locations.length
                            : locations
                    );
                })
                .catch((error) => {
                    console.error(
                        'SKEDOGGLE_DIAG_BUFFER_ERROR',
                        error
                    );
                });
        }
    }

    if (!externalCodeSetup) {
        console.error(
            'SKEDOGGLE_DIAG_EXTERNAL_CODE_SETUP_MISSING'
        );
        return;
    }

    describeObject(
        'EXTERNAL_CODE_SETUP',
        externalCodeSetup
    );

    /*
     Specifically inspect any APIs whose names suggest browser,
     WebView, app-page, HTML or messaging support.
    */
    Object.keys(externalCodeSetup)
        .filter((key) => {
            const normalised =
                key.toLowerCase();

            return (
                normalised.includes('web') ||
                normalised.includes('message') ||
                normalised.includes('html') ||
                normalised.includes('page') ||
                normalised.includes('browser')
            );
        })
        .forEach((key) => {
            describeObject(
                `POSSIBLE_WEB_API_${key}`,
                externalCodeSetup[key]
            );
        });

    console.log(
        'SKEDOGGLE_DIAG_APPLY_CUSTOM_CODE_COMPLETE'
    );
};
