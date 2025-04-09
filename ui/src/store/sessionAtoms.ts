// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { SAMPLE_SESSIONS } from '../sampleData';
import type { Session, ChatSession, ChatMessage } from '../types';
// REMOVE: import { pastSessionsAtom } from './actionAtoms'; // No longer needed

// --- Define Sort Types ---
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// --- Core State Atoms ---
// Define the main session state atom HERE
export const pastSessionsAtom = atom<Session[]>(SAMPLE_SESSIONS);
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// --- Sorting Atoms ---
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// --- Derived Read Atoms ---
export const activeSessionAtom = atom<Session | null>((get) => {
  // Use the pastSessionsAtom defined in THIS file
  const sessions = get(pastSessionsAtom);
  const id = get(activeSessionIdAtom);
  return id !== null ? sessions.find(s => s.id === id) ?? null : null;
});

export const activeChatAtom = atom<ChatSession | null>((get) => {
  const session = get(activeSessionAtom);
  const chatId = get(activeChatIdAtom);
  if (!session || chatId === null) {
    return null;
  }
  const chats = Array.isArray(session.chats) ? session.chats : [];
  return chats.find(c => c.id === chatId) ?? null;
});

export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    // Use the pastSessionsAtom defined in THIS file
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    sessions.forEach(session => {
        (Array.isArray(session.chats) ? session.chats : []).forEach(chat => {
            (Array.isArray(chat.messages) ? chat.messages : []).forEach(msg => {
                if (msg.starred) {
                    if (!allStarred.some(starred => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    return allStarred;
});


export const sortedSessionsAtom = atom<Session[]>((get) => {
    // Use the pastSessionsAtom defined in THIS file
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
            if (!dateA || isNaN(dateA.getTime())) return (!dateB || isNaN(dateB.getTime())) ? 0 : 1;
            if (!dateB || isNaN(dateB.getTime())) return -1;
            return dateA.getTime() - dateB.getTime();
        }
         else {
             valA = a[criteria] ?? null;
             valB = b[criteria] ?? null;
        }

        if (valA === null && valB !== null) return 1;
        if (valA !== null && valB === null) return -1;
        if (valA === null && valB === null) return 0;

        if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            return valA - valB;
        } else {
             return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
        }
    });

    if (direction === 'desc') {
        sorted.reverse();
    }

    return sorted;
});
