import { atomWithStorage } from 'jotai/utils';

// --- Theme Atom ---
// Keep type here
export type Theme = 'light' | 'dark' | 'system';
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');
