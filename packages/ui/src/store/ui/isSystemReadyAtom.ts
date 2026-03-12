// packages/ui/src/store/ui/isSystemReadyAtom.ts
import { atom } from 'jotai';

// Start as true — the overlay only appears if the API explicitly reports ready:false.
// This prevents the spinner blocking the UI during the initial fetch.
export const isSystemReadyAtom = atom(true);
