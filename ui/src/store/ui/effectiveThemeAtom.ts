import { atom } from 'jotai';
import { themeAtom, type Theme } from '..';

// Derived atom to get the *effective* theme (resolving 'system')
// TODO use enums
export const effectiveThemeAtom = atom<Exclude<Theme, 'system'>>((get) => {
    const theme = get(themeAtom);
    if (theme === 'system') {
        // Ensure this runs only in the browser environment
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        // Default fallback for server-side rendering or environments without matchMedia
        return 'light';
    }
    return theme;
});
