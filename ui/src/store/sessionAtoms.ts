// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { Session, ChatSession, ChatMessage } from '../types';

// Define Sort Types
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// Core State Atoms
export const pastSessionsAtom = atom<Session[]>([]);
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// Sorting Atoms
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// Derived Read Atoms
export const activeSessionAtom = atom<Session | null>((get) => {
    const sessions = get(pastSessionsAtom);
    const id = get(activeSessionIdAtom);
    // --- LOGGING START ---
    console.log('[activeSessionAtom] Deriving: activeSessionId =', id);
    // console.log('[activeSessionAtom] Deriving: pastSessions =', sessions); // Can be noisy
    const foundSession = id !== null ? sessions.find((s) => s.id === id) ?? null : null;
    console.log('[activeSessionAtom] Result:', foundSession ? { id: foundSession.id, name: foundSession.sessionName, hasChats: Array.isArray(foundSession.chats) } : null);
    if (foundSession) {
       // Log existence and type of chats array if session is found
       console.log('[activeSessionAtom] Found session chats property exists:', foundSession.hasOwnProperty('chats'));
       console.log('[activeSessionAtom] Found session chats is array:', Array.isArray(foundSession.chats));
       // console.log('[activeSessionAtom] Found session chats content:', foundSession.chats); // Potentially noisy
    }
    // --- LOGGING END ---
    return foundSession;
});


export const activeChatAtom = atom<ChatSession | null>((get) => {
    const session = get(activeSessionAtom); // Relies on the atom above
    const chatId = get(activeChatIdAtom);
    if (!session || chatId === null) return null;
    // Ensure session.chats exists and is an array before searching
    const chats = Array.isArray(session.chats) ? session.chats : [];
    const foundChat = chats.find((c) => c.id === chatId) ?? null;
    // Optional: Log found chat details
    // console.log('[activeChatAtom] Found chat:', foundChat ? { id: foundChat.id, name: foundChat.name, hasMessages: Array.isArray(foundChat.messages) } : null);
    return foundChat;
});


export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    sessions.forEach((session) => {
        (Array.isArray(session.chats) ? session.chats : []).forEach((chat) => {
            (Array.isArray(chat.messages) ? chat.messages : []).forEach((msg) => {
                if (msg.starred) {
                    if (!allStarred.some((starred) => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    return allStarred;
});

export const sortedSessionsAtom = atom<Session[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);

    const sorted = [...sessions].sort((a, b) => {
        let valA: any;
        let valB: any;

        if (criteria === 'sessionName') {
            valA = a.sessionName || a.fileName || '';
            valB = b.sessionName || b.fileName || '';
        } else if (criteria === 'date') {
            const dateA = a.date ? new Date(a.date) : null;
            const dateB = b.date ? new Date(b.date) : null;
            // Handle invalid dates during sort
            const timeA = dateA ? dateA.getTime() : NaN;
            const timeB = dateB ? dateB.getTime() : NaN;
            if (isNaN(timeA)) return isNaN(timeB) ? 0 : 1; // Invalid dates go to the end
            if (isNaN(timeB)) return -1;
            return timeA - timeB; // Sort valid dates
        } else {
            // Safely access other potential criteria
            valA = criteria in a ? (a as any)[criteria] : null;
            valB = criteria in b ? (b as any)[criteria] : null;
        }


        // Handle nulls during sort
        if (valA === null && valB !== null) return 1; // Nulls go to the end
        if (valA !== null && valB === null) return -1;
        if (valA === null && valB === null) return 0;

        // Compare values
        if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            return valA - valB;
        } else {
            // Fallback comparison as strings
            return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
        }
    });

    if (direction === 'desc') sorted.reverse();

    return sorted;
});
