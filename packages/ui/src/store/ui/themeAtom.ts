// packages/ui/src/store/ui/themeAtom.ts
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

export type Theme = 'light' | 'dark' | 'system';

const storage = createJSONStorage<Theme>(() => localStorage);

export const themeAtom = atomWithStorage<Theme>(
  'ui-theme',
  'system', // Default value
  storage
);
