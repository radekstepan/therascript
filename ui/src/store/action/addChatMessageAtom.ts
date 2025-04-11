import { atom } from 'jotai';
import {
  activeSessionIdAtom,
  activeChatIdAtom,
  pastSessionsAtom,
  isChattingAtom,
  chatErrorAtom
} from '..'; // Import from the main store index
import { addChatMessage as addChatMessageApi } from '../../api/api'; // Assuming api is ../../
import type { Session, ChatMessage, ChatSession } from '../../types'; // Assuming types is ../../

export const addChatMessageAtom = atom(null, async (get, set, messageText: string) => {
    const sessionId = get(activeSessionIdAtom);
    const chatId = get(activeChatIdAtom);
    if (sessionId === null || chatId === null) {
        set(chatErrorAtom, "Cannot add message: No active session or chat.");
        return;
    }
    try {
        set(isChattingAtom, true); // Indicate AI is working
        const { userMessage, aiMessage } = await addChatMessageApi(sessionId, chatId, messageText);

        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map((session) => {
                if (session.id === sessionId) {
                    // Ensure session.chats is an array
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const updatedChats = currentChats.map((chat) => {
                        if (chat.id === chatId) {
                            // Ensure chat.messages is an array
                            const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
                            // Construct new messages array explicitly
                            const newMessages = [...currentMessages, userMessage, aiMessage];
                            return { ...chat, messages: newMessages };
                        }
                        return chat; // Return other chats in this session unchanged
                    });
                    return { ...session, chats: updatedChats }; // Return updated session
                }
                return session; // Return other sessions unchanged
            })
        );
    } catch (err) {
        console.error("Error adding chat message:", err);
        set(chatErrorAtom, 'Failed to add message.');
    } finally {
        set(isChattingAtom, false); // AI finished
    }
});
