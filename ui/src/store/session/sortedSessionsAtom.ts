import { atom } from 'jotai';
import {
    pastSessionsAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom
} from '..';
import type { Session } from '../../types';

// ** This atom performs the sorting based on global state **
export const sortedSessionsAtom = atom<Session[]>((get) => {
    // Read the source of truth for sessions
    const sessions = get(pastSessionsAtom);
    // Read the current sorting preferences
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);

    console.log(`[sortedSessionsAtom] Sorting ${sessions.length} sessions by ${criteria} (${direction})`);

    const sorted = [...sessions].sort((a, b) => {
        let valA: any;
        let valB: any;

        // Determine values based on criteria
        switch (criteria) {
            case 'sessionName':
                valA = a.sessionName || a.fileName || ''; // Fallback to fileName
                valB = b.sessionName || b.fileName || '';
                break;
            case 'clientName':
                valA = a.clientName || ''; // Default empty string for null/undefined
                valB = b.clientName || '';
                break;
             case 'sessionType':
                valA = a.sessionType || '';
                valB = b.sessionType || '';
                break;
             case 'therapy':
                valA = a.therapy || '';
                valB = b.therapy || '';
                break;
            case 'date':
                // Date comparison needs special handling
                const dateA = a.date ? new Date(a.date) : null;
                const dateB = b.date ? new Date(b.date) : null;
                const timeA = dateA ? dateA.getTime() : NaN;
                const timeB = dateB ? dateB.getTime() : NaN;

                // Handle invalid or missing dates consistently (e.g., push to end)
                if (isNaN(timeA)) return isNaN(timeB) ? 0 : 1; // Place NaN dates after valid dates
                if (isNaN(timeB)) return -1;
                return timeA - timeB; // Sort valid dates chronologically
            case 'id': // Sorting by ID might be useful for debugging or default
                 valA = a.id;
                 valB = b.id;
                 break;
            default:
                // Should not happen if criteria is typed correctly
                 // Use assertion to help TypeScript, though it won't prevent runtime issues if type isn't exhaustive
                 const _exhaustiveCheck: never = criteria;
                 console.warn(`[sortedSessionsAtom] Unknown sort criteria: ${criteria}`);
                 return 0;
        }

        // Generic comparison for non-date fields
        // Handle nulls consistently (e.g., place at the end)
        if (valA === null || valA === undefined) return (valB === null || valB === undefined) ? 0 : 1;
        if (valB === null || valB === undefined) return -1;

        // Compare based on type
        if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            return valA - valB;
        } else {
            // Fallback: convert to string and compare
            return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
        }
    });

    // Apply direction
    if (direction === 'desc') {
        sorted.reverse();
    }
    return sorted;
});
