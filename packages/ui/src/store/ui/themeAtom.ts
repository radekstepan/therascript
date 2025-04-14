import { atomWithStorage } from 'jotai/utils';

// TODO enum, export from here or include in types
export type Theme = 'light' | 'dark' | 'system';
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');
