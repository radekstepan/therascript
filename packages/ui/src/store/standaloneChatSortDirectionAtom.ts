/*
 * Purpose: Defines a Jotai atom with storage to manage the current sort direction
 *          (ascending or descending) for the standalone chat list.
 */
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage
// Import the SortDirection type (asc/desc) defined elsewhere
import type { SortDirection } from './session/sessionSortDirectionAtom.ts';

/**
 * Atom storing the current sort direction for the standalone chat list.
 * - Persisted in localStorage under the key 'standalone-chat-sort-direction'.
 * - Defaults to 'desc' (descending). Note that the default sort criteria is 'date',
 *   so the default overall sort is newest chats first.
 */
export const standaloneChatSortDirectionAtom = atomWithStorage<SortDirection>(
  'standalone-chat-sort-direction', // localStorage key
  'desc' // Default value
);
