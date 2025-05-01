/*
 * Purpose: Defines a Jotai write-only atom to handle updates to the
 *          sorting state (criteria and direction) for the standalone chat list.
 */
import { atom } from 'jotai'; // Import the base atom function from Jotai
import {
  standaloneChatSortCriteriaAtom, // Atom storing the current sort criteria
  standaloneChatSortDirectionAtom, // Atom storing the current sort direction
  type StandaloneChatSortCriteria, // Type definition for possible sort criteria
} from '..'; // Import state atoms and types from the store's index

/**
 * A write-only Jotai atom to update the standalone chat sort state.
 * When set with a new sort criteria:
 * 1. If the new criteria is the same as the current one, it toggles the sort direction (asc -> desc or desc -> asc).
 * 2. If the new criteria is different, it sets the new criteria and resets the direction to a default
 *    (descending for 'date', ascending for others).
 *
 * Usage:
 * const setSort = useSetAtom(setStandaloneChatSortAtom);
 * // Example: Sort by name (ascending by default)
 * setSort('name');
 * // Example: Click name header again to sort descending
 * setSort('name');
 * // Example: Sort by date (descending by default)
 * setSort('date');
 */
export const setStandaloneChatSortAtom = atom(
  null, // Read function is null because this is a write-only atom for actions
  (get, set, newCriteria: StandaloneChatSortCriteria) => {
    // Write function
    // Get the current sort criteria and direction from their respective atoms
    const currentCriteria = get(standaloneChatSortCriteriaAtom);
    const currentDirection = get(standaloneChatSortDirectionAtom);

    if (newCriteria === currentCriteria) {
      // Case 1: Clicked the same column header again - toggle direction
      set(
        standaloneChatSortDirectionAtom,
        currentDirection === 'asc' ? 'desc' : 'asc'
      );
    } else {
      // Case 2: Clicked a new column header - set new criteria and default direction
      set(standaloneChatSortCriteriaAtom, newCriteria);
      // Set default sort direction: 'date' defaults to descending, others default to ascending
      set(
        standaloneChatSortDirectionAtom,
        newCriteria === 'date' ? 'desc' : 'asc'
      );
    }
  }
);
