import { atom } from 'jotai';

// Holds the message for the next toast to show. Null means no toast.
export const toastMessageAtom = atom<string | null>(null);
