import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import {
    ActivityIndicator,
    Alert,
    AppState,
    Linking,
    Modal,
    NativeEventEmitter,
    PermissionsAndroid,
    NativeModules,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import NitroCookies from 'react-native-nitro-cookies';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    useDispatch,
} from 'react-redux';
import {
    activitiesRequested,
} from '@src/actions/activities';

const {
    BuddybossCustomCode,
} = NativeModules;

const BRIDGE_URL =
    'https://skedoggle.com/wp-json/skedoggle/v1/native-walk-bridge';

const BRIDGE_SECRET =
    'sk-test-7d4b1e9c-83a2-4f61-b909-2f0c9eeb6a41';

const SEARCH_PARTY_POSITION_URL =
    'https://skedoggle.com/wp-json/skedoggle/v1/native-search-position';

let installed = false;

/*
 BuddyBoss root navigation object. This is captured through the supported
 navigationApi callback so components mounted outside the normal navigation
 prop tree can still open native BuddyBoss screens.
*/
let buddyBossRootNavigation = null;

/*
 The PageScreen WebView forwards Search Party messages to the currently
 mounted SearchPartyNativeSidecar through this small shared callback.
*/
let searchPartyWebViewMessageHandler = null;

const LOCATION_INTRO_COOKIE_URL =
    'https://skedoggle.com';

const LOCATION_INTRO_COOKIE_NAME =
    'skedoggle_location_intro_v5';

const NEARBY_ACTIVITY_RADIUS_KEY =
    'skedoggle_nearby_activity_radius_v1';

const ALLOWED_NEARBY_ACTIVITY_RADII =
    [
        0,
        3,
        5,
        10,
    ];

let nearbyActivityRadius =
    0;

/*
 A new generation is assigned whenever the member changes radius. BuddyBoss
 can otherwise regard a return to the parameter-free All Areas request as an
 already cached query and leave the nearby items visible until pull-to-refresh.
*/
let nearbyActivityRequestGeneration =
    Date.now();

/*
 The nearby radius control deliberately does NOT remember BuddyBoss Topic,
 Activity Type, search or scope filters.

 Radius changes must use only the filter state BuddyBoss is displaying at the
 moment the member presses 3 / 5 / 10 miles / All areas. This prevents an old
 Topic or Type (for example Dog Walk) being silently reapplied.
*/
/*
 Keep only the CURRENT BuddyBoss Activity filter state from a real BuddyBoss
 request (for example when the member manually selects Dog Walk).

 This is deliberately not historical filter memory:
 - a radius-button refresh never updates this snapshot;
 - selecting All Topics / All Types produces a new normal BuddyBoss request
   and replaces the snapshot, clearing the old selection.
*/
let nearbyActivityRadiusRefreshPending =
    false;

let nearbyActivityManualFetchParams =
    {};

const nearbyActivityTransientFetchParamNames =
    new Set([
        'page',
        'per_page',
        'offset',
        'after',
        'before',
        'order',
        'orderby',
        'count_total',
        'refresh',
        'cache',
        'cache_bust',
        '_',
        'skedoggle_radius',
        'skedoggle_radius_generation',
    ]);

const captureNearbyActivityManualFetchParams =
    (params) => {
        const captured =
            {};

        Object
            .keys(
                params ||
                    {}
            )
            .forEach(
                (key) => {
                    if (
                        nearbyActivityTransientFetchParamNames
                            .has(key)
                    ) {
                        return;
                    }

                    const value =
                        params[key];

                    if (
                        value ===
                            undefined ||
                        value ===
                            null ||
                        value ===
                            false
                    ) {
                        return;
                    }

                    if (
                        Array.isArray(value) &&
                        value.length ===
                            0
                    ) {
                        return;
                    }

                    const normalised =
                        typeof value ===
                            'string' ||
                        typeof value ===
                            'number'
                            ? String(value)
                                  .trim()
                                  .toLowerCase()
                            : '';

                    /*
                     Do not store BuddyBoss's "nothing selected" sentinels.
                     Because each normal request REPLACES the snapshot, this
                     also clears a previously selected Topic or Activity Type.
                    */
                    if (
                        normalised ===
                            '' ||
                        normalised ===
                            '-1' ||
                        normalised ===
                            '0'
                    ) {
                        return;
                    }

                    captured[key] =
                        value;
                }
            );

        nearbyActivityManualFetchParams =
            captured;
    };

const sanitiseCurrentActivitySubFilters =
    (value) => {
        if (
            !value ||
            typeof value !==
                'object' ||
            Array.isArray(value)
        ) {
            return {};
        }

        const cleaned =
            {};

        Object
            .keys(value)
            .forEach(
                (key) => {
                    const item =
                        value[key];

                    if (
                        item ===
                            undefined ||
                        item ===
                            null ||
                        item ===
                            false
                    ) {
                        return;
                    }

                    if (
                        Array.isArray(item) &&
                        item.length ===
                            0
                    ) {
                        return;
                    }

                    const normalised =
                        typeof item ===
                            'string' ||
                        typeof item ===
                            'number'
                            ? String(item)
                                  .trim()
                                  .toLowerCase()
                            : '';

                    /*
                     BuddyBoss uses empty/default sentinel values for an
                     unselected subfilter. Never turn those into a real filter.
                    */
                    if (
                        normalised ===
                            '' ||
                        normalised ===
                            '-1' ||
                        normalised ===
                            '0' ||
                        normalised ===
                            'all'
                    ) {
                        return;
                    }

                    cleaned[key] =
                        item;
                }
            );

        return cleaned;
    };

const normaliseNearbyActivityRadius =
    (value) => {
        const radius =
            Number(value);

        return ALLOWED_NEARBY_ACTIVITY_RADII
            .includes(radius)
                ? radius
                : 0;
    };

const isMainActivitiesFilterScreen =
    (props) => {
        if (
            props
                ?.forceActivityScreen
        ) {
            return true;
        }

        const routeObject =
            String(
                props
                    ?.route
                    ?.params
                    ?.item
                    ?.object ||
                ''
            )
                .trim()
                .toLowerCase();

        const filterType =
            String(
                props
                    ?.filterType ||
                ''
            )
                .trim()
                .toLowerCase();

        if (routeObject) {
            return (
                routeObject ===
                    'activity' ||
                routeObject ===
                    'activities'
            );
        }

        return (
            filterType ===
                'activity' ||
            filterType ===
                'activities'
        );
    };

const NearbyActivityFeedDivider =
    () => {
        return (
            <View
                style={
                    styles
                        .nearbyActivityDividerWrap
                }
            >
                <View
                    style={
                        styles
                            .nearbyActivityDividerLine
                    }
                />

                <View
                    style={
                        styles
                            .nearbyActivityDividerPawCircle
                    }
                >
                    <Text
                        style={
                            styles
                                .nearbyActivityDividerPaw
                        }
                    >
                        🐾
                    </Text>
                </View>

                <View
                    style={
                        styles
                            .nearbyActivityDividerLine
                    }
                />
            </View>
        );
    };


const NearbyActivityRadiusFilter =
    (props) => {
        const dispatch =
            useDispatch();

        const [
            selectedRadius,
            setSelectedRadius,
        ] = useState(
            nearbyActivityRadius
        );

        const [
            preferenceLoaded,
            setPreferenceLoaded,
        ] = useState(false);

        /*
         Use only BuddyBoss's CURRENT visible filter state.

         There is intentionally no fallback to a previously captured Topic or
         Activity Type. If All Topics / All Types is showing, currentSubFilters
         is empty and the radius request contains no Topic/Type restriction.
        */
        const currentFilter =
            String(
                props?.filter ||
                    'all'
            )
                .trim() ||
            'all';

        const currentSubFilters =
            sanitiseCurrentActivitySubFilters(
                props?.activeSubFilters
            );

        const currentSearchTerm =
            typeof props?.searchTerm ===
                'string'
                ? props.searchTerm
                : '';

        const isActivitiesScreen =
            isMainActivitiesFilterScreen(
                props
            );

        const refreshActivities =
            useCallback(
                () => {
                    dispatch(
                        activitiesRequested(
                            currentFilter,
                            currentSubFilters,
                            true,
                            currentSearchTerm
                        )
                    );
                },
                [
                    currentFilter,
                    currentSubFilters,
                    currentSearchTerm,
                    dispatch,
                ]
            );

        useEffect(
            () => {
                if (!isActivitiesScreen) {
                    return undefined;
                }

                let cancelled =
                    false;

                const loadPreference =
                    async () => {
                        let storedRadius =
                            0;

                        try {
                            storedRadius =
                                normaliseNearbyActivityRadius(
                                    await AsyncStorage
                                        .getItem(
                                            NEARBY_ACTIVITY_RADIUS_KEY
                                        )
                                );
                        } catch (error) {
                            storedRadius =
                                0;
                        }

                        if (cancelled) {
                            return;
                        }

                        const radiusChanged =
                            storedRadius !==
                            nearbyActivityRadius;

                        nearbyActivityRadius =
                            storedRadius;

                        setSelectedRadius(
                            storedRadius
                        );

                        setPreferenceLoaded(
                            true
                        );

                        /*
                         The Activity Feed may have started its first request
                         before AsyncStorage finished loading. Refresh once
                         only when a non-default saved radius has just been
                         restored.
                        */
                        if (
                            radiusChanged &&
                            storedRadius >
                                0
                        ) {
                            nearbyActivityRadiusRefreshPending =
                                true;

                            refreshActivities();
                        }
                    };

                loadPreference();

                return () => {
                    cancelled =
                        true;
                };
            },
            [
                isActivitiesScreen,
                refreshActivities,
            ]
        );

        const openPostcodeProfile =
            useCallback(
                () => {
                    const navigation =
                        buddyBossRootNavigation
                            ?.navigation ||
                        buddyBossRootNavigation;

                    if (
                        navigation &&
                        typeof navigation.navigate ===
                            'function'
                    ) {
                        try {
                            /*
                             EditXprofile is BuddyBoss's native Edit Profile
                             screen. Opening it keeps the member inside the app.
                            */
                            navigation.navigate(
                                'EditXprofile'
                            );

                            return;
                        } catch (error) {
                            /*
                             Fall through to the friendly message below rather
                             than opening an external browser.
                            */
                        }
                    }

                    Alert.alert(
                        'Could not open profile',
                        'Please open your Profile in the app and choose Edit Profile to update your postcode.'
                    );
                },
                []
            );

        const selectRadius =
            useCallback(
                (radiusValue) => {
                    const radius =
                        normaliseNearbyActivityRadius(
                            radiusValue
                        );

                    nearbyActivityRadius =
                        radius;

                    nearbyActivityRequestGeneration =
                        Date.now();

                    setSelectedRadius(
                        radius
                    );

                    AsyncStorage
                        .setItem(
                            NEARBY_ACTIVITY_RADIUS_KEY,
                            String(radius)
                        )
                        .catch(
                            () => {}
                        );

                    nearbyActivityRadiusRefreshPending =
                        true;

                    setTimeout(
                        refreshActivities,
                        0
                    );
                },
                [
                    refreshActivities,
                ]
            );

        if (!isActivitiesScreen) {
            return null;
        }

        const options =
            [
                {
                    value:
                        0,

                    label:
                        'All areas',
                },
                {
                    value:
                        3,

                    label:
                        '3 miles',
                },
                {
                    value:
                        5,

                    label:
                        '5 miles',
                },
                {
                    value:
                        10,

                    label:
                        '10 miles',
                },
            ];

        return (
            <View
                style={
                    styles
                        .nearbyActivityContainer
                }
            >
                <Text
                    style={
                        styles
                            .nearbyActivityHeading
                    }
                >
                    Show posts from members near you
                </Text>

                <Text
                    style={
                        styles
                            .nearbyActivityNote
                    }
                >
                    {'Based on your saved '}
                    <Text
                        accessibilityRole="link"
                        onPress={
                            openPostcodeProfile
                        }
                        style={
                            styles
                                .nearbyActivityPostcodeLink
                        }
                    >
                        postcode
                    </Text>
                    {'.'}
                </Text>

                <ScrollView
                    horizontal={true}
                    showsHorizontalScrollIndicator={
                        false
                    }
                    contentContainerStyle={
                        styles
                            .nearbyActivityOptions
                    }
                >
                    {options.map(
                        (option) => {
                            const selected =
                                selectedRadius ===
                                option.value;

                            return (
                                <TouchableOpacity
                                    key={
                                        String(
                                            option.value
                                        )
                                    }
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        selected:
                                            selected,
                                    }}
                                    disabled={
                                        !preferenceLoaded
                                    }
                                    onPress={
                                        () =>
                                            selectRadius(
                                                option.value
                                            )
                                    }
                                    style={[
                                        styles
                                            .nearbyActivityOption,
                                        selected
                                            ? styles
                                                  .nearbyActivityOptionSelected
                                            : null,
                                        !preferenceLoaded
                                            ? styles
                                                  .nearbyActivityOptionDisabled
                                            : null,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles
                                                .nearbyActivityOptionText,
                                            selected
                                                ? styles
                                                      .nearbyActivityOptionTextSelected
                                                : null,
                                        ]}
                                    >
                                        {
                                            option.label
                                        }
                                    </Text>
                                </TouchableOpacity>
                            );
                        }
                    )}
                </ScrollView>

                <NearbyActivityFeedDivider />
            </View>
        );
    };


