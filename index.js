import SkedogglePageComponent
    from './components/SkedogglePageComponent';

let installed = false;

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
     IMPORTANT:

     setPageComponent expects a React component type.

     Do not call the component here and do not use a callback that
     returns BuddyBoss's existing component value.
    */
    pageApi.setPageComponent(
        SkedogglePageComponent
    );
};
