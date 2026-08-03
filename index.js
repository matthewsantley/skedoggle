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
        (
            props,
            componentValue
        ) => {
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
                                'Props property names:',
                                Object.keys(
                                    props || {}
                                ).join(', '),
                                '',
                                'Second argument type:',
                                typeof componentValue,
                                '',
                                'Second argument keys:',
                                componentValue &&
                                typeof componentValue ===
                                    'object'
                                    ? Object.keys(
                                          componentValue
                                      ).join(', ')
                                    : '(not an object)',
                                '',
                                'Selected props:',
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
             Return BuddyBoss's existing value unchanged.

             Do not pass it to React.createElement.
            */
            return componentValue;
        }
    );

    Alert.alert(
        'Skedoggle Page Test',
        [
            'Safe page diagnostic installed.',
            '',
            'Open the walk tracker and wait a moment.',
        ].join('\n')
    );
};
