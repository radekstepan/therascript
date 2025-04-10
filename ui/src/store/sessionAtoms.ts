// src/store/sessionAtoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { Session, ChatSession, ChatMessage } from '../types';

// Define Sort Types
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// Core State Atoms
export const pastSessionsAtom = atom<Session[]>([]); // Holds all session data, including full details when fetched
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// Sorting Atoms
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// --- Derived Read Atoms ---

// Derives the currently active session object from the list
export const activeSessionAtom = atom<Session | null>((get) => {
  const sessions = get(pastSessionsAtom);
  const id = get(activeSessionIdAtom);
  if (id === null) {
      console.log("activeSessionAtom: No activeSessionIdAtom");
      return null;
  }
  const activeSession = sessions.find((s) => s.id === id);
  if (!activeSession) {
      console.log(`activeSessionAtom: Session with ID ${id} not found in pastSessionsAtom.`);
      // console.log("Available session IDs:", sessions.map(s => s.id));
      return null;
  }
  // Log the chats whenever the active session is derived
  // console.log(`activeSessionAtom: Found session ${id}. Chats:`, activeSession.chats);
  return activeSession;
});

// Derives the currently active chat object within the active session
export const activeChatAtom = atom<ChatSession | null>((get) => {
  const session = get(activeSessionAtom); // Relies on the above atom
  const chatId = get(activeChatIdAtom);

  if (!session) {
      // console.log("activeChatAtom: No active session found.");
      return null;
  }
  if (chatId === null) {
      // console.log("activeChatAtom: No active chatId set.");
      return null;
  }

  // Ensure session.chats is treated as an array
  const chats = Array.isArray(session.chats) ? session.chats : [];
  const activeChat = chats.find((c) => c.id === chatId);

  if (!activeChat) {
      // console.log(`activeChatAtom: Chat with ID ${chatId} not found in active session ${session.id}.`);
      // console.log("Available chat IDs in session:", chats.map(c => c.id));
      return null;
  }
  // console.log(`activeChatAtom: Found active chat ${chatId}.`);
  return activeChat;
});

// Derives starred messages from ALL sessions (unchanged)
export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    // ... logic remains the same ...
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

// Derives sorted sessions for the landing page (unchanged)
export const sortedSessionsAtom = atom<Session[]>((get) => {
    // ... logic remains the same ...
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
        // Handle potential invalid dates during sorting
        const dateA = a.date ? new Date(a.date) : null;
        const dateB = b.date ? new Date(b.date) : null;
        const timeA = dateA?.getTime();
        const timeB = dateB?.getTime();

        if (timeA === undefined || timeA === null || isNaN(timeA)) return (timeB === undefined || timeB === null || isNaN(timeB)) ? 0 : 1; // Invalid date A goes last
        if (timeB === undefined || timeB === null || isNaN(timeB)) return -1; // Invalid date B goes last (A is valid)
        return timeA - timeB; // Both dates valid
      } else {
        valA = a[criteria as keyof Session] ?? null; // Use keyof Session
        valB = b[criteria as keyof Session] ?? null;
      }

      // Handle nulls
      if (valA === null && valB !== null) return 1;
      if (valA !== null && valB === null) return -1;
      if (valA === null && valB === null) return 0;

      // Compare values
      if (typeof valA === 'string' && typeof valB === 'string') {
        return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
      } else if (typeof valA === 'number' && typeof valB === 'number') {
        return valA - valB;
      } else {
        // Fallback comparison
        return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
      }
    });

    if (direction === 'desc') sorted.reverse();

    return sorted;
});
