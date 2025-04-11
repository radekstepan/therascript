import { atom } from 'jotai';
import { pastSessionsAtom } from './pastSessionsAtom';
import { activeSessionIdAtom } from './activeSessionIdAtom';
import type { Session } from '../../types'; // Assuming types is ../../

export const activeSessionAtom = atom<Session | null>((get) => {
    const sessions = get(pastSessionsAtom);
    const id = get(activeSessionIdAtom);
    // console.log('[activeSessionAtom] Deriving: activeSessionId =', id);
    const foundSession = id !== null ? sessions.find((s) => s.id === id) ?? null : null;
    // console.log('[activeSessionAtom] Result:', foundSession ? { id: foundSession.id, name: foundSession.sessionName, hasChats: Array.isArray(foundSession.chats) } : null);
    // if (foundSession) { console.log('[activeSessionAtom] Found session chats property exists:', foundSession.hasOwnProperty('chats')); console.log('[activeSessionAtom] Found session chats is array:', Array.isArray(foundSession.chats)); }
    return foundSession;
});
