import React from 'react';

import {
    Alert,
    Platform,
} from 'react-native';

let installed = false;
let shown = false;

const safeStringify = (value) => {
    try {
        return JSON.stringify(
            value,
            (key, item) => {
                if (
                    typeof item ===
                    'function'
                ) {
                    return '[function]';
                }

                return item;
            },
            2
        );
    } catch (error) {
        return String(error);
    }
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (installed) {
        return;
    }

    installed = true;

    if (Platform.OS !== 'ios') {
        return;
    }

    const pageApi =
        externalCodeSetup
            ?.pageScreenHooksApi;

    if (
        typeof pageApi
            ?.setPageComponent !==
        'function'
    ) {
        Alert.alert(
            'Skedoggle Page Test',
            'setPageComponent is unavailable.'
        );

        return;
    }

    pageApi.setPageComponent(
        (props, DefaultComponent) => {
            const url =
                props?.url ||
                props?.route
                    ?.params
                    ?.url ||
                props?.source
                    ?.uri ||
                '';

            if (
                typeof url ===
                    'string' &&
                url.includes(
                    'skedoggle.com/track-walk'
                ) &&
                !shown
            ) {
                shown = true;

                setTimeout(
                    () => {
                        Alert.alert(
                            'Track Walk Page Props',
                            [
                                'Property names:',
                                Object.keys(
                                    props || {}
                                ).join(', '),
                                '',
                                'Selected values:',
                                safeStringify({
                                    url:
                                        props
                                            ?.url,
                                    source:
                                        props
                                            ?.source,
                                    route:
                                        props
                                            ?.route,
                                    online:
                                        props
                                            ?.online,
                                    index:
                                        props
                                            ?.index,
                                    screenProps:
                                        props
                                            ?.screenProps,
                                }),
                            ].join('\n')
                        );
                    },
                    1000
                );
            }

            /*
             Render the normal BuddyBoss page unchanged.
            */
            return React.createElement(
                DefaultComponent,
                props
            );
        }
    );

    Alert.alert(
        'Skedoggle Page Test',
        [
            'Page renderer diagnostic installed.',
            '',
            'Open the walk tracker and wait a moment.',
        ].join('\n')
    );
};
