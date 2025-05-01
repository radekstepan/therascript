// Purpose: Defines a Jotai atom with storage to manage the user's selected
//          UI theme preference ('light', 'dark', or 'system').
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

// Define the possible theme preference values.
export type Theme = 'light' | 'dark' | 'system';

/**
 * Atom storing the user's theme preference.
 * - 'light': Force light theme.
 * - 'dark': Force dark theme.
 * - 'system': Use the operating system's preferred color scheme.
 * - Persisted in localStorage under the key 'ui-theme'.
 * - Defaults to 'system' if no value is found in storage.
 */
export const themeAtom = atomWithStorage<Theme>(
  'ui-theme', // localStorage key
  'system' // Default value
);
