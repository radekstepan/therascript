import { atom } from 'jotai';

/**
 * Atom holding the ID of the currently active/selected chat session,
 * or null if no chat is active.
 */
export const activeChatIdAtom = atom<number | null>(null);
