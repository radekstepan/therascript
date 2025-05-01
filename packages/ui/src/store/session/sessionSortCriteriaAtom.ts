// Purpose: Defines a Jotai atom with storage to manage the currently selected
//          sorting criteria for the session list on the landing page.
import { atomWithStorage } from 'jotai/utils'; // Utility to persist atom state in localStorage

// Define the possible columns/criteria by which the session list can be sorted.
// These should correspond to the columns in the SessionListTable component.
export type SessionSortCriteria =
  | 'sessionName'
  | 'clientName'
  | 'sessionType'
  | 'therapy'
  | 'date'
  | 'id';

/**
 * Atom storing the current sort criteria for the session list.
 * - Persisted in localStorage under the key 'session-sort-criteria'.
 * - Defaults to 'date' if no value is found in storage.
 */
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>(
  'session-sort-criteria', // localStorage key
  'date' // Default value
);
