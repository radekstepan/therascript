import { atom } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom
} from '..';

// Type for Action Result
export type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };

export const deleteChatAtom = atom<null, [{ chatId: number }], DeleteChatResult>(
    null,
    (get, set, { chatId }) => {
        const sessionId = get(activeSessionIdAtom);
        if (sessionId === null) {
            const error = "Cannot delete chat: No active session.";
            console.error(error);
            return { success: false, error };
        }

        let newActiveChatId: number | null = null;
        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map((session) => {
                if (session.id === sessionId) {
                    // Ensure chats is an array
                    // TODO should be typed automatically
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const remainingChats = currentChats.filter((c) => c.id !== chatId);
                    // Determine the next active chat ID *after* filtering
                    if (remainingChats.length > 0) {
                        // Sort remaining chats by timestamp to find the newest
                        newActiveChatId = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
                    } else {
                        newActiveChatId = null; // No chats left
                    }
                    return { ...session, chats: remainingChats }; // Return session with filtered chats
                }
                return session; // Return other sessions unchanged
            })
        );

        // If the deleted chat was the active one, update the activeChatIdAtom
        const currentActiveChatId = get(activeChatIdAtom);
        if (currentActiveChatId === chatId) {
            set(activeChatIdAtom, newActiveChatId);
        }
        // Return success and the ID of the chat that should now be active
        return { success: true, newActiveChatId };
    }
);
