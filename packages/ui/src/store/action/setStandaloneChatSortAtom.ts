/*
 * packages/ui/src/store/action/setStandaloneChatSortAtom.ts
 * Action atom to update the standalone chat sort state.
 */
import { atom } from 'jotai';
import {
    standaloneChatSortCriteriaAtom,
    standaloneChatSortDirectionAtom,
    type StandaloneChatSortCriteria
} from '..'; // Import from index

// Atom to handle setting the sort criteria and direction
export const setStandaloneChatSortAtom = atom(null, (get, set, newCriteria: StandaloneChatSortCriteria) => {
    const currentCriteria = get(standaloneChatSortCriteriaAtom);
    const currentDirection = get(standaloneChatSortDirectionAtom);

    if (newCriteria === currentCriteria) {
        // If clicking the same column header, toggle direction
        set(standaloneChatSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
        // If clicking a new column header, set criteria and default direction
        set(standaloneChatSortCriteriaAtom, newCriteria);
        // Default sort directions: 'date' descending, others ascending
        set(standaloneChatSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
    }
});

// TODO comments should not be removed
