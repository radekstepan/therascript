// Purpose: Defines a derived Jotai atom that resolves the user's theme preference
//          ('light', 'dark', or 'system') into the actual theme ('light' or 'dark')
//          that should be applied to the UI.
import { atom } from 'jotai'; // Import base atom function
import { themeAtom, type Theme } from '..'; // Import the base theme preference atom and its type

/**
 * A derived Jotai atom that determines the *effective* UI theme ('light' or 'dark').
 *
 * It reads the user's preference from `themeAtom`.
 * If the preference is 'light' or 'dark', it returns that value directly.
 * If the preference is 'system', it checks the operating system's preferred color scheme
 * using `window.matchMedia('(prefers-color-scheme: dark)')` and returns 'dark' or 'light' accordingly.
 *
 * Provides a fallback ('light') if `window.matchMedia` is unavailable (e.g., during SSR).
 */
export const effectiveThemeAtom = atom<Exclude<Theme, 'system'>>((get) => {
    // Get the user's theme preference ('light', 'dark', or 'system')
    const theme = get(themeAtom);

    if (theme === 'system') {
        // Resolve 'system' preference based on OS setting
        // Ensure this code runs only in a browser environment where window.matchMedia exists
        if (typeof window !== 'undefined' && window.matchMedia) {
            // Check if the OS prefers dark mode
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        // Fallback for environments without window.matchMedia (e.g., server-side rendering)
        return 'light'; // Default to light theme if system preference cannot be determined
    }

    // If theme is 'light' or 'dark', return it directly
    return theme;
});
