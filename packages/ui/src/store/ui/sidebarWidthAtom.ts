// Purpose: Defines a Jotai atom with storage to manage the user-resizable
//          width of the sidebar in views like SessionView and StandaloneChatView.
//          Also exports constants for min, max, and default widths.
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

// --- Sidebar Width Constants ---
export const MIN_SIDEBAR_WIDTH = 200; // Minimum allowed width in pixels
export const MAX_SIDEBAR_WIDTH = 500; // Maximum allowed width in pixels
export const DEFAULT_SIDEBAR_WIDTH = 256; // Initial default width in pixels
// --- End Constants ---

/**
 * Atom storing the current width of the resizable sidebar.
 * - Persisted in localStorage under the key 'session-sidebar-width'.
 * - Defaults to `DEFAULT_SIDEBAR_WIDTH` if no value is found in storage.
 * - Note: This value might be outside the min/max bounds if set directly or loaded
 *   from storage before clamping logic existed. Use `clampedSidebarWidthAtom` for
 *   a guaranteed valid width for rendering.
 */
export const sidebarWidthAtom = atomWithStorage<number>(
    'session-sidebar-width', // localStorage key
    DEFAULT_SIDEBAR_WIDTH    // Default value
);
