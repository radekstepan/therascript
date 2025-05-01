import { atom } from 'jotai';
import {
  // Keep types, but remove pastSessionsAtom dependency
  sessionSortCriteriaAtom,
  sessionSortDirectionAtom,
  type SessionSortCriteria,
} from '..';

export const setSessionSortAtom = atom(
  null,
  (get, set, newCriteria: SessionSortCriteria) => {
    const currentCriteria = get(sessionSortCriteriaAtom);
    const currentDirection = get(sessionSortDirectionAtom);

    if (newCriteria === currentCriteria) {
      // If clicking the same column header, toggle direction
      set(
        sessionSortDirectionAtom,
        currentDirection === 'asc' ? 'desc' : 'asc'
      );
    } else {
      // If clicking a new column header, set criteria and default direction
      set(sessionSortCriteriaAtom, newCriteria);
      // Default sort directions: 'date' descending, others ascending
      set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
    }
  }
);
