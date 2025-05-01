/*
 * Purpose: Defines a Jotai atom with storage to manage the currently selected
 *          sorting criteria for the standalone chat list on the landing page.
 */
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

// Define the possible columns/criteria by which the standalone chat list can be sorted.
export type StandaloneChatSortCriteria = 'name' | 'date' | 'tags';

/**
 * Atom storing the current sort criteria for the standalone chat list.
 * - Persisted in localStorage under the key 'standalone-chat-sort-criteria'.
 * - Defaults to 'date' if no value is found in storage.
 */
export const standaloneChatSortCriteriaAtom =
  atomWithStorage<StandaloneChatSortCriteria>(
    'standalone-chat-sort-criteria', // localStorage key
    'date' // Default value
  );
