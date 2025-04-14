import { atom } from 'jotai';
import { pastSessionsAtom } from '..';
import { fetchSessions } from '../../api/api';

export const refreshSessionsAtom = atom(null, async (_get, set) => {
    try {
        const sessions = await fetchSessions();
        set(pastSessionsAtom, sessions);
    } catch (error) {
        console.error("Failed to refresh sessions:", error);
    }
});
