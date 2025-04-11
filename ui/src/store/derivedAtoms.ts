// src/store/derivedAtoms.ts
import { atom, Getter } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    SessionSortCriteria,
    SortDirection
} from './sessionAtoms'; // Correct path
import { activeChatIdAtom } from './chatAtoms'; // Correct path
import type { Session, ChatSession, ChatMessage } from '../types';

// --- Derived Session/Chat Data ---

export const activeSessionAtom = atom<Session | null>((get: Getter): Session | null => {
    const sessions = get(pastSessionsAtom);
    const id = get(activeSessionIdAtom);
    if (id === null) return null;
    return Array.isArray(sessions) ? sessions.find((s: Session) => s.id === id) ?? null : null;
});

export const activeChatAtom = atom<ChatSession | null>((get: Getter): ChatSession | null => {
    const session = get(activeSessionAtom);
    const chatId = get(activeChatIdAtom);
    if (!session || chatId === null) return null;
    const chats = Array.isArray(session.chats) ? session.chats : [];
    return chats.find((c: ChatSession) => c.id === chatId) ?? null;
});

export const currentChatMessagesAtom = atom<ChatMessage[]>((get: Getter): ChatMessage[] => {
    const chat = get(activeChatAtom);
    return chat?.messages ?? [];
});

export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get: Getter) => {
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    if (!Array.isArray(sessions)) return [];

    sessions.forEach((session: Session) => {
        (session.chats ?? []).forEach((chat: ChatSession) => {
            (chat.messages ?? []).forEach((msg: ChatMessage) => {
                if (msg.starred) {
                    if (!allStarred.some((starred) => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    allStarred.sort((a, b) => (a.starredName || a.text).localeCompare(b.starredName || b.text));
    return allStarred;
});

// --- Derived Sorted Sessions ---

export const sortedSessionsAtom = atom<Session[]>((get: Getter): Session[] => {
    const sessions = get(pastSessionsAtom);
     if (!Array.isArray(sessions)) return [];
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);

    const sorted = [...sessions].sort((a: Session, b: Session) => {
        let valA: any; let valB: any;
        switch (criteria) {
            case 'sessionName': valA = a.sessionName || a.fileName || ''; valB = b.sessionName || b.fileName || ''; break;
            case 'clientName': valA = a.clientName || ''; valB = b.clientName || ''; break;
            case 'sessionType': valA = a.sessionType || ''; valB = b.sessionType || ''; break;
            case 'therapy': valA = a.therapy || ''; valB = b.therapy || ''; break;
            case 'date':
                const dateA = a.date ? new Date(a.date).getTime() : 0; const dateB = b.date ? new Date(b.date).getTime() : 0;
                if (isNaN(dateA) && isNaN(dateB)) return 0; if (isNaN(dateA)) return 1; if (isNaN(dateB)) return -1;
                return dateA - dateB;
            case 'id': default: valA = a.id; valB = b.id; return valA - valB;
        }
        const aIsNull = valA === null || valA === undefined || valA === ''; const bIsNull = valB === null || valB === undefined || valB === '';
        if (aIsNull && bIsNull) return 0; if (aIsNull) return 1; if (bIsNull) return -1;
        if (typeof valA === 'string' && typeof valB === 'string') { return valA.localeCompare(valB, undefined, { sensitivity: 'base' }); }
        if (valA < valB) return -1; if (valA > valB) return 1; return 0;
    });

    if (direction === 'desc') { sorted.reverse(); }
    return sorted;
});
