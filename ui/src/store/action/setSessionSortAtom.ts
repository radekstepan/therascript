import { atom } from 'jotai';
import {
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    type SessionSortCriteria // Import the type
} from '..'; // Import from the main store index

export const setSessionSortAtom = atom(null, (get, set, newCriteria: SessionSortCriteria) => {
    const currentCriteria = get(sessionSortCriteriaAtom);
    const currentDirection = get(sessionSortDirectionAtom);

    if (newCriteria === currentCriteria) {
        set(sessionSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
        set(sessionSortCriteriaAtom, newCriteria);
        set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc'); // Default sort directions
    }
});
