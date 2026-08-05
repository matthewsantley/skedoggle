Library
/
index.txt


/**
 * Skedoggle — absolute minimal BuddyBoss diagnostic
 *
 * This deliberately installs no custom hooks or components.
 * It is intended only to establish whether the startup crash comes from
 * index.js custom code or from the native/BuddyBoss build.
 */

export const applyCustomCode = (
    externalCodeSetup
) => {
    // Intentionally empty.
};
