import { atom } from 'jotai';
import { pastSessionsAtom } from '..'; // Import from the main store index
import { fetchSessions } from '../../api/api'; // Assuming api is ../../ from store/action

export const refreshSessionsAtom = atom(null, async (get, set) => {
    try {
        const sessions = await fetchSessions();
        set(pastSessionsAtom, sessions);
    } catch (error) {
        console.error("Failed to refresh sessions:", error);
        // Optionally set an error state (e.g., using a dedicated error atom if needed)
    }
});
