// src/store/uiAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

// --- Constants for Sidebar Width ---
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256;

// --- Sidebar Width Atom ---
export const sidebarWidthAtom = atomWithStorage<number>('session-sidebar-width', DEFAULT_SIDEBAR_WIDTH);

// --- Theme Atom ---
export type Theme = 'light' | 'dark' | 'system'; // Export Theme type
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');

// --- Upload Modal State Atoms ---
export const isUploadModalOpenAtom = atom(false);
export const isTranscribingAtom = atom(false);
export const transcriptionErrorAtom = atom('');

// --- Derived Atoms ---
export const clampedSidebarWidthAtom = atom(
    (get) => {
        const width = get(sidebarWidthAtom);
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    (get, set, newWidth: number) => {
        // Clamp the value before setting the base atom
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        set(sidebarWidthAtom, clampedWidth);
    }
);


// Derived atom to get the *effective* theme (resolving 'system')
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
