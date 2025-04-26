/*
 * packages/ui/src/store/standaloneChatSortDirectionAtom.ts
 * State for the direction of standalone chat sorting.
 */
import { atomWithStorage } from 'jotai/utils';
// --- FIX: Explicitly add .ts extension to the import path ---
import type { SortDirection } from './session/sessionSortDirectionAtom.ts';
// --- END FIX ---

// Atom to store the current sort direction, persisted in localStorage
export const standaloneChatSortDirectionAtom = atomWithStorage<SortDirection>('standalone-chat-sort-direction', 'desc');

// TODO comments should not be removed