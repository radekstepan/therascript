// Purpose: Defines a derived Jotai atom that provides a clamped version
//          of the sidebar width, ensuring it stays within defined min/max limits.
//          Also allows setting the width, applying clamping before updating the base atom.
import { atom } from 'jotai'; // Import base atom function
import {
    sidebarWidthAtom,     // The base atom holding the potentially unclamped width
    MIN_SIDEBAR_WIDTH,    // Minimum allowed width constant
    MAX_SIDEBAR_WIDTH     // Maximum allowed width constant
} from '..'; // Import base atom and constants from the store's index

/**
 * A derived Jotai atom representing the sidebar width, clamped between
 * MIN_SIDEBAR_WIDTH and MAX_SIDEBAR_WIDTH.
 *
 * Read: Returns the value of `sidebarWidthAtom` clamped within the defined bounds.
 * Write: Takes a new width value, clamps it, and then sets the base `sidebarWidthAtom`
 *        with the clamped value. This ensures the stored value is always valid.
 */
export const clampedSidebarWidthAtom = atom(
    // Read function: Gets the base width and clamps it
    (get) => {
        const width = get(sidebarWidthAtom); // Get the raw width from the base atom
        // Clamp the width between the minimum and maximum allowed values
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    // Write function: Takes a new width, clamps it, and updates the base atom
    (_get, set, newWidth: number) => {
        // Clamp the incoming new width value
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        // Set the base atom (`sidebarWidthAtom`) with the clamped value
        set(sidebarWidthAtom, clampedWidth);
    }
);
