// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { Session, ChatSession, ChatMessage } from '../types';

// Define Sort Types
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// Core State Atoms
export const pastSessionsAtom = atom<Session[]>([]); // This atom should be populated by LandingPage fetch
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// Sorting Atoms
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// Derived Read Atoms
export const activeSessionAtom = atom<Session | null>((get) => {
    const sessions = get(pastSessionsAtom);
    const id = get(activeSessionIdAtom);
    // console.log('[activeSessionAtom] Deriving: activeSessionId =', id);
    const foundSession = id !== null ? sessions.find((s) => s.id === id) ?? null : null;
    // console.log('[activeSessionAtom] Result:', foundSession ? { id: foundSession.id, name: foundSession.sessionName, hasChats: Array.isArray(foundSession.chats) } : null);
    // if (foundSession) { console.log('[activeSessionAtom] Found session chats property exists:', foundSession.hasOwnProperty('chats')); console.log('[activeSessionAtom] Found session chats is array:', Array.isArray(foundSession.chats)); }
    return foundSession;
});


export const activeChatAtom = atom<ChatSession | null>((get) => {
    const session = get(activeSessionAtom);
    const chatId = get(activeChatIdAtom);
    if (!session || chatId === null) return null;
    const chats = Array.isArray(session.chats) ? session.chats : [];
    const foundChat = chats.find((c) => c.id === chatId) ?? null;
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
    // console.log("[sortedSessionsAtom] Sorted result:", sorted.map(s => ({ id: s.id, name: s.sessionName, date: s.date }))); // Example log
    return sorted;
});