const markLocationIntroSeenShared =
    async () => {
        try {
            if (
                typeof BuddybossCustomCode
                    ?.markLocationIntroSeen ===
                'function'
            ) {
                await BuddybossCustomCode
                    .markLocationIntroSeen();
            }
        } catch (error) {
            /*
             The WebView cookie still prevents the map introduction
             from repeating if the native preference cannot be saved.
            */
        }

        try {
            await NitroCookies.set(
                LOCATION_INTRO_COOKIE_URL,
                {
                    name:
                        LOCATION_INTRO_COOKIE_NAME,

                    value:
                        '1',

                    domain:
                        'skedoggle.com',

                    path:
                        '/',

                    secure:
                        true,

                    expires:
                        '2036-01-01T00:00:00.000Z',
                }
            );
        } catch (error) {
            /*
             Map pages also set this cookie inside the WebView.
            */
        }
    };

const buildMapLocationIntroductionScript =
    () => {
        const cookieName =
            JSON.stringify(
                LOCATION_INTRO_COOKIE_NAME
            );

        return `
(function () {
    var COOKIE_NAME = ${cookieName};

    function cookieSeen() {
        return document.cookie
            .split(';')
            .map(function (part) {
                return part.trim();
            })
            .some(function (part) {
                return part.indexOf(
                    COOKIE_NAME + '=1'
                ) === 0;
            });
    }

    if (
        cookieSeen() ||
        window.__skedoggleLocationIntroInstalled
    ) {
        return true;
    }

    window.__skedoggleLocationIntroInstalled =
        true;

    var geolocation =
        navigator.geolocation;

    var originalGetCurrentPosition =
        geolocation &&
        typeof geolocation.getCurrentPosition ===
            'function'
            ? geolocation.getCurrentPosition
                .bind(geolocation)
            : null;

    var originalWatchPosition =
        geolocation &&
        typeof geolocation.watchPosition ===
            'function'
            ? geolocation.watchPosition
                .bind(geolocation)
            : null;

    var originalClearWatch =
        geolocation &&
        typeof geolocation.clearWatch ===
            'function'
            ? geolocation.clearWatch
                .bind(geolocation)
            : null;

    var queuedCurrentRequests = [];
    var queuedWatches = {};
    var activeWatchIds = {};
    var nextQueuedWatchId = -1;
    var released = false;

    if (geolocation && originalGetCurrentPosition) {
        geolocation.getCurrentPosition =
            function (
                success,
                error,
                options
            ) {
                if (released) {
                    return originalGetCurrentPosition(
                        success,
                        error,
                        options
                    );
                }

                queuedCurrentRequests.push({
                    success: success,
                    error: error,
                    options: options,
                });
            };
    }

    if (geolocation && originalWatchPosition) {
        geolocation.watchPosition =
            function (
                success,
                error,
                options
            ) {
                if (released) {
                    return originalWatchPosition(
                        success,
                        error,
                        options
                    );
                }

                var queuedId =
                    nextQueuedWatchId--;

                queuedWatches[queuedId] = {
                    success: success,
                    error: error,
                    options: options,
                };

                return queuedId;
            };
    }

    if (geolocation && originalClearWatch) {
        geolocation.clearWatch =
            function (watchId) {
                if (
                    Object.prototype
                        .hasOwnProperty.call(
                            queuedWatches,
                            watchId
                        )
                ) {
                    delete queuedWatches[
                        watchId
                    ];

                    return;
                }

                if (
                    Object.prototype
                        .hasOwnProperty.call(
                            activeWatchIds,
                            watchId
                        )
                ) {
                    originalClearWatch(
                        activeWatchIds[
                            watchId
                        ]
                    );

                    delete activeWatchIds[
                        watchId
                    ];

                    return;
                }

                originalClearWatch(
                    watchId
                );
            };
    }

    function releaseLocationRequests() {
        if (released) {
            return;
        }

        released = true;

        queuedCurrentRequests
            .splice(0)
            .forEach(function (request) {
                originalGetCurrentPosition(
                    request.success,
                    request.error,
                    request.options
                );
            });

        Object.keys(
            queuedWatches
        ).forEach(function (queuedId) {
            var request =
                queuedWatches[
                    queuedId
                ];

            delete queuedWatches[
                queuedId
            ];

            activeWatchIds[
                queuedId
            ] =
                originalWatchPosition(
                    request.success,
                    request.error,
                    request.options
                );
        });
    }

    function markSeen() {
        document.cookie =
            COOKIE_NAME +
            '=1; Max-Age=315360000; Path=/; SameSite=Lax; Secure';

        try {
            window.ReactNativeWebView
                .postMessage(
                    JSON.stringify({
                        action:
                            'markLocationIntroSeen'
                    })
                );
        } catch (error) {
            /*
             The cookie still prevents the
             introduction from repeating.
            */
        }
    }

    function showIntroduction() {
        if (
            !document.body ||
            document.getElementById(
                'skedoggle-location-intro'
            )
        ) {
            return;
        }

        var overlay =
            document.createElement(
                'div'
            );

        overlay.id =
            'skedoggle-location-intro';

        overlay.innerHTML =
            '<div class="sk-location-intro-scroll">' +
                '<div class="sk-location-intro-panel">' +
                    '<div class="sk-location-intro-paw">🐾</div>' +
                    '<h1>Location helps dog owners help each other</h1>' +
                    '<p class="sk-location-intro-lead">Skedoggle uses your location when you choose to:</p>' +
                    '<div class="sk-location-intro-card">' +
                        '<strong>Explore nearby</strong>' +
                        '<span>View dog-friendly places, pet services and lost dogs near you.</span>' +
                    '</div>' +
                    '<div class="sk-location-intro-card">' +
                        '<strong>Map a dog walk</strong>' +
                        '<span>Record your route while your walk is active, including when your screen is locked.</span>' +
                    '</div>' +
                    '<div class="sk-location-intro-card">' +
                        '<strong>Join a lost-dog Search Party</strong>' +
                        '<span>Your live position may be shown to other participants so everyone can coordinate safely.</span>' +
                    '</div>' +
                    '<div class="sk-location-intro-card">' +
                        '<strong>When iPhone asks</strong>' +
                        '<span>Select <b>Allow While Using App</b> and make sure <b>Precise Location</b> is on.</span>' +
                    '</div>' +
                    '<p class="sk-location-intro-control">Skedoggle does not track your location unless you start a feature that needs it.</p>' +
                    '<button id="skedoggle-location-intro-continue" type="button">Continue</button>' +
                    '<p class="sk-location-intro-footer">You can change location access at any time in your iPhone Settings.</p>' +
                '</div>' +
            '</div>';

        var style =
            document.createElement(
                'style'
            );

        style.id =
            'skedoggle-location-intro-style';

        style.textContent =
            '#skedoggle-location-intro{' +
                'position:fixed;' +
                'inset:0;' +
                'z-index:2147483647;' +
                'background:#fff;' +
                'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
                'color:#3f3f46;' +
            '}' +
            '.sk-location-intro-scroll{' +
                'height:100%;' +
                'overflow:auto;' +
                '-webkit-overflow-scrolling:touch;' +
                'box-sizing:border-box;' +
                'padding:calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 28px);' +
            '}' +
            '.sk-location-intro-panel{' +
                'width:100%;' +
                'max-width:520px;' +
                'min-height:100%;' +
                'margin:0 auto;' +
                'display:flex;' +
                'flex-direction:column;' +
                'justify-content:center;' +
                'box-sizing:border-box;' +
            '}' +
            '.sk-location-intro-paw{' +
                'width:78px;' +
                'height:78px;' +
                'border-radius:50%;' +
                'display:flex;' +
                'align-items:center;' +
                'justify-content:center;' +
                'align-self:center;' +
                'background:#f8e7f4;' +
                'font-size:38px;' +
                'margin-bottom:22px;' +
            '}' +
            '#skedoggle-location-intro h1{' +
                'margin:0 0 14px;' +
                'color:#261e8c;' +
                'font-size:29px;' +
                'line-height:1.22;' +
                'text-align:center;' +
            '}' +
            '.sk-location-intro-lead{' +
                'margin:0 0 22px;' +
                'font-size:17px;' +
                'line-height:1.48;' +
                'text-align:center;' +
            '}' +
            '.sk-location-intro-card{' +
                'background:#f7f7fa;' +
                'border-radius:16px;' +
                'padding:16px 18px;' +
                'margin-bottom:12px;' +
            '}' +
            '.sk-location-intro-card strong{' +
                'display:block;' +
                'color:#261e8c;' +
                'font-size:17px;' +
                'margin-bottom:6px;' +
            '}' +
            '.sk-location-intro-card span{' +
                'display:block;' +
                'font-size:15px;' +
                'line-height:1.48;' +
            '}' +
            '.sk-location-intro-control{' +
                'font-size:15px;' +
                'line-height:1.48;' +
                'text-align:center;' +
                'margin:8px 4px 4px;' +
            '}' +
            '#skedoggle-location-intro-continue{' +
                'width:100%;' +
                'min-height:56px;' +
                'border:0;' +
                'border-radius:28px;' +
                'background:#d622a6;' +
                'color:#fff;' +
                'font-size:17px;' +
                'font-weight:700;' +
                'margin-top:16px;' +
                '-webkit-appearance:none;' +
            '}' +
            '.sk-location-intro-footer{' +
                'color:#71717a;' +
                'font-size:13px;' +
                'line-height:1.45;' +
                'text-align:center;' +
                'margin:16px 0 0;' +
            '}';

        document.head
            .appendChild(
                style
            );

        document.body
            .appendChild(
                overlay
            );

        var button =
            document.getElementById(
                'skedoggle-location-intro-continue'
            );

        if (button) {
            button.addEventListener(
                'click',
                function () {
                    markSeen();
                    releaseLocationRequests();

                    overlay.remove();

                    if (style.parentNode) {
                        style.parentNode
                            .removeChild(
                                style
                            );
                    }
                },
                {
                    once: true
                }
            );
        }
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            showIntroduction,
            {
                once: true
            }
        );
    } else {
        showIntroduction();
    }
})();
true;
`;
    };


