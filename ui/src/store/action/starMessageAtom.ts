import { atom } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom
} from '..'; // Import from the main store index
import type { ChatMessage } from '../../types'; // Assuming types is ../../

export const starMessageAtom = atom(
    null,
    (get, set, payload: { chatId: number; messageId: number; shouldStar: boolean; name?: string }) => {
        const { chatId, messageId, shouldStar, name } = payload;
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot star/unstar message: No active session.");
            return;
        }

        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map((session) => {
                if (session.id === sessionId) {
                    // Ensure session.chats is an array before mapping
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const updatedChats = currentChats.map((chat) => {
                        if (chat.id === chatId) {
                            // Ensure chat.messages is an array before mapping
                            const currentMessages = Array.isArray(chat.messages) ? chat.messages : []; // Explicitly handle undefined
                            const updatedMessages = currentMessages.map((msg: ChatMessage) => { // Explicitly type msg
                                if (msg.id === messageId) {
                                    return {
                                        ...msg,
                                        starred: shouldStar,
                                        // Ensure name is handled correctly if undefined/empty
                                        starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined,
                                    };
                                }
                                return msg; // Return unchanged message
                            });
                            // Return the chat with the updated messages array
                            return { ...chat, messages: updatedMessages };
                        }
                        return chat; // Return unchanged chat
                    });
                    // Return the session with the potentially updated chats array
                    return { ...session, chats: updatedChats };
                }
                return session; // Return unchanged session
            })
        );
    }
);
