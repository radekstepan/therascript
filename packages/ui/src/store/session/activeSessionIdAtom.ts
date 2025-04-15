import { atom } from 'jotai';

/**
 * Atom holding the ID of the currently active/selected therapy session,
 * or null if no session is active.
 */
export const activeSessionIdAtom = atom<number | null>(null);