const ANDROID_NOTIFICATION_PERMISSION =
    PermissionsAndroid
        ?.PERMISSIONS
        ?.POST_NOTIFICATIONS ||
    'android.permission.POST_NOTIFICATIONS';

const requestAndroidWalkPermissions =
    async () => {
        if (
            Platform.OS !==
                'android' ||
            Number(
                Platform.Version
            ) < 23
        ) {
            return {
                locationGranted:
                    true,

                fineLocationGranted:
                    true,

                coarseLocationGranted:
                    true,

                notificationsGranted:
                    true,
            };
        }

        const finePermission =
            PermissionsAndroid
                .PERMISSIONS
                .ACCESS_FINE_LOCATION;

        const coarsePermission =
            PermissionsAndroid
                .PERMISSIONS
                .ACCESS_COARSE_LOCATION;

        const locationResults =
            await PermissionsAndroid
                .requestMultiple([
                    finePermission,
                    coarsePermission,
                ]);

        const fineLocationGranted =
            locationResults[
                finePermission
            ] ===
            PermissionsAndroid
                .RESULTS
                .GRANTED;

        const coarseLocationGranted =
            locationResults[
                coarsePermission
            ] ===
            PermissionsAndroid
                .RESULTS
                .GRANTED;

        let notificationsGranted =
            true;

        if (
            Number(
                Platform.Version
            ) >= 33
        ) {
            notificationsGranted =
                await PermissionsAndroid
                    .check(
                        ANDROID_NOTIFICATION_PERMISSION
                    );

            if (
                !notificationsGranted
            ) {
                const result =
                    await PermissionsAndroid
                        .request(
                            ANDROID_NOTIFICATION_PERMISSION
                        );

                notificationsGranted =
                    result ===
                    PermissionsAndroid
                        .RESULTS
                        .GRANTED;
            }
        }

        return {
            locationGranted:
                fineLocationGranted ||
                coarseLocationGranted,

            fineLocationGranted,

            coarseLocationGranted,

            notificationsGranted,
        };
    };

const getPageUrl = (props) => {
    const candidates = [
        props?.url,
        props?.source?.uri,
        props?.route?.params?.url,
        props?.route?.params?.uri,
        props?.route?.params?.path,
        props?.route?.params?.slug,
        props?.route?.params?.item?.link,
        props?.route?.params?.item?.url,
        props?.route?.params?.item?.path,
        props?.route?.params?.item?.slug,
        props?.item?.link,
        props?.item?.url,
        props?.item?.path,
        props?.item?.slug,
        props?.path,
        props?.slug,
        props?.screenId,
        props?.route?.name,
    ];

    return (
        candidates.find(
            (candidate) =>
                typeof candidate ===
                    'string' &&
                candidate.trim().length > 0
        ) ||
        ''
    );
};

const normalisePageReference = (
    value
) => {
    if (typeof value !== 'string') {
        return '';
    }

    let normalised = value;

    try {
        normalised =
            decodeURIComponent(
                normalised
            );
    } catch (error) {
        /*
         Keep the original value if it is not valid URI text.
        */
    }

    return normalised
        .trim()
        .toLowerCase()
        .replace(
            /[\s_]+/g,
            '-'
        );
};

const pageReferenceMatches = (
    value,
    slug
) => {
    const normalised =
        normalisePageReference(
            value
        );

    if (!normalised) {
        return false;
    }

    return (
        normalised === slug ||
        normalised.includes(
            `/${slug}`
        ) ||
        normalised.includes(
            `${slug}/`
        ) ||
        normalised.includes(
            slug
        )
    );
};

const isWalkTrackerUrl = (url) => {
    return pageReferenceMatches(
        url,
        'track-walk'
    );
};

const isSearchPartyUrl = (url) => {
    return pageReferenceMatches(
        url,
        'search-party'
    );
};

