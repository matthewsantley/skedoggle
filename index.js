import React, {
    useEffect,
    useMemo,
    useState,
} from 'react';

import {
    ActivityIndicator,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import SkedogglePageComponent
    from './ios/components/SkedogglePageComponent';

let installed = false;

const getPageUrl = (props) => {
    return (
        props?.url ||
        props?.source?.uri ||
        props?.route?.params?.url ||
        props?.route?.params?.uri ||
        props?.route?.params?.item?.link ||
        props?.route?.params?.item?.url ||
        props?.item?.link ||
        props?.item?.url ||
        ''
    );
};

const isWalkTrackerUrl = (url) => {
    return (
        typeof url === 'string' &&
        url.includes(
            'skedoggle.com/track-walk'
        )
    );
};

/*
 Search BuddyBoss's normal rendered page for the WebView source.

 The source may contain authentication headers or a special
 authenticated URL, so it is preferable to creating a new source
 using only https://skedoggle.com/track-walk/.
*/
const findWebViewSource = (
    element,
    depth = 0
) => {
    if (
        depth > 10 ||
        !React.isValidElement(element)
    ) {
        return null;
    }

    const elementProps =
        element.props || {};

    if (
        elementProps.source &&
        typeof elementProps.source ===
            'object' &&
        typeof elementProps.source.uri ===
            'string'
    ) {
        return elementProps.source;
    }

    if (
        elementProps.webViewProps
            ?.source &&
        typeof elementProps
            .webViewProps
            .source === 'object' &&
        typeof elementProps
            .webViewProps
            .source
            .uri === 'string'
    ) {
        return elementProps
            .webViewProps
            .source;
    }

    const children =
        React.Children.toArray(
            elementProps.children
        );

    for (const child of children) {
        const found =
            findWebViewSource(
                child,
                depth + 1
            );

        if (found) {
            return found;
        }
    }

    return null;
};

const AuthenticatedWalkPage = ({
    pageProps,
    defaultElement,
}) => {
    const [sessionReady, setSessionReady] =
        useState(false);

    /*
     Try to reuse BuddyBoss's own authenticated WebView source.
    */
    const buddyBossSource =
        useMemo(
            () =>
                findWebViewSource(
                    defaultElement
                ),
            [defaultElement]
        );

    useEffect(
        () => {
            /*
             Keep BuddyBoss's normal page mounted long enough for its
             authentication process to establish the website session.
            */
            const timer =
                setTimeout(
                    () => {
                        setSessionReady(
                            true
                        );
                    },
                    5000
                );

            return () => {
                clearTimeout(timer);
            };
        },
        []
    );

    return (
        <View style={styles.container}>
            {/*
              BuddyBoss's original PageScreen remains mounted.

              Before sessionReady it loads normally behind the
              preparation overlay. Afterwards it is kept mounted
              invisibly so its authenticated session remains active.
            */}
            <View
                pointerEvents="none"
                style={
                    sessionReady
                        ? styles.hiddenBuddyBossPage
                        : styles.visibleBuddyBossPage
                }
            >
                {React.isValidElement(
                    defaultElement
                )
                    ? defaultElement
                    : null}
            </View>

            {!sessionReady && (
                <View
                    style={
                        styles.preparingOverlay
                    }
                >
                    <ActivityIndicator
                        size="large"
                    />

                    <Text
                        style={
                            styles.preparingTitle
                        }
                    >
                        Preparing walk tracker…
                    </Text>

                    <Text
                        style={
                            styles.preparingText
                        }
                    >
                        Connecting your signed-in
                        Skedoggle session.
                    </Text>
                </View>
            )}

            {sessionReady && (
                <View
                    style={
                        styles.replacementPage
                    }
                >
                    <SkedogglePageComponent
                        {...pageProps}

                        /*
                         Prefer BuddyBoss's authenticated source when
                         one was found. Otherwise the component uses
                         its existing URL detection.
                        */
                        source={
                            buddyBossSource ||
                            pageProps?.source
                        }
                    />
                </View>
            )}
        </View>
    );
};

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (installed) {
        return;
    }

    installed = true;

    const pageApi =
        externalCodeSetup
            ?.pageScreenHooksApi;

    if (
        !pageApi ||
        typeof pageApi
            .setPageComponent !==
            'function'
    ) {
        return;
    }

    pageApi.setPageComponent(
        (props, Component) => {
            const pageUrl =
                getPageUrl(props);

            /*
             Leave every other BuddyBoss page completely unchanged.
            */
            if (
                !isWalkTrackerUrl(
                    pageUrl
                )
            ) {
                return Component;
            }

            /*
             Return a real React element so hooks run within a proper
             component lifecycle.
            */
            return React.createElement(
                AuthenticatedWalkPage,
                {
                    pageProps: props,
                    defaultElement:
                        Component,
                }
            );
        }
    );
};

const styles =
    StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor:
                '#ffffff',
        },

        visibleBuddyBossPage: {
            ...StyleSheet.absoluteFillObject,
        },

        hiddenBuddyBossPage: {
            position:
                'absolute',
            width: 1,
            height: 1,
            left: -100,
            top: -100,
            opacity: 0,
            overflow:
                'hidden',
        },

        preparingOverlay: {
            ...StyleSheet.absoluteFillObject,
            alignItems:
                'center',
            justifyContent:
                'center',
            padding: 30,
            backgroundColor:
                '#ffffff',
        },

        preparingTitle: {
            marginTop: 14,
            fontSize: 17,
            fontWeight:
                '700',
            textAlign:
                'center',
        },

        preparingText: {
            marginTop: 8,
            fontSize: 14,
            textAlign:
                'center',
            opacity: 0.65,
        },

        replacementPage: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor:
                '#ffffff',
        },
    });
