import {
    Alert,
    NativeModules,
    Platform,
} from 'react-native';

import {
    getNavigationService,
} from '@src/utils/NavigationService';

const { BuddybossCustomCode } =
    NativeModules;

let installed = false;
let diagnosticShown = false;

const safeValue = (value) => {
    try {
        if (
            value === null ||
            value === undefined
        ) {
            return String(value);
        }

        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return String(value);
        }

        return JSON.stringify(
            value,
            null,
            2
        );
    } catch (error) {
        return '[Could not display value]';
    }
};

const describeCurrentRoute = () => {
    try {
        const navigationService =
            getNavigationService();

        const route =
            navigationService
                ?.getCurrentRoute?.();

        if (!route) {
            return [
                'No current route was returned.',
                '',
                'Open the walk tracker and wait.',
            ].join('\n');
        }

        const params =
            route.params || {};

        const item =
            params.item || {};

        return [
            `Route name: ${
                route.name ||
                route.routeName ||
                '(unknown)'
            }`,
            '',
            `Route key: ${
                route.key ||
                '(none)'
            }`,
            '',
            'Route parameter names:',
            Object.keys(params).length
                ? Object.keys(params).join(', ')
                : '(none)',
            '',
            `URL parameter: ${
                params.url ||
                params.uri ||
                params.link ||
                '(none)'
            }`,
            '',
            'Item parameter names:',
            Object.keys(item).length
                ? Object.keys(item).join(', ')
                : '(none)',
            '',
            `Item type: ${
                item.type ||
                '(none)'
            }`,
            '',
            `Item object: ${
                item.object ||
                '(none)'
            }`,
            '',
            `Item label: ${
                item.label ||
                '(none)'
            }`,
            '',
            `Item link: ${
                item.link ||
                item.url ||
                item?.data?.link ||
                '(none)'
            }`,
            '',
            'Full route:',
            safeValue(route),
        ].join('\n');
    } catch (error) {
        return [
            'Could not inspect the route.',
            '',
            String(
                error?.message ||
                error
            ),
        ].join('\n');
    }
};

const showRouteDiagnostic = () => {
    if (diagnosticShown) {
        return;
    }

    diagnosticShown = true;

    Alert.alert(
        'Skedoggle Current Screen',
        describeCurrentRoute(),
        [
            {
                text: 'Check Again',
                onPress: () => {
                    diagnosticShown =
                        false;

                    setTimeout(
                        showRouteDiagnostic,
                        500
                    );
                },
            },
            {
                text: 'OK',
            },
        ]
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
            'Skedoggle Diagnostic',
            'The native module is unavailable.'
        );

        return;
    }

    const addIndexJsFunction =
        externalCodeSetup
            ?.indexJsApi
            ?.addIndexJsFunction;

    if (
        typeof addIndexJsFunction !==
        'function'
    ) {
        Alert.alert(
            'Skedoggle Diagnostic',
            'indexJsApi.addIndexJsFunction is unavailable.'
        );

        return;
    }

    addIndexJsFunction(() => {
        /*
         This gives you time to navigate from the initial app screen
         into the Skedoggle walk tracker.
        */
        setTimeout(
            showRouteDiagnostic,
            12000
        );
    });

    Alert.alert(
        'Skedoggle Route Test',
        [
            'Route diagnostic installed.',
            '',
            'Press OK, open the walk tracker, then wait about 12 seconds.',
        ].join('\n')
    );
};
