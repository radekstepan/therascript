// packages/ui/src/store/ui/isPersistentSidebarOpenAtom.ts
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

// Default to true for larger screens, will be overridden by responsive logic in App.tsx
const getInitialSidebarOpen = (): boolean => {
  if (typeof window !== 'undefined') {
    return window.innerWidth >= 768;
  }
  return true; // Default for SSR or non-browser environments
};

// Use atomWithStorage to persist the user's preference
// We use a custom storage that only retrieves the value on first read in the client
// to ensure the initial server render matches and then client hydrates with persisted state.
const storage = createJSONStorage<boolean>(() => localStorage);

export const isPersistentSidebarOpenAtom = atomWithStorage<boolean>(
  'persistentSidebarOpen', // LocalStorage key
  getInitialSidebarOpen(), // Initial value
  storage
);
