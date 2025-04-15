import { atom } from 'jotai';

// Keep for local, non-fetch/mutation related errors (e.g., input validation) if needed.
export const chatErrorAtom = atom('');
