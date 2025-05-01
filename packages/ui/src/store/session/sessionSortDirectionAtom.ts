// Purpose: Defines a Jotai atom with storage to manage the current sort direction
//          (ascending or descending) for the session list.
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

// Define the possible sort directions.
export type SortDirection = 'asc' | 'desc';

/**
 * Atom storing the current sort direction for the session list.
 * - Persisted in localStorage under the key 'session-sort-direction'.
 * - Defaults to 'desc' (descending). Note that the default sort criteria is 'date',
 *   so the default overall sort is newest sessions first.
 */
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>(
    'session-sort-direction', // localStorage key
    'desc'                    // Default value
);
