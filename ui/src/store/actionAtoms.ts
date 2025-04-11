// src/store/actionAtoms.ts
import { atom } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    SessionSortCriteria,
} from './sessionAtoms';
import { isUploadModalOpenAtom, isTranscribingAtom, transcriptionErrorAtom } from './uiAtoms';
// Make sure isChattingAtom is imported if used
import { currentQueryAtom, isChattingAtom, chatErrorAtom, toastMessageAtom } from './chatAtoms';
// Rename API import to avoid naming conflicts
import {
    fetchSessions,
    uploadSession,
    startNewChat,
    addChatMessage as addChatMessageApi, // Renamed API function import
    renameChat,
    deleteChat as deleteChatApi // Renamed API function import
} from '../api/api';
import type { Session, ChatMessage, SessionMetadata, ChatSession } from '../types'; // Import ChatSession

// Types for Action Results
type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };

// Modal Actions
export const openUploadModalAtom = atom(null, (get, set) => {
    set(transcriptionErrorAtom, '');
    set(isUploadModalOpenAtom, true);
});

export const closeUploadModalAtom = atom(null, (get, set) => {
    if (!get(isTranscribingAtom)) {
        set(isUploadModalOpenAtom, false);
        set(transcriptionErrorAtom, '');
    } else {
        set(toastMessageAtom, "Please wait for the transcription to finish before closing.");
    }
});

// Session Actions (Example: Refresh - addSessionAtom might be less common now)
export const refreshSessionsAtom = atom(null, async (get, set) => {
    try {
        const sessions = await fetchSessions();
        set(pastSessionsAtom, sessions);
    } catch (error) {
        console.error("Failed to refresh sessions:", error);
        // Optionally set an error state
    }
});


// Chat Message Actions - Updated to be more type-safe
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


// Star Message Action - Updated to be more type-safe
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


// Rename Chat Action
export const renameChatAtom = atom(null, async (get, set, payload: { chatId: number; newName: string }) => {
    const { chatId, newName } = payload;
    const sessionId = get(activeSessionIdAtom);

    if (sessionId === null) {
        console.error("Cannot rename chat: No active session.");
        set(chatErrorAtom, "Cannot rename chat: No active session.");
        return;
    }

    try {
        // Use renamed API function
        const updatedChat = await renameChat(sessionId, chatId, newName.trim() || null);
        set(pastSessionsAtom, (prev) =>
            prev.map((s) =>
                s.id === sessionId
                    ? {
                        ...s,
                        // Ensure chats is an array
                        chats: (Array.isArray(s.chats) ? s.chats : []).map((c) =>
                            c.id === chatId ? { ...c, name: updatedChat.name } : c // Update name
                        ),
                    }
                    : s
            )
        );
    } catch (err) {
        console.error(`Failed to rename chat ${chatId}:`, err);
        set(chatErrorAtom, "Failed to rename chat.");
    }
});

// Delete Chat Action (Calls API via component, this atom updates state)
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


// Start New Chat - Updated to handle potential lack of messages in response
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
            const newChatMetaData = await startNewChat(sessionId);

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

// Transcription Action (Placeholder - Assuming upload handles initial transcription)
export const handleStartTranscriptionAtom = atom<null, [{ file: File; metadata: SessionMetadata }], Promise<void>>(
    null,
    async (get, set, { file, metadata }) => {
        set(isTranscribingAtom, true);
        set(transcriptionErrorAtom, '');
        try {
            const newSession = await uploadSession(file, metadata); // Upload returns full session
            // Add the new session to the beginning of the list
            set(pastSessionsAtom, (prev) => [newSession, ...prev]);
            // Optionally navigate to the new session? This might be better handled in the component calling this.
        } catch (err) {
            console.error("Upload/Transcription failed:", err);
            set(transcriptionErrorAtom, 'Failed to upload and transcribe session.');
        } finally {
            set(isTranscribingAtom, false);
        }
    }
);

// Sorting Action
export const setSessionSortAtom = atom(null, (get, set, newCriteria: SessionSortCriteria) => {
    const currentCriteria = get(sessionSortCriteriaAtom);
    const currentDirection = get(sessionSortDirectionAtom);

    if (newCriteria === currentCriteria) {
        set(sessionSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
        set(sessionSortCriteriaAtom, newCriteria);
        set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc'); // Default sort directions
    }
});
