// packages/ui/src/store/ui/accentColorAtom.ts
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import type { Theme as RadixThemeRoot } from '@radix-ui/themes';

// Define the type for Radix UI accent colors
// This list is based on common Radix accent colors.
// Refer to Radix documentation for the most up-to-date list if needed.
export const RADIX_ACCENT_COLORS = [
  'gray',
  'gold',
  'bronze',
  'brown',
  'yellow',
  'amber',
  'orange',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'lime',
  'mint',
  'sky',
] as const;

export type RadixAccentColor = (typeof RADIX_ACCENT_COLORS)[number];

// Type guard for RadixAccentColor
export function isRadixAccentColor(value: string): value is RadixAccentColor {
  return RADIX_ACCENT_COLORS.includes(value as RadixAccentColor);
}

// Define the type for the accentColor prop of RadixTheme
// It can be one of the RadixAccentColor strings.
export type AccentColorValue = React.ComponentProps<
  typeof RadixThemeRoot
>['accentColor'];

// Jotai atom with localStorage persistence
const storage = createJSONStorage<AccentColorValue>(() => localStorage);

export const accentColorAtom = atomWithStorage<AccentColorValue>(
  'ui-accent-color', // localStorage key
  'teal', // Default accent color
  storage
);
