import React from 'react';

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

    /*
     BuddyBoss invokes this function as its PageRenderer.

     Component is BuddyBoss's already-rendered normal page content.
     Return it unchanged for every page except Track Walk.
    */
    pageApi.setPageComponent(
        (props, Component) => {
            const pageUrl =
                getPageUrl(props);

            if (
                !isWalkTrackerUrl(
                    pageUrl
                )
            ) {
                return Component;
            }

            /*
             Create a real React element.

             React now renders SkedogglePageComponent, so its hooks
             are called legally inside the component lifecycle.
            */
            return React.createElement(
                SkedogglePageComponent,
                props
            );
        }
    );
};
