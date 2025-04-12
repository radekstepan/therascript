import { atom } from 'jotai';
import { pastSessionsAtom } from '..';
import type { ChatMessage } from '../../types';

export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    sessions.forEach((session) => {
        (Array.isArray(session.chats) ? session.chats : []).forEach((chat) => {
            (Array.isArray(chat.messages) ? chat.messages : []).forEach((msg) => {
                if (msg.starred) {
                    // Ensure uniqueness in the rare case a message might appear twice? (defensive)
                    if (!allStarred.some((starred) => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    return allStarred;
});
