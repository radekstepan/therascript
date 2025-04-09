// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { SAMPLE_SESSIONS } from '../sampleData';
import type { Session, ChatSession, ChatMessage } from '../types';
import { pastSessionsAtom } from './actionAtoms'; // Import from actions if it's modified there

// --- Define Sort Types ---
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// --- Core State Atoms ---
export const basePastSessionsAtom = atom<Session[]>(SAMPLE_SESSIONS); // Base atom for sessions
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// --- Sorting Atoms ---
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// --- Derived Read Atoms ---
export const activeSessionAtom = atom<Session | null>((get) => {
  // Use the potentially modified pastSessionsAtom from actionAtoms
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
  // Ensure chats is treated as an array, even if null/undefined initially
  const chats = Array.isArray(session.chats) ? session.chats : [];
  return chats.find(c => c.id === chatId) ?? null;
});

export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    // Use the potentially modified pastSessionsAtom from actionAtoms
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    sessions.forEach(session => {
        // Ensure chats is treated as an array
        (Array.isArray(session.chats) ? session.chats : []).forEach(chat => {
            // Ensure messages is treated as an array
            (Array.isArray(chat.messages) ? chat.messages : []).forEach(msg => {
                if (msg.starred) {
                    // Prevent duplicates if starred in multiple views (though unlikely with current setup)
                    if (!allStarred.some(starred => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    // Optionally sort starred messages, e.g., by name or date added (requires timestamp storage)
    // allStarred.sort((a, b) => (a.starredName || '').localeCompare(b.starredName || ''));
    return allStarred;
});


export const sortedSessionsAtom = atom<Session[]>((get) => {
    // Use the potentially modified pastSessionsAtom from actionAtoms
    const sessions = get(pastSessionsAtom);
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);

    const sorted = [...sessions].sort((a, b) => {
        let valA: any;
        let valB: any;

        // Handle specific criteria
        if (criteria === 'sessionName') {
             valA = a.sessionName || a.fileName || ''; // Default to empty string for consistent sorting
             valB = b.sessionName || b.fileName || '';
        } else if (criteria === 'date') {
            // Prioritize date parsing, fallback logic for invalid/missing dates
            const dateA = a.date ? new Date(a.date) : null;
            const dateB = b.date ? new Date(b.date) : null;

            // Handle null or invalid dates: push them to the end
            if (!dateA || isNaN(dateA.getTime())) return (!dateB || isNaN(dateB.getTime())) ? 0 : 1;
            if (!dateB || isNaN(dateB.getTime())) return -1;

            return dateA.getTime() - dateB.getTime();
        }
         else {
             valA = a[criteria] ?? null; // Use nullish coalescing for potentially missing keys
             valB = b[criteria] ?? null;
        }

        // Generic comparison for non-date fields
        // Put null/undefined values at the end regardless of sort direction initially
        if (valA === null && valB !== null) return 1;
        if (valA !== null && valB === null) return -1;
        if (valA === null && valB === null) return 0;

        // Perform comparison based on type
        if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
        } else if (typeof valA === 'number' && typeof valB === 'number') {
            return valA - valB;
        } else {
             // Fallback for mixed types or other types (treat as strings)
             return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
        }
    });

    // Apply direction
    if (direction === 'desc') {
        sorted.reverse();
    }

    return sorted;
});
