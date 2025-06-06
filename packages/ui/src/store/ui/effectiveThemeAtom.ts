// packages/ui/src/store/ui/effectiveThemeAtom.ts
import { atom } from 'jotai';
import { themeAtom, type Theme } from './themeAtom'; // Import from the corrected themeAtom.ts

export const effectiveThemeAtom = atom<'light' | 'dark'>((get) => {
  const currentTheme = get(themeAtom);
  if (currentTheme === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return 'light'; // Default for SSR or if matchMedia is not available
  }
  // If theme is 'light' or 'dark', return it directly
  return currentTheme;
});