const isDailyWoofUrl = (url) => {
    /*
     The first app page is labelled "Daily Woof", but BuddyBoss/WordPress
     may expose it using several different references:

       - daily-woof
       - news-feed
       - new-feed
       - NewsFeed
       - the Skedoggle site root (https://skedoggle.com)

     The root match is deliberately restricted to the exact Skedoggle
     homepage so other pages are not mistaken for Daily Woof.
    */
    const normalised =
        normalisePageReference(
            url
        );

    if (!normalised) {
        return false;
    }

    if (
        pageReferenceMatches(
            normalised,
            'daily-woof'
        ) ||
        pageReferenceMatches(
            normalised,
            'news-feed'
        ) ||
        pageReferenceMatches(
            normalised,
            'new-feed'
        ) ||
        pageReferenceMatches(
            normalised,
            'newsfeed'
        )
    ) {
        return true;
    }

    const withoutQueryOrHash =
        normalised
            .split(/[?#]/)[0]
            .replace(/\/+$/, '');

    return (
        withoutQueryOrHash ===
            'https://skedoggle.com' ||
        withoutQueryOrHash ===
            'http://skedoggle.com' ||
        withoutQueryOrHash ===
            'https://www.skedoggle.com' ||
        withoutQueryOrHash ===
            'http://www.skedoggle.com' ||
        withoutQueryOrHash ===
            'skedoggle.com' ||
        withoutQueryOrHash ===
            'www.skedoggle.com' ||
        withoutQueryOrHash ===
            ''
    );
};

const isLocationMapUrl = (url) => {
    return (
        pageReferenceMatches(
            url,
            'places-map'
        ) ||
        pageReferenceMatches(
            url,
            'services-map'
        ) ||
        pageReferenceMatches(
            url,
            'lost-dogs-map'
        )
    );
};

/*
 BuddyBoss does not always expose a WordPress page URL in the same
 property. Search the small page-screen props object as a fallback so
 menu pages such as places-map are still recognised.
*/
const valueContainsPageReference = (
    value,
    slugs,
    depth = 0,
    visited = new Set()
) => {
    if (
        value == null ||
        depth > 5
    ) {
        return false;
    }

    if (
        typeof value ===
        'string'
    ) {
        return slugs.some(
            (slug) =>
                pageReferenceMatches(
                    value,
                    slug
                )
        );
    }

    if (
        typeof value !==
            'object' ||
        visited.has(value)
    ) {
        return false;
    }

    visited.add(value);

    const entries = Array.isArray(value)
        ? value.map(
            (entry, index) => [
                String(index),
                entry,
            ]
        )
        : Object.entries(value);

    return entries
        .slice(0, 80)
        .some(
            ([key, entry]) =>
                slugs.some(
                    (slug) =>
                        pageReferenceMatches(
                            key,
                            slug
                        )
                ) ||
                valueContainsPageReference(
                    entry,
                    slugs,
                    depth + 1,
                    visited
                )
        );
};

const isLocationMapPageProps = (
    props
) => {
    const slugs = [
        'places-map',
        'services-map',
        'lost-dogs-map',
        /* Backup entry points if opened directly. */
        'places-near-me',
        'services-near-me',
        'lost-dogs-near-me',
    ];

    const pageUrl =
        getPageUrl(props);

    /*
     When BuddyBoss supplies a current page URL, match only that URL.
     Do not recursively scan the whole navigation object because it can
     contain every menu item, causing Track Walk and Search Party to be
     mistaken for map pages.
    */
    if (pageUrl) {
        return slugs.some(
            (slug) =>
                pageReferenceMatches(
                    pageUrl,
                    slug
                )
        );
    }

    /*
     Use the broader fallback only when BuddyBoss has not supplied any
     usable current-page reference.
    */
    return valueContainsPageReference(
        props,
        slugs
    );
};

const postToBridge = async (
    payload
) => {
    const response = await fetch(
        BRIDGE_URL,
        {
            method: 'POST',

            headers: {
                Accept:
                    'application/json',

                'Content-Type':
                    'application/json',
            },

            body: JSON.stringify({
                secret:
                    BRIDGE_SECRET,

                ...payload,
            }),
        }
    );

    if (!response.ok) {
        throw new Error(
            `Bridge request failed: ${response.status}`
        );
    }

    return response.json();
};

const fetchCommand = async () => {
    const url =
        BRIDGE_URL +
        '?mode=command' +
        '&secret=' +
        encodeURIComponent(
            BRIDGE_SECRET
        ) +
        '&_=' +
        Date.now();

    const response = await fetch(
        url,
        {
            headers: {
                Accept:
                    'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(
            `Command request failed: ${response.status}`
        );
    }

    return response.json();
};

const fetchSearchPartyCommand = async () => {
    const url =
        BRIDGE_URL +
        '?mode=command' +
        '&tracking_mode=search_party' +
        '&secret=' +
        encodeURIComponent(
            BRIDGE_SECRET
        ) +
        '&_=' +
        Date.now();

    const response = await fetch(
        url,
        {
            headers: {
                Accept:
                    'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(
            `Search Party command request failed: ${response.status}`
        );
    }

    return response.json();
};

const normaliseLocation = (
    location
) => {
    let value =
        location;

    if (
        typeof value ===
        'string'
    ) {
        try {
            value =
                JSON.parse(
                    value
                );
        } catch (error) {
            return null;
        }
    }

    const point = {
        type:
            'location',

        lat:
            Number(
                value?.lat ??
                value?.latitude
            ),

        lng:
            Number(
                value?.lng ??
                value?.longitude
            ),

        accuracy:
            Number(
                value?.accuracy ??
                10
            ),

        ts:
            Number(
                value?.ts ??
                value?.timestamp ??
                Date.now()
            ),

        native:
            true,

        trackingMode:
            String(
                value?.trackingMode ||
                value?.tracking_mode ||
                ''
            ),

        sessionId:
            Number(
                value?.sessionId ??
                value?.session_id ??
                0
            ),
    };

    if (
        !Number.isFinite(
            point.lat
        ) ||
        !Number.isFinite(
            point.lng
        )
    ) {
        return null;
    }

    return point;
};

const WalkLocationIntroduction = ({
    loading,
    saving,
    onContinue,
}) => {
    return (
        <SafeAreaView
            style={
                styles.introSafeArea
            }
        >
            <ScrollView
                contentContainerStyle={
                    styles.introContent
                }
                showsVerticalScrollIndicator={
                    false
                }
            >
                <View
                    style={
                        styles.introPawCircle
                    }
                >
                    <Text
                        style={
                            styles.introPaw
                        }
                    >
                        🐾
                    </Text>
                </View>

                <Text
                    style={
                        styles.introTitle
                    }
                >
                    Location helps map every step
                </Text>

                <Text
                    style={
                        styles.introLead
                    }
                >
                    Skedoggle uses your location when you choose to use a feature that needs it.
                </Text>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        Location-powered features
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        {'• View dog-friendly places near you\n• Find pet services near you\n• View lost dogs near you\n• Map a dog walk\n• Join a lost-dog search party'}
                    </Text>
                </View>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        Search parties
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        During a search party, your live position may be shown to other participants so everyone can coordinate and see which areas have been searched.
                    </Text>
                </View>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        Location settings
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        When iOS asks, choose Allow While Using App and make sure Precise Location is on in Location Settings.
                    </Text>
                </View>

                <View
                    style={
                        styles.introCard
                    }
                >
                    <Text
                        style={
                            styles.introCardTitle
                        }
                    >
                        You stay in control
                    </Text>

                    <Text
                        style={
                            styles.introCardText
                        }
                    >
                        Skedoggle does not track your location unless you start a feature that needs it. Tracking stops when you end the walk or leave the search.
                    </Text>
                </View>

                {loading ? (
                    <View
                        style={
                            styles.introLoading
                        }
                    >
                        <ActivityIndicator
                            size="large"
                        />
                    </View>
                ) : (
                    <TouchableOpacity
                        activeOpacity={
                            0.85
                        }
                        disabled={
                            saving
                        }
                        onPress={
                            onContinue
                        }
                        style={[
                            styles.introButton,
                            saving &&
                                styles.introButtonDisabled,
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator
                                color="#ffffff"
                            />
                        ) : (
                            <Text
                                style={
                                    styles.introButtonText
                                }
                            >
                                Continue
                            </Text>
                        )}
                    </TouchableOpacity>
                )}

                <Text
                    style={
                        styles.introFooter
                    }
                >
                    You can change location access at any time in your iPhone Settings.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
};

const LocationIntroductionOnlySidecar = ({
    defaultComponent,
}) => {
    const [locationIntroState, setLocationIntroState] =
        useState(
            Platform.OS === 'ios'
                ? 'checking'
                : 'hidden'
        );

    useEffect(
        () => {
            let cancelled =
                false;

            const checkLocationIntroduction =
                async () => {
                    if (
                        Platform.OS !==
                        'ios'
                    ) {
                        if (!cancelled) {
                            setLocationIntroState(
                                'hidden'
                            );
                        }

                        return;
                    }

                    if (
                        typeof BuddybossCustomCode
                            ?.hasSeenLocationIntro !==
                        'function'
                    ) {
                        /*
                         Fail open: show the explanation even if the
                         native saved-preference method is unavailable.
                        */
                        if (!cancelled) {
                            setLocationIntroState(
                                'visible'
                            );
                        }

                        return;
                    }

                    try {
                        const result =
                            await BuddybossCustomCode
                                .hasSeenLocationIntro();

                        if (!cancelled) {
                            setLocationIntroState(
                                result?.seen
                                    ? 'hidden'
                                    : 'visible'
                            );
                        }
                    } catch (error) {
                        /*
                         Do not silently skip the explanation if the
                         saved preference cannot be read.
                        */
                        if (!cancelled) {
                            setLocationIntroState(
                                'visible'
                            );
                        }
                    }
                };

            checkLocationIntroduction();

            return () => {
                cancelled =
                    true;
            };
        },
        []
    );

    const continueToLocationPage =
        useCallback(
            async () => {
                setLocationIntroState(
                    'saving'
                );

                try {
                    if (
                        typeof markLocationIntroSeenShared ===
                        'function'
                    ) {
                        /*
                         The same one-time preference is shared by the
                         maps, map pages, Walk Tracking and Search Parties.
                        */
                        await markLocationIntroSeenShared();
                    }
                } catch (error) {
                    /*
                     Do not prevent access to the map if saving fails.
                    */
                } finally {
                    setLocationIntroState(
                        'hidden'
                    );
                }
            },
            []
        );

    if (
        Platform.OS ===
            'ios' &&
        locationIntroState !==
            'hidden'
    ) {
        return (
            <WalkLocationIntroduction
                loading={
                    locationIntroState ===
                    'checking'
                }
                saving={
                    locationIntroState ===
                    'saving'
                }
                onContinue={
                    continueToLocationPage
                }
            />
        );
    }

    return (
        <View
            style={{
                flex: 1,
            }}
        >
            {defaultComponent}
        </View>
    );
};


const DailyWoofLocationIntroduction = () => {
    const [introState, setIntroState] =
        useState(
            Platform.OS === 'ios'
                ? 'checking'
                : 'hidden'
        );

    useEffect(
        () => {
            let cancelled = false;

            const checkSeen = async () => {
                if (Platform.OS !== 'ios') {
                    if (!cancelled) {
                        setIntroState('hidden');
                    }
                    return;
                }

                if (
                    typeof BuddybossCustomCode
                        ?.hasSeenLocationIntro !==
                    'function'
                ) {
                    if (!cancelled) {
                        setIntroState('visible');
                    }
                    return;
                }

                try {
                    const result =
                        await BuddybossCustomCode
                            .hasSeenLocationIntro();

                    if (!cancelled) {
                        setIntroState(
                            result?.seen
                                ? 'hidden'
                                : 'visible'
                        );
                    }
                } catch (error) {
                    if (!cancelled) {
                        setIntroState('visible');
                    }
                }
            };

            checkSeen();

            return () => {
                cancelled = true;
            };
        },
        []
    );

    const continueToFeed =
        useCallback(
            async () => {
                setIntroState('saving');

                try {
                    await markLocationIntroSeenShared();
                } catch (error) {
                    /*
                     Never block access to Daily Woof if saving fails.
                    */
                } finally {
                    setIntroState('hidden');
                }
            },
            []
        );

    if (
        Platform.OS !== 'ios' ||
        introState === 'hidden'
    ) {
        return null;
    }

    return (
        <Modal
            animationType="none"
            transparent={false}
            visible={true}
            presentationStyle="fullScreen"
            onRequestClose={() => {}}
        >
            <WalkLocationIntroduction
                loading={
                    introState === 'checking'
                }
                saving={
                    introState === 'saving'
                }
                onContinue={
                    continueToFeed
                }
            />
        </Modal>
    );
};


const WalkNativeSidecar = ({
    defaultComponent,
}) => {
    const [walkIntroState, setWalkIntroState] =
        useState(
            Platform.OS === 'ios'
                ? 'checking'
                : 'hidden'
        );

    const lastCommandIdRef =
        useRef('');

    const uploadRunningRef =
        useRef(false);

    const flushRunningRef =
        useRef(false);

    const trackingRef =
        useRef(false);

    const appStateRef =
        useRef(
            AppState.currentState
        );

    useEffect(
        () => {
            let cancelled =
                false;

            const checkWalkIntroduction =
                async () => {
                    if (
                        Platform.OS !==
                        'ios'
                    ) {
                        if (!cancelled) {
                            setWalkIntroState(
                                'hidden'
                            );
                        }

                        return;
                    }

                    if (
                        typeof BuddybossCustomCode
                            ?.hasSeenLocationIntro !==
                        'function'
                    ) {
                        /*
                         Fail open: show the explanation even if the
                         native saved-preference method is unavailable.
                        */
                        if (!cancelled) {
                            setWalkIntroState(
                                'visible'
                            );
                        }

                        return;
                    }

                    try {
                        const result =
                            await BuddybossCustomCode
                                .hasSeenLocationIntro();

                        if (!cancelled) {
                            setWalkIntroState(
                                result?.seen
                                    ? 'hidden'
                                    : 'visible'
                            );
                        }
                    } catch (error) {
                        /*
                         Do not silently skip the location explanation
                         if reading the saved preference fails.
                        */
                        if (!cancelled) {
                            setWalkIntroState(
                                'visible'
                            );
                        }
                    }
                };

            checkWalkIntroduction();

            return () => {
                cancelled =
                    true;
            };
        },
        []
    );

    const continueToWalkTracking =
        useCallback(
            async () => {
                setWalkIntroState(
                    'saving'
                );

                try {
                    if (
                        typeof markLocationIntroSeenShared ===
                        'function'
                    ) {
                        await markLocationIntroSeenShared();
                    }
                } catch (error) {
                    /*
                     Do not prevent access to the walk tracker if the
                     preference could not be saved.
                    */
                } finally {
                    setWalkIntroState(
                        'hidden'
                    );
                }
            },
            []
        );

    const acknowledgePoints =
        useCallback(
            async (points) => {
                const hasModeAwareAcknowledge =
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocationForMode ===
                    'function';

                const hasLegacyAcknowledge =
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocation ===
                    'function';

                if (
                    !hasModeAwareAcknowledge &&
                    !hasLegacyAcknowledge
                ) {
                    return;
                }

                for (const point of points) {
                    if (point?.ts == null) {
                        continue;
                    }

                    try {
                        if (hasModeAwareAcknowledge) {
                            await BuddybossCustomCode
                                .acknowledgeLocationForMode(
                                    point.ts,
                                    'walk',
                                    0
                                );
                        } else {
                            await BuddybossCustomCode
                                .acknowledgeLocation(
                                    point.ts
                                );
                        }
                    } catch (error) {
                        /*
                         Unacknowledged points remain buffered.
                        */
                    }
                }
            },
            []
        );

    const uploadPoints =
        useCallback(
            async (
                rawPoints
            ) => {
                if (
                    uploadRunningRef.current ||
                    !Array.isArray(
                        rawPoints
                    ) ||
                    rawPoints.length === 0
                ) {
                    return false;
                }

                const points =
                    rawPoints
                        .map(
                            normaliseLocation
                        )
                        .filter(
                            (point) =>
                                point &&
                                (
                                    !point.trackingMode ||
                                    point.trackingMode ===
                                        'walk'
                                )
                        )
                        .sort(
                            (first, second) =>
                                Number(
                                    first.ts ||
                                    0
                                ) -
                                Number(
                                    second.ts ||
                                    0
                                )
                        )
                        .filter(
                            (
                                point,
                                index,
                                ordered
                            ) => {
                                if (
                                    index ===
                                    0
                                ) {
                                    return true;
                                }

                                const previous =
                                    ordered[
                                        index -
                                        1
                                    ];

                                return !(
                                    Number(
                                        previous.ts ||
                                        0
                                    ) ===
                                        Number(
                                            point.ts ||
                                            0
                                        ) &&
                                    Number(
                                        previous.lat
                                    ) ===
                                        Number(
                                            point.lat
                                        ) &&
                                    Number(
                                        previous.lng
                                    ) ===
                                        Number(
                                            point.lng
                                        )
                                );
                            }
                        );

                if (
                    points.length === 0
                ) {
                    return false;
                }

                uploadRunningRef.current =
                    true;

                try {
                    await postToBridge({
                        action:
                            'points',

                        points,
                    });

                    await acknowledgePoints(
                        points
                    );

                    return true;
                } catch (error) {
                    return false;
                } finally {
                    uploadRunningRef.current =
                        false;
                }
            },
            [
                acknowledgePoints,
            ]
        );

    const flushBufferedPoints =
        useCallback(
            async () => {
                if (
                    flushRunningRef.current ||
                    typeof BuddybossCustomCode
                        ?.getBufferedLocations !==
                        'function'
                ) {
                    return;
                }

                flushRunningRef.current =
                    true;

                try {
                    const buffered =
                        await BuddybossCustomCode
                            .getBufferedLocations();

                    if (
                        Array.isArray(
                            buffered
                        ) &&
                        buffered.length > 0
                    ) {
                        await uploadPoints(
                            buffered
                        );
                    }
                } catch (error) {
                    /*
                     Native points remain buffered.
                    */
                } finally {
                    flushRunningRef.current =
                        false;
                }
            },
            [
                uploadPoints,
            ]
        );

    const acknowledgeCommand =
        useCallback(
            async (
                commandId
            ) => {
                try {
                    await postToBridge({
                        action:
                            'ack_command',

                        command_id:
                            commandId,
                    });
                } catch (error) {
                    // The next poll may see it again.
                }
            },
            []
        );

    const processCommand =
        useCallback(
            async (
                commandData
            ) => {
                if (
                    Platform.OS ===
                        'ios' &&
                    walkIntroState !==
                        'hidden'
                ) {
                    return;
                }

                const command =
                    commandData
                        ?.command;

                const commandId =
                    String(
                        commandData
                            ?.command_id ||
                        ''
                    );

                if (
                    !command ||
                    !commandId ||
                    commandId ===
                        lastCommandIdRef
                            .current
                ) {
                    return;
                }

                lastCommandIdRef.current =
                    commandId;

                try {
                    if (
                        command ===
                        'start'
                    ) {
                        if (
                            typeof BuddybossCustomCode
                                ?.startBackgroundTracking !==
                                'function'
                        ) {
                            throw new Error(
                                'startBackgroundTracking is unavailable.'
                            );
                        }

                        let androidPermissions =
                            null;

                        if (
                            Platform.OS ===
                            'android'
                        ) {
                            androidPermissions =
                                await requestAndroidWalkPermissions();

                            if (
                                !androidPermissions
                                    .locationGranted
                            ) {
                                trackingRef.current =
                                    false;

                                Alert.alert(
                                    'Location permission needed',
                                    [
                                        'Skedoggle needs location access to record your walk.',
                                        '',
                                        'Tap Open Settings and allow location while using the app. For the best route, enable precise location.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Cancel',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );

                                return;
                            }
                        }

                        /*
                         A prior WebView/app crash may have left accepted
                         native points in the persistent buffer. Upload those
                         before startBackgroundTracking() resets the current
                         native session.
                        */
                        await flushBufferedPoints();

                        const result =
                            await BuddybossCustomCode
                                .startBackgroundTracking();

                        trackingRef.current =
                            true;

                        if (
                            Platform.OS ===
                            'ios'
                        ) {
                            const permissionStatus =
                                Number(
                                    result?.authorizationStatus
                                );

                            /*
                             iOS permission values:
                             3 = Always
                             4 = While Using the App
                            */
                            const locationGranted =
                                permissionStatus === 3 ||
                                permissionStatus === 4;

                            const preciseLocationEnabled =
                                result?.preciseLocationEnabled !==
                                false;

                            if (
                                locationGranted &&
                                preciseLocationEnabled
                            ) {
                                /*
                                 Tracking started successfully.
                                 No alert is needed for the normal success case.
                                */
                            } else if (
                                locationGranted &&
                                !preciseLocationEnabled
                            ) {
                                Alert.alert(
                                    'Precise Location is off',
                                    [
                                        'Skedoggle needs precise location to map your walk accurately.',
                                        '',
                                        'Please make sure Precise Location is on in Skedoggle’s Location Settings.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Continue Anyway',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                async () => {
                                                    trackingRef.current =
                                                        false;

                                                    try {
                                                        if (
                                                            typeof BuddybossCustomCode
                                                                ?.stopBackgroundTracking ===
                                                            'function'
                                                        ) {
                                                            await BuddybossCustomCode
                                                                .stopBackgroundTracking();
                                                        }
                                                    } catch (error) {
                                                        /*
                                                         Open Settings even if stopping fails.
                                                        */
                                                    }

                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            } else {
                                trackingRef.current =
                                    false;

                                Alert.alert(
                                    'Location permission needed',
                                    [
                                        'Skedoggle needs location access to record your walk.',
                                        '',
                                        'Open Settings, select While Using the App, and make sure Precise Location is on.'
                                    ].join('\n'),
                                    [
                                        {
                                            text:
                                                'Cancel',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            }
                        } else if (
                            Platform.OS ===
                            'android'
                        ) {
                            const preciseLocation =
                                Boolean(
                                    result
                                        ?.fineLocationGranted ??
                                    androidPermissions
                                        ?.fineLocationGranted
                                );

                            const notificationsGranted =
                                Boolean(
                                    result
                                        ?.notificationsGranted ??
                                    androidPermissions
                                        ?.notificationsGranted
                                );

                            if (
                                preciseLocation &&
                                notificationsGranted
                            ) {
                                Alert.alert(
                                    'Walk tracking started',
                                    [
                                        'Background tracking is enabled.',
                                        '',
                                        'Keep the Skedoggle walk notification visible while your walk is active. Your route should continue recording when the screen is locked.'
                                    ].join('\n')
                                );
                            } else {
                                const messages = [
                                    'Background tracking has started.'
                                ];

                                if (
                                    !preciseLocation
                                ) {
                                    messages.push(
                                        '',
                                        'Android is using approximate location. For a more accurate route, open Settings and enable precise location for Skedoggle.'
                                    );
                                }

                                if (
                                    !notificationsGranted
                                ) {
                                    messages.push(
                                        '',
                                        'Notifications are disabled. Enable Skedoggle notifications so Android can clearly show that your walk is still being tracked.'
                                    );
                                }

                                Alert.alert(
                                    'Walk tracking started',
                                    messages.join(
                                        '\n'
                                    ),
                                    [
                                        {
                                            text:
                                                'Continue',
                                            style:
                                                'cancel'
                                        },
                                        {
                                            text:
                                                'Open Settings',
                                            onPress:
                                                () => {
                                                    Linking
                                                        .openSettings();
                                                }
                                        }
                                    ]
                                );
                            }
                        } else {
                            Alert.alert(
                                'Walk tracking started',
                                'Background tracking is enabled.'
                            );
                        }

                        await flushBufferedPoints();
                    }

                    if (
                        command ===
                        'stop'
                    ) {
                        await flushBufferedPoints();

                        if (
                            typeof BuddybossCustomCode
                                ?.stopBackgroundTracking ===
                                'function'
                        ) {
                            await BuddybossCustomCode
                                .stopBackgroundTracking();
                        }

                        await flushBufferedPoints();

                        trackingRef.current =
                            false;
                    }
                } catch (error) {
                    const errorCode =
                        String(
                            error?.code ||
                            ''
                        );

                    if (
                        errorCode ===
                            'location_permission_denied' ||
                        errorCode ===
                            'location_permission_unavailable'
                    ) {
                        trackingRef.current =
                            false;

                        Alert.alert(
                            'Location permission needed',
                            [
                                'Skedoggle needs location access to record your walk.',
                                '',
                                'Open Settings, select While Using the App, and make sure Precise Location is on.'
                            ].join('\n'),
                            [
                                {
                                    text:
                                        'Cancel',
                                    style:
                                        'cancel'
                                },
                                {
                                    text:
                                        'Open Settings',
                                    onPress:
                                        () => {
                                            Linking
                                                .openSettings();
                                        }
                                }
                            ]
                        );
                    } else {
                        Alert.alert(
                            'Native GPS Error',
                            String(
                                error?.message ??
                                error
                            )
                        );
                    }
                } finally {
                    await acknowledgeCommand(
                        commandId
                    );
                }
            },
            [
                acknowledgeCommand,
                flushBufferedPoints,
                walkIntroState,
            ]
        );

    useEffect(
        () => {
            let cancelled = false;

            const poll = async () => {
                try {
                    const command =
                        await fetchCommand();

                    if (!cancelled) {
                        await processCommand(
                            command
                        );
                    }
                } catch (error) {
                    /*
                     A later poll will retry.
                    */
                }
            };

            poll();

            const timer =
                setInterval(
                    poll,
                    1000
                );

            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        },
        [
            processCommand,
        ]
    );

    useEffect(
        () => {
            const timer =
                setInterval(
                    () => {
                        flushBufferedPoints();
                    },
                    2000
                );

            return () => {
                clearInterval(timer);
            };
        },
        [
            flushBufferedPoints,
        ]
    );

    useEffect(
        () => {
            if (
                (
                    Platform.OS !==
                        'ios' &&
                    Platform.OS !==
                        'android'
                ) ||
                !BuddybossCustomCode
            ) {
                return undefined;
            }

            let subscription = null;

            try {
                const emitter =
                    new NativeEventEmitter(
                        BuddybossCustomCode
                    );

                subscription =
                    emitter.addListener(
                        'SkedoggleLocation',
                        (
                            location
                        ) => {
                            if (
                                Platform.OS ===
                                    'android'
                            ) {
                                /*
                                 Android saves every accepted native point to
                                 LocationBuffer before emitting this event.

                                 Do not upload the newly emitted point by itself:
                                 immediately after unlocking it can otherwise
                                 overtake older locked-screen points that are
                                 still waiting in the native buffer, creating a
                                 straight last-unlocked -> first-unlocked line.

                                 Treat the event as a prompt to flush the whole
                                 buffer, which uploadPoints() sorts by timestamp
                                 before sending it to the bridge.
                                */
                                if (
                                    appStateRef
                                        .current ===
                                    'active'
                                ) {
                                    flushBufferedPoints();
                                }

                                return;
                            }

                            /*
                             Preserve the existing stable iOS behaviour.
                            */
                            uploadPoints([
                                location,
                            ]);
                        }
                    );
            } catch (error) {
                Alert.alert(
                    'Native GPS Error',
                    String(
                        error?.message ??
                        error
                    )
                );
            }

            return () => {
                try {
                    subscription
                        ?.remove();
                } catch (error) {
                    // Ignore cleanup error.
                }
            };
        },
        [
            flushBufferedPoints,
            uploadPoints,
        ]
    );

    useEffect(
        () => {
            const subscription =
                AppState.addEventListener(
                    'change',
                    (
                        nextState
                    ) => {
                        const previous =
                            appStateRef
                                .current;

                        appStateRef.current =
                            nextState;

                        if (
                            nextState ===
                                'active' &&
                            (
                                previous ===
                                    'background' ||
                                previous ===
                                    'inactive'
                            )
                        ) {
                            if (
                                Platform.OS ===
                                    'android'
                            ) {
                                /*
                                 Flush immediately on Android. The service has
                                 already buffered the locked-screen route, so
                                 waiting here gives a fresh unlock location a
                                 chance to arrive first.
                                */
                                flushBufferedPoints();
                            } else {
                                /*
                                 Keep the existing iOS timing unchanged.
                                */
                                setTimeout(
                                    flushBufferedPoints,
                                    750
                                );
                            }
                        }
                    }
                );

            return () => {
                subscription.remove();
            };
        },
        [
            flushBufferedPoints,
        ]
    );

    if (
        Platform.OS ===
            'ios' &&
        walkIntroState !==
            'hidden'
    ) {
        return (
            <WalkLocationIntroduction
                loading={
                    walkIntroState ===
                    'checking'
                }
                saving={
                    walkIntroState ===
                    'saving'
                }
                onContinue={
                    continueToWalkTracking
                }
            />
        );
    }

    return (
        <View
            style={{
                flex: 1,
            }}
        >
            {defaultComponent}
        </View>
    );
};


const postSearchPartyPosition = async (
    credentials,
    point
) => {
    const response = await fetch(
        SEARCH_PARTY_POSITION_URL,
        {
            method: 'POST',

            headers: {
                Accept:
                    'application/json',

                'Content-Type':
                    'application/json',
            },

            body: JSON.stringify({
                session_id:
                    credentials.sessionId,

                user_id:
                    credentials.userId,

                token:
                    credentials.token,

                lat:
                    point.lat,

                lng:
                    point.lng,

                accuracy:
                    point.accuracy,

                ts:
                    point.ts,
            }),
        }
    );

    let data = null;

    try {
        data = await response.json();
    } catch (error) {
        data = null;
    }

    if (
        !response.ok ||
        data?.success === false
    ) {
        throw new Error(
            data?.message ||
            data?.data ||
            `Search Party update failed: ${response.status}`
        );
    }

    return data;
};

const SearchPartyNativeSidecar = ({
    defaultComponent,
}) => {
    const [locationIntroState, setLocationIntroState] =
        useState(
            Platform.OS === 'ios'
                ? 'checking'
                : 'hidden'
        );

    const lastSearchCommandIdRef =
        useRef('');

    const credentialsRef =
        useRef(null);

    const trackingRef =
        useRef(false);

    const nativeDirectUploadRef =
        useRef(false);

    const uploadRunningRef =
        useRef(false);

    const flushRunningRef =
        useRef(false);

    const appStateRef =
        useRef(
            AppState.currentState
        );

    useEffect(
        () => {
            let cancelled =
                false;

            const checkLocationIntroduction =
                async () => {
                    if (
                        Platform.OS !==
                        'ios'
                    ) {
                        if (!cancelled) {
                            setLocationIntroState(
                                'hidden'
                            );
                        }

                        return;
                    }

                    if (
                        typeof BuddybossCustomCode
                            ?.hasSeenLocationIntro !==
                        'function'
                    ) {
                        /*
                         Fail open: show the explanation even if the
                         native saved-preference method is unavailable.
                        */
                        if (!cancelled) {
                            setLocationIntroState(
                                'visible'
                            );
                        }

                        return;
                    }

                    try {
                        const result =
                            await BuddybossCustomCode
                                .hasSeenLocationIntro();

                        if (!cancelled) {
                            setLocationIntroState(
                                result?.seen
                                    ? 'hidden'
                                    : 'visible'
                            );
                        }
                    } catch (error) {
                        /*
                         Do not silently skip the location explanation
                         if reading the saved preference fails.
                        */
                        if (!cancelled) {
                            setLocationIntroState(
                                'visible'
                            );
                        }
                    }
                };

            checkLocationIntroduction();

            return () => {
                cancelled =
                    true;
            };
        },
        []
    );

    const continueToSearchParty =
        useCallback(
            async () => {
                setLocationIntroState(
                    'saving'
                );

                try {
                    if (
                        typeof markLocationIntroSeenShared ===
                        'function'
                    ) {
                        /*
                         The existing native preference is deliberately
                         shared by map pages, Walk Tracking and Search Parties. Once
                         either screen is acknowledged, the introduction
                         is not shown again on the other feature.
                        */
                        await markLocationIntroSeenShared();
                    }
                } catch (error) {
                    /*
                     Do not prevent access to the Search Party if saving
                     the one-time preference fails.
                    */
                } finally {
                    setLocationIntroState(
                        'hidden'
                    );
                }
            },
            []
        );

    const acknowledgePoints =
        useCallback(
            async (
                points,
                sessionId
            ) => {
                const hasModeAwareAcknowledge =
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocationForMode ===
                    'function';

                const hasLegacyAcknowledge =
                    typeof BuddybossCustomCode
                        ?.acknowledgeLocation ===
                    'function';

                if (
                    !hasModeAwareAcknowledge &&
                    !hasLegacyAcknowledge
                ) {
                    return;
                }

                for (const point of points) {
                    if (point?.ts == null) {
                        continue;
                    }

                    try {
                        if (hasModeAwareAcknowledge) {
                            await BuddybossCustomCode
                                .acknowledgeLocationForMode(
                                    point.ts,
                                    'search_party',
                                    sessionId
                                );
                        } else {
                            await BuddybossCustomCode
                                .acknowledgeLocation(
                                    point.ts
                                );
                        }
                    } catch (error) {
                        /*
                         The point stays in the native buffer and will
                         be retried by the next flush.
                        */
                    }
                }
            },
            []
        );

    const uploadPoints =
        useCallback(
            async (rawPoints) => {
                const credentials =
                    credentialsRef.current;

                if (
                    uploadRunningRef.current ||
                    !credentials ||
                    !Array.isArray(rawPoints) ||
                    rawPoints.length === 0
                ) {
                    return false;
                }

                const points =
                    rawPoints
                        .map(
                            normaliseLocation
                        )
                        .filter(
                            (point) => {
                                if (!point) {
                                    return false;
                                }

                                if (
                                    point.trackingMode &&
                                    point.trackingMode !==
                                        'search_party'
                                ) {
                                    return false;
                                }

                                /*
                                 The current mode-aware native module tags
                                 every point. Only accept untagged points as
                                 a compatibility fallback for an older native
                                 module, preventing an old walk buffer from
                                 entering a Search Party.
                                */
                                if (
                                    !point.trackingMode &&
                                    typeof BuddybossCustomCode
                                        ?.startBackgroundTrackingForMode ===
                                        'function'
                                ) {
                                    return false;
                                }

                                if (
                                    point.sessionId > 0 &&
                                    point.sessionId !==
                                        credentials.sessionId
                                ) {
                                    return false;
                                }

                                return true;
                            }
                        )
                        .sort(
                            (a, b) =>
                                Number(a.ts || 0) -
                                Number(b.ts || 0)
                        )
                        .filter(
                            (point, index, sorted) => {
                                if (index === 0) {
                                    return true;
                                }

                                const previous =
                                    sorted[index - 1];

                                return !(
                                    Number(previous.ts || 0) ===
                                        Number(point.ts || 0) &&
                                    Number(previous.lat) ===
                                        Number(point.lat) &&
                                    Number(previous.lng) ===
                                        Number(point.lng)
                                );
                            }
                        );

                if (points.length === 0) {
                    return false;
                }

                uploadRunningRef.current =
                    true;

                const uploaded = [];

                try {
                    for (const point of points) {
                        await postSearchPartyPosition(
                            credentials,
                            point
                        );

                        uploaded.push(point);
                    }

                    if (uploaded.length > 0) {
                        await acknowledgePoints(
                            uploaded,
                            credentials.sessionId
                        );
                    }

                    return (
                        uploaded.length ===
                        points.length
                    );
                } catch (error) {
                    if (uploaded.length > 0) {
                        await acknowledgePoints(
                            uploaded,
                            credentials.sessionId
                        );
                    }

                    return false;
                } finally {
                    uploadRunningRef.current =
                        false;
                }
            },
            [
                acknowledgePoints,
            ]
        );

    const flushBufferedPoints =
        useCallback(
            async () => {
                if (
                    flushRunningRef.current ||
                    !credentialsRef.current ||
                    typeof BuddybossCustomCode
                        ?.getBufferedLocations !==
                        'function'
                ) {
                    return;
                }

                flushRunningRef.current =
                    true;

                try {
                    const buffered =
                        await BuddybossCustomCode
                            .getBufferedLocations();

                    if (
                        Array.isArray(buffered) &&
                        buffered.length > 0
                    ) {
                        await uploadPoints(
                            buffered
                        );
                    }
                } catch (error) {
                    /*
                     Native Search Party points remain buffered.
                    */
                } finally {
                    flushRunningRef.current =
                        false;
                }
            },
            [
                uploadPoints,
            ]
        );

    const stopNativeSearchTracking =
        useCallback(
            async () => {
                await flushBufferedPoints();

                try {
                    if (
                        typeof BuddybossCustomCode
                            ?.stopBackgroundTracking ===
                        'function'
                    ) {
                        await BuddybossCustomCode
                            .stopBackgroundTracking();
                    }
                } catch (error) {
                    /*
                     Keep the web page responsive even if native stop fails.
                    */
                }

                await flushBufferedPoints();

                trackingRef.current =
                    false;

                nativeDirectUploadRef.current =
                    false;

                credentialsRef.current =
                    null;
            },
            [
                flushBufferedPoints,
            ]
        );

    const showSearchPermissionAlert =
        useCallback(
            () => {
                Alert.alert(
                    'Location permission needed',
                    [
                        'Skedoggle needs location access while you are helping with a Search Party.',
                        '',
                        'Open Settings, select While Using the App, and make sure Precise Location is on.'
                    ].join('\n'),
                    [
                        {
                            text:
                                'Cancel',
                            style:
                                'cancel'
                        },
                        {
                            text:
                                'Open Settings',
                            onPress:
                                () => {
                                    Linking
                                        .openSettings();
                                }
                        }
                    ]
                );
            },
            []
        );

    const startNativeSearchTracking =
        useCallback(
            async (message) => {
                const sessionId =
                    Number(
                        message?.sessionId ??
                        message?.session_id
                    );

                const userId =
                    Number(
                        message?.userId ??
                        message?.user_id
                    );

                const token =
                    String(
                        message?.token ||
                        ''
                    );

                if (
                    !Number.isInteger(sessionId) ||
                    sessionId <= 0 ||
                    !Number.isInteger(userId) ||
                    userId <= 0 ||
                    !token
                ) {
                    Alert.alert(
                        'Search Party tracking error',
                        'Skedoggle could not securely start Search Party tracking. Leave the Search Party and join it again.'
                    );

                    return;
                }

                const previousCredentials =
                    credentialsRef.current;

                credentialsRef.current = {
                    sessionId,
                    userId,
                    token,
                };

                /*
                 Upload any points left by the same Search Party before
                 starting or resuming the native location manager.
                */
                await flushBufferedPoints();

                if (
                    trackingRef.current &&
                    previousCredentials
                        ?.sessionId ===
                        sessionId
                ) {
                    return;
                }

                try {
                    let androidPermissions =
                        null;

                    if (
                        Platform.OS ===
                        'android'
                    ) {
                        androidPermissions =
                            await requestAndroidWalkPermissions();

                        if (
                            !androidPermissions
                                .locationGranted
                        ) {
                            trackingRef.current =
                                false;

                            showSearchPermissionAlert();
                            return;
                        }
                    }

                    let result = null;

                    if (
                        typeof BuddybossCustomCode
                            ?.startSearchPartyTracking ===
                        'function'
                    ) {
                        result =
                            await BuddybossCustomCode
                                .startSearchPartyTracking(
                                    sessionId,
                                    userId,
                                    token
                                );
                    } else if (
                        typeof BuddybossCustomCode
                            ?.startBackgroundTrackingForMode ===
                        'function'
                    ) {
                        result =
                            await BuddybossCustomCode
                                .startBackgroundTrackingForMode(
                                    'search_party',
                                    sessionId
                                );
                    } else if (
                        typeof BuddybossCustomCode
                            ?.startBackgroundTracking ===
                        'function'
                    ) {
                        /*
                         Compatibility fallback for an older Android
                         native module. The current iOS module supports
                         the mode-aware method above.
                        */
                        result =
                            await BuddybossCustomCode
                                .startBackgroundTracking();
                    } else {
                        throw new Error(
                            'Native background tracking is unavailable.'
                        );
                    }

                    trackingRef.current =
                        true;

                    nativeDirectUploadRef.current =
                        Boolean(
                            result
                                ?.nativeDirectUpload
                        );

                    if (
                        Platform.OS ===
                        'ios'
                    ) {
                        const permissionStatus =
                            Number(
                                result
                                    ?.authorizationStatus
                            );

                        const locationGranted =
                            permissionStatus === 3 ||
                            permissionStatus === 4;

                        const preciseLocationEnabled =
                            result
                                ?.preciseLocationEnabled !==
                            false;

                        if (!locationGranted) {
                            trackingRef.current =
                                false;

                            showSearchPermissionAlert();
                        } else if (
                            !preciseLocationEnabled
                        ) {
                            Alert.alert(
                                'Precise Location is off',
                                [
                                    'Search Parties need precise location so other helpers can see which areas have been searched.',
                                    '',
                                    'Please make sure Precise Location is on in Skedoggle’s Location Settings.'
                                ].join('\n'),
                                [
                                    {
                                        text:
                                            'Continue Anyway',
                                        style:
                                            'cancel'
                                    },
                                    {
                                        text:
                                            'Open Settings',
                                        onPress:
                                            () => {
                                                Linking
                                                    .openSettings();
                                            }
                                    }
                                ]
                            );
                        }
                    } else if (
                        Platform.OS ===
                        'android'
                    ) {
                        const preciseLocation =
                            Boolean(
                                result
                                    ?.fineLocationGranted ??
                                androidPermissions
                                    ?.fineLocationGranted
                            );

                        if (!preciseLocation) {
                            Alert.alert(
                                'Precise Location is off',
                                'For an accurate shared search map, open Settings and enable precise location for Skedoggle.',
                                [
                                    {
                                        text:
                                            'Continue Anyway',
                                        style:
                                            'cancel'
                                    },
                                    {
                                        text:
                                            'Open Settings',
                                        onPress:
                                            () => {
                                                Linking
                                                    .openSettings();
                                            }
                                    }
                                ]
                            );
                        }
                    }

                    await flushBufferedPoints();
                } catch (error) {
                    trackingRef.current =
                        false;

                    nativeDirectUploadRef.current =
                        false;

                    const errorCode =
                        String(
                            error?.code ||
                            ''
                        );

                    if (
                        errorCode ===
                            'location_permission_denied' ||
                        errorCode ===
                            'location_permission_unavailable'
                    ) {
                        showSearchPermissionAlert();
                    } else {
                        Alert.alert(
                            'Search Party GPS error',
                            String(
                                error?.message ??
                                error
                            )
                        );
                    }
                }
            },
            [
                flushBufferedPoints,
                showSearchPermissionAlert,
            ]
        );

    const handleWebViewMessage =
        useCallback(
            (event) => {
                const rawData =
                    event?.nativeEvent?.data;

                let message =
                    rawData;

                if (
                    typeof rawData ===
                    'string'
                ) {
                    try {
                        message =
                            JSON.parse(rawData);
                    } catch (error) {
                        return;
                    }
                }

                const action =
                    message?.action;

                if (
                    action ===
                        'startSearchPartyTracking'
                ) {
                    startNativeSearchTracking(
                        message
                    );
                }

                if (
                    action ===
                        'stopSearchPartyTracking'
                ) {
                    stopNativeSearchTracking();
                }
            },
            [
                startNativeSearchTracking,
                stopNativeSearchTracking,
            ]
        );

    useEffect(
        () => {
            let cancelled = false;

            const acknowledgeSearchCommand =
                async (commandId) => {
                    try {
                        await postToBridge({
                            action:
                                'ack_command',

                            tracking_mode:
                                'search_party',

                            command_id:
                                commandId,
                        });
                    } catch (error) {
                        /* The next poll can retry. */
                    }
                };

            const processSearchCommand =
                async (commandData) => {
                    const command =
                        commandData?.command;

                    const commandId =
                        String(
                            commandData?.command_id ||
                            ''
                        );

                    if (
                        !command ||
                        !commandId ||
                        commandId ===
                            lastSearchCommandIdRef.current
                    ) {
                        return;
                    }

                    lastSearchCommandIdRef.current =
                        commandId;

                    try {
                        if (command === 'start') {
                            await startNativeSearchTracking({
                                sessionId:
                                    Number(
                                        commandData?.session_id
                                    ),

                                userId:
                                    Number(
                                        commandData?.user_id
                                    ),

                                token:
                                    String(
                                        commandData?.token ||
                                        ''
                                    ),
                            });
                        }

                        if (command === 'stop') {
                            await stopNativeSearchTracking();
                        }
                    } finally {
                        await acknowledgeSearchCommand(
                            commandId
                        );
                    }
                };

            const poll = async () => {
                try {
                    const command =
                        await fetchSearchPartyCommand();

                    if (!cancelled) {
                        await processSearchCommand(
                            command
                        );
                    }
                } catch (error) {
                    /* A later poll retries. */
                }
            };

            poll();

            const timer =
                setInterval(
                    poll,
                    1000
                );

            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        },
        [
            startNativeSearchTracking,
            stopNativeSearchTracking,
        ]
    );

    useEffect(
        () => {
            if (
                (
                    Platform.OS !==
                        'ios' &&
                    Platform.OS !==
                        'android'
                ) ||
                !BuddybossCustomCode
            ) {
                return undefined;
            }

            let subscription = null;

            try {
                const emitter =
                    new NativeEventEmitter(
                        BuddybossCustomCode
                    );

                subscription =
                    emitter.addListener(
                        'SkedoggleLocation',
                        (location) => {
                            if (
                                trackingRef.current &&
                                credentialsRef.current
                            ) {
                                /*
                                 Forward native points immediately while the
                                 React Native app is active. The Objective-C
                                 module also uploads the same native points
                                 directly so tracking continues while the
                                 screen is locked. The Search Party endpoint
                                 rejects duplicate timestamp/coordinate pairs.
                                */
                                uploadPoints([
                                    location,
                                ]);
                            }
                        }
                    );
            } catch (error) {
                Alert.alert(
                    'Search Party GPS error',
                    String(
                        error?.message ??
                        error
                    )
                );
            }

            return () => {
                try {
                    subscription
                        ?.remove();
                } catch (error) {
                    // Ignore cleanup error.
                }
            };
        },
        [
            uploadPoints,
        ]
    );

    useEffect(
        () => {
            const timer =
                setInterval(
                    () => {
                        flushBufferedPoints();
                    },
                    2000
                );

            return () => {
                clearInterval(timer);
            };
        },
        [
            flushBufferedPoints,
        ]
    );

    useEffect(
        () => {
            const subscription =
                AppState.addEventListener(
                    'change',
                    (nextState) => {
                        const previous =
                            appStateRef.current;

                        appStateRef.current =
                            nextState;

                        if (
                            nextState ===
                                'active' &&
                            (
                                previous ===
                                    'background' ||
                                previous ===
                                    'inactive'
                            )
                        ) {
                            setTimeout(
                                flushBufferedPoints,
                                750
                            );
                        }
                    }
                );

            return () => {
                subscription.remove();
            };
        },
        [
            flushBufferedPoints,
        ]
    );

    useEffect(
        () => {
            searchPartyWebViewMessageHandler =
                handleWebViewMessage;

            return () => {
                if (
                    searchPartyWebViewMessageHandler ===
                    handleWebViewMessage
                ) {
                    searchPartyWebViewMessageHandler =
                        null;
                }
            };
        },
        [
            handleWebViewMessage,
        ]
    );

    if (
        Platform.OS ===
            'ios' &&
        locationIntroState !==
            'hidden'
    ) {
        return (
            <WalkLocationIntroduction
                loading={
                    locationIntroState ===
                    'checking'
                }
                saving={
                    locationIntroState ===
                    'saving'
                }
                onContinue={
                    continueToSearchParty
                }
            />
        );
    }

    return (
        <View
            style={{
                flex: 1,
            }}
        >
            {defaultComponent}
        </View>
    );
};

const styles = StyleSheet.create({
    introSafeArea: {
        flex: 1,
        backgroundColor:
            '#ffffff',
    },

    introContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 36,
        paddingBottom: 28,
        justifyContent:
            'center',
    },

    introPawCircle: {
        width: 78,
        height: 78,
        borderRadius: 39,
        alignItems:
            'center',
        justifyContent:
            'center',
        alignSelf:
            'center',
        backgroundColor:
            '#f8e7f4',
        marginBottom: 22,
    },

    introPaw: {
        fontSize: 38,
    },

    introTitle: {
        color:
            '#261e8c',
        fontSize: 29,
        fontWeight:
            '700',
        lineHeight: 35,
        textAlign:
            'center',
        marginBottom: 14,
    },

    introLead: {
        color:
            '#3f3f46',
        fontSize: 17,
        lineHeight: 25,
        textAlign:
            'center',
        marginBottom: 24,
    },

    introCard: {
        backgroundColor:
            '#f7f7fa',
        borderRadius: 16,
        paddingHorizontal: 18,
        paddingVertical: 16,
        marginBottom: 12,
    },

    introCardTitle: {
        color:
            '#261e8c',
        fontSize: 17,
        fontWeight:
            '700',
        marginBottom: 6,
    },

    introCardText: {
        color:
            '#52525b',
        fontSize: 15,
        lineHeight: 22,
    },

    introLoading: {
        minHeight: 62,
        alignItems:
            'center',
        justifyContent:
            'center',
        marginTop: 14,
    },

    introButton: {
        minHeight: 56,
        borderRadius: 28,
        backgroundColor:
            '#d622a6',
        alignItems:
            'center',
        justifyContent:
            'center',
        paddingHorizontal: 22,
        marginTop: 16,
    },

    introButtonDisabled: {
        opacity: 0.7,
    },

    introButtonText: {
        color:
            '#ffffff',
        fontSize: 17,
        fontWeight:
            '700',
        textAlign:
            'center',
    },

    introFooter: {
        color:
            '#71717a',
        fontSize: 13,
        lineHeight: 19,
        textAlign:
            'center',
        marginTop: 16,
    },

    nearbyActivityContainer: {
        backgroundColor:
            '#ffffff',
        marginBottom:
            10,
        borderTopWidth:
            StyleSheet.hairlineWidth,
        borderBottomWidth:
            StyleSheet.hairlineWidth,
        borderColor:
            '#e5e7eb',
        paddingTop:
            12,
        paddingBottom:
            10,
    },

    nearbyActivityHeading: {
        color:
            '#261e8c',
        fontSize:
            15,
        fontWeight:
            '700',
        textAlign:
            'center',
        paddingHorizontal:
            16,
        marginBottom:
            9,
    },

    nearbyActivityOptions: {
        paddingHorizontal:
            12,
        paddingBottom:
            4,
    },

    nearbyActivityOption: {
        minHeight:
            38,
        justifyContent:
            'center',
        alignItems:
            'center',
        borderRadius:
            19,
        borderWidth:
            1,
        borderColor:
            '#d6d6dc',
        backgroundColor:
            '#ffffff',
        paddingHorizontal:
            16,
        marginHorizontal:
            4,
    },

    nearbyActivityOptionSelected: {
        borderColor:
            '#d622a6',
        backgroundColor:
            '#d622a6',
    },

    nearbyActivityOptionDisabled: {
        opacity:
            0.55,
    },

    nearbyActivityOptionText: {
        color:
            '#3f3f46',
        fontSize:
            14,
        fontWeight:
            '600',
    },

    nearbyActivityOptionTextSelected: {
        color:
            '#ffffff',
    },

    nearbyActivityNote: {
        color:
            '#71717a',
        fontSize:
            12,
        lineHeight:
            17,
        textAlign:
            'center',
        paddingHorizontal:
            16,
        marginTop:
            0,
        marginBottom:
            8,
    },

    nearbyActivityPostcodeLink: {
        color:
            '#d622a6',
        fontWeight:
            '700',
        textDecorationLine:
            'underline',
    },

    nearbyActivityDividerWrap: {
        flexDirection:
            'row',
        alignItems:
            'center',
        paddingHorizontal:
            18,
        paddingTop:
            8,
        paddingBottom:
            2,
    },

    nearbyActivityDividerLine: {
        flex:
            1,
        height:
            StyleSheet.hairlineWidth,
        backgroundColor:
            '#e5e7eb',
    },

    nearbyActivityDividerPawCircle: {
        width:
            34,
        height:
            34,
        borderRadius:
            17,
        alignItems:
            'center',
        justifyContent:
            'center',
        backgroundColor:
            '#f8e7f4',
        marginHorizontal:
            12,
    },

    nearbyActivityDividerPaw: {
        fontSize:
            17,
    },
});

export const applyCustomCode = (
    externalCodeSetup
) => {
    if (installed) {
        return;
    }

    installed = true;

    const navigationApi =
        externalCodeSetup
            ?.navigationApi;

    if (
        navigationApi &&
        typeof navigationApi
            .addNavigatorCreatedCallback ===
            'function'
    ) {
        navigationApi
            .addNavigatorCreatedCallback(
                (navigator) => {
                    buddyBossRootNavigation =
                        navigator;
                }
            );
    }

    /*
     Daily Woof is BuddyBoss's native Activity Feed screen, not a WordPress
     PageScreen. Mount Skedoggle's additions before the first activity instead
     of inside BuddyBoss's fixed Activity header.
    */
    const activitiesApi =
        externalCodeSetup
            ?.activitiesScreenApi;

    if (
        activitiesApi &&
        typeof activitiesApi
            .setFetchParamsFilter ===
            'function'
    ) {
        /*
         BuddyBoss applies this function to the initial Activity request,
         pull-to-refresh and subsequent pagination requests.
        */
        activitiesApi
            .setFetchParamsFilter(
                (params) => {
                    const incomingParams = {
                        ...(
                            params ||
                            {}
                        ),
                    };

                    const isRadiusRefresh =
                        nearbyActivityRadiusRefreshPending;

                    /*
                     A normal BuddyBoss request is the authoritative current
                     filter state. This includes manual Topic / Activity Type
                     changes, search changes, pull-to-refresh and the initial
                     feed request.

                     Replace the snapshot rather than adding to it, so choosing
                     All Topics / All Types automatically clears any previous
                     Dog Walk selection.
                    */
                    if (!isRadiusRefresh) {
                        captureNearbyActivityManualFetchParams(
                            incomingParams
                        );
                    }

                    /*
                     Radius-button requests created through activitiesRequested()
                     do not always reproduce Topic parameters even though the
                     BuddyBoss UI still shows that Topic selected.

                     For those requests only, use the last CURRENT manual
                     BuddyBoss filter state as fallback data. The fresh
                     incoming request wins for every parameter it does contain.
                    */
                    const nextParams =
                        isRadiusRefresh
                            ? {
                                  ...nearbyActivityManualFetchParams,
                                  ...incomingParams,
                              }
                            : incomingParams;

                    /*
                     Consume the marker immediately so no later BuddyBoss
                     request is mistaken for the radius refresh.
                    */
                    nearbyActivityRadiusRefreshPending =
                        false;

                    /*
                     Always send an explicit radius. Radius 0 means All Areas.

                     The generation changes whenever the member presses a
                     radius button so BuddyBoss does not reuse the previous
                     radius result as a cached request.
                    */
                    nextParams
                        .skedoggle_radius =
                        nearbyActivityRadius;

                    nextParams
                        .skedoggle_radius_generation =
                        nearbyActivityRequestGeneration;

                    return nextParams;
                }
            );
    }

    /*
     Keep BuddyBoss's native Activity header completely intact.

     The nearby controls previously used the filter-screen "after filter"
     position. On the Activity screen that placement can interfere with/clamp
     the native header area, including BuddyBoss's search and composer controls.

     BuddyBoss provides indexScreenApiHooks.setAfterHeaderComponent() for
     content that belongs immediately AFTER the list screen's own header.
     This gives Skedoggle a stable mount point even when the Activity result
     set is empty, without replacing or modifying the native header itself.
    */
    const indexScreenApi =
        externalCodeSetup
            ?.indexScreenApiHooks;

    if (
        indexScreenApi &&
        typeof indexScreenApi
            .setAfterHeaderComponent ===
            'function'
    ) {
        indexScreenApi
            .setAfterHeaderComponent(
                (hookProps) => {
                    /*
                     BuddyBoss documents AfterHeaderComponentProps as wrapping
                     the normal filter/screen props in a `props` property.
                     Keep a direct-props fallback for compatibility with
                     different app builds.
                    */
                    const activityProps =
                        hookProps
                            ?.props ||
                        hookProps ||
                        {};

                    if (
                        !isMainActivitiesFilterScreen(
                            activityProps
                        )
                    ) {
                        return null;
                    }

                    return (
                        <View>
                            <DailyWoofLocationIntroduction />

                            <NearbyActivityRadiusFilter
                                {...activityProps}
                            />
                        </View>
                    );
                }
            );
    }

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
        (
            props,
            Component
        ) => {
            const pageUrl =
                getPageUrl(props);

            /*
             Track Walk and Search Party keep the same shared introduction
             as a fallback and also mount their native GPS sidecars.

             Daily Woof is a native Activity Feed screen, so its introduction
             is registered through activitiesScreenApi below rather than through
             PageScreen URL matching. Map pages are deliberately left untouched
             so their existing WebView geolocation behaviour is not altered.
            */
            if (
                isWalkTrackerUrl(
                    pageUrl
                )
            ) {
                return React.createElement(
                    WalkNativeSidecar,
                    {
                        defaultComponent:
                            Component,
                    }
                );
            }

            if (
                isSearchPartyUrl(
                    pageUrl
                )
            ) {
                return React.createElement(
                    SearchPartyNativeSidecar,
                    {
                        defaultComponent:
                            Component,
                    }
                );
            }

            return Component;
        }
    );
};
