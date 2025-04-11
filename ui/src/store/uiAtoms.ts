import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

// --- Constants ---
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256;

// --- Base Atoms ---
export const sidebarWidthAtom = atomWithStorage<number>('session-sidebar-width', DEFAULT_SIDEBAR_WIDTH);
export type Theme = 'light' | 'dark' | 'system';
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');
export const isUploadModalOpenAtom = atom(false);
export const isTranscribingAtom = atom(false);
export const transcriptionErrorAtom = atom(''); // Specific to upload/transcription process
export const toastMessageAtom = atom<string | null>(null); // Generic toast message

// --- Derived Atoms ---
export const clampedSidebarWidthAtom = atom(
    (get) => {
        const width = get(sidebarWidthAtom);
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    (get, set, newWidth: number) => {
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        set(sidebarWidthAtom, clampedWidth);
    }
);

export const effectiveThemeAtom = atom<Exclude<Theme, 'system'>>((get) => {
    const theme = get(themeAtom);
    if (theme === 'system') {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light'; // Default fallback
    }
    return theme;
});
