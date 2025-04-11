import { atom } from 'jotai';
import {
    pastSessionsAtom,
    activeChatIdAtom,
    chatErrorAtom
} from '..'; // Import from the main store index
import { startNewChat as startNewChatApi } from '../../api/api'; // Assuming api is ../../
import type { ChatSession } from '../../types'; // Assuming types is ../../

// Type for Action Result
export type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };

export const startNewChatAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(
    null,
    async (get, set, { sessionId }) => {
        if (!sessionId) {
            const error = "Error: Could not find session to start new chat.";
            set(chatErrorAtom, error);
            return { success: false, error };
        }
        try {
            // API likely returns only metadata
            const newChatMetaData = await startNewChatApi(sessionId);

             // Prepare the chat object for state, ensuring messages array exists (even if empty)
             const newChatForState: ChatSession = {
                 ...newChatMetaData,
                 messages: [], // Initialize with empty messages
             };

            set(pastSessionsAtom, (prev) =>
                prev.map((s) =>
                    s.id === sessionId
                        // Ensure chats is an array before spreading
                        ? { ...s, chats: [...(Array.isArray(s.chats) ? s.chats : []), newChatForState] }
                        : s
                )
            );
            // Set the new chat as active (triggers message loading in SessionView)
            set(activeChatIdAtom, newChatForState.id);
            return { success: true, newChatId: newChatForState.id };
        } catch (err) {
            console.error("Failed to start new chat:", err);
            const error = 'Failed to start new chat.';
            set(chatErrorAtom, error);
            return { success: false, error };
        }
    }
);
