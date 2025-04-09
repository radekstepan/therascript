// src/store/actionAtoms.ts
import { atom } from 'jotai';
import {
    basePastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    activeChatAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    SessionSortCriteria,
} from './sessionAtoms';
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
} from './uiAtoms';
import {
    currentQueryAtom,
    isChattingAtom,
    chatErrorAtom,
    toastMessageAtom,
} from './chatAtoms';
import type { Session, ChatMessage, ChatSession, SessionMetadata } from '../types';
// Note: SAMPLE_SESSIONS is used to initialize basePastSessionsAtom in sessionAtoms.ts
// Note: getTodayDateString is likely not needed here directly

// Re-export the base atom so components import `pastSessionsAtom`
// but actions operate on `basePastSessionsAtom` internally to avoid cycles
export const pastSessionsAtom = basePastSessionsAtom;


// --- Types for Action Results ---
type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };
type TranscriptionResult = { success: true, newSessionId: number, newChatId: number } | { success: false, error: string };


// --- Write Atoms (Actions) ---

// Modal Actions
export const openUploadModalAtom = atom(null, (get, set) => {
    set(transcriptionErrorAtom, ''); // Clear previous errors on open
    set(isUploadModalOpenAtom, true);
});

export const closeUploadModalAtom = atom(null, (get, set) => {
    // Only allow closing if not currently transcribing
    if (!get(isTranscribingAtom)) {
        set(isUploadModalOpenAtom, false);
        set(transcriptionErrorAtom, ''); // Clear errors on close
    } else {
        console.warn("Attempted to close modal while transcription is in progress.");
        // Optionally set a toast message here
        set(toastMessageAtom, "Please wait for the transcription to finish before closing.");
    }
});


// Session CRUD Actions
export const addSessionAtom = atom(
    null,
    (get, set, newSession: Session) => {
        set(basePastSessionsAtom, (prev) => [newSession, ...prev]);
        console.log("Added new session:", newSession.id);
    }
);

export const updateSessionMetadataAtom = atom(
    null,
    (get, set, update: { sessionId: number; metadata: Partial<Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'>> }) => {
        let found = false;
        set(basePastSessionsAtom, (prev) =>
            prev.map(s => {
                if (s.id === update.sessionId) {
                    found = true;
                    return { ...s, ...update.metadata };
                }
                return s;
            })
        );
        if (found) {
            console.log(`Metadata updated for session: ${update.sessionId}`);
        } else {
            console.warn(`Session ${update.sessionId} not found for metadata update.`);
        }
    }
);

export const saveTranscriptAtom = atom(
    null,
    (get, set, update: { sessionId: number; transcript: string }) => {
        let found = false;
        set(basePastSessionsAtom, (prev) =>
            prev.map(s => {
                if (s.id === update.sessionId) {
                    found = true;
                    return { ...s, transcription: update.transcript };
                }
                return s;
            })
        );
         if (found) {
            console.log(`Transcript updated for session: ${update.sessionId}`);
         } else {
            console.warn(`Session ${update.sessionId} not found for transcript save.`);
         }
    }
);


// Chat Message Actions
export const addChatMessageAtom = atom(
    null,
    (get, set, message: ChatMessage) => {
        const sessionId = get(activeSessionIdAtom);
        const chatId = get(activeChatIdAtom);

        if (sessionId === null || chatId === null) {
            const errorMsg = "Cannot add message: No active session or chat.";
            console.error(errorMsg);
            set(chatErrorAtom, errorMsg); // Use specific chat error atom
            return;
        }

        let sessionFound = false;
        let chatFound = false;

        set(basePastSessionsAtom, (prev) =>
            prev.map((session) => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    // Ensure chats is an array
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const updatedChats = currentChats.map((chat) => {
                        if (chat.id === chatId) {
                            chatFound = true;
                             // Ensure messages is an array
                             const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
                             // Add the new message
                            return { ...chat, messages: [...currentMessages, message] };
                        }
                        return chat;
                    });
                     // If chat wasn't found in this session, return session unmodified
                     if (!chatFound && updatedChats.length === currentChats.length) {
                        return session;
                    }
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );

        if (!sessionFound) {
            console.error(`Session ${sessionId} not found when adding message.`);
        } else if (!chatFound) {
            console.error(`Chat ${chatId} not found in session ${sessionId} when adding message.`);
        } else {
            // console.log(`Message added to chat ${chatId} in session ${sessionId}`);
        }
    }
);


export const starMessageAtom = atom(
    null,
    (get, set, payload: { chatId: number; messageId: number; shouldStar: boolean; name?: string }) => {
        const { chatId, messageId, shouldStar, name } = payload;
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot star/unstar message: No active session.");
            return;
        }

        let sessionFound = false;
        let chatFound = false;
        let messageFound = false;

        set(basePastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const updatedChats = (Array.isArray(session.chats) ? session.chats : []).map(chat => {
                        if (chat.id === chatId) {
                            chatFound = true;
                            const updatedMessages = (Array.isArray(chat.messages) ? chat.messages : []).map(msg => {
                                if (msg.id === messageId) {
                                    messageFound = true;
                                    return {
                                        ...msg,
                                        starred: shouldStar,
                                        // Set name only if starring, clear if unstarring
                                        starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined
                                    };
                                }
                                return msg;
                            });
                            return { ...chat, messages: updatedMessages };
                        }
                        return chat;
                    });
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );

        if (!sessionFound) console.error(`Session ${sessionId} not found during star action.`);
        else if (!chatFound) console.error(`Chat ${chatId} not found during star action.`);
        else if (!messageFound) console.error(`Message ${messageId} not found during star action.`);
        else if (shouldStar) console.log(`Message ${messageId} in chat ${chatId} starred with name "${name || 'Default Name'}"`);
        else console.log(`Message ${messageId} in chat ${chatId} unstarred`);
    }
);


// Chat Management Actions
export const renameChatAtom = atom(
    null,
    (get, set, payload: { chatId: number, newName: string }) => {
        const { chatId, newName } = payload;
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot rename chat: No active session.");
            return;
        }

        let sessionFound = false;
        let chatFound = false;

        set(basePastSessionsAtom, (prev) =>
            prev.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const updatedChats = (Array.isArray(session.chats) ? session.chats : []).map(chat => {
                        if (chat.id === chatId) {
                            chatFound = true;
                             // Use undefined for name if trimmed string is empty
                             return { ...chat, name: newName.trim() || undefined };
                        }
                        return chat;
                    });
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );

        if (!sessionFound) console.error(`Session ${sessionId} not found during rename.`);
        else if (!chatFound) console.error(`Chat ${chatId} not found during rename.`);
        else console.log(`Renamed chat ${chatId} in session ${sessionId} to: "${newName.trim()}"`);
    }
);


export const deleteChatAtom = atom<null, [{ chatId: number }], DeleteChatResult>(
    null,
    (get, set, { chatId }) => {
        const sessionId = get(activeSessionIdAtom);
        if (sessionId === null) {
            const error = "Cannot delete chat: No active session.";
            console.error(error);
            return { success: false, error };
        }

        let sessionFound = false;
        let chatDeleted = false;
        let remainingChats: ChatSession[] = [];
        let currentlyActiveChatId = get(activeChatIdAtom);
        let newActiveChatId: number | null = null;

        set(basePastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const initialChats = Array.isArray(session.chats) ? session.chats : [];
                    const chatIndex = initialChats.findIndex(c => c.id === chatId);

                    if (chatIndex === -1) {
                        // Chat not found in this session, return session unmodified
                        return session;
                    }

                    chatDeleted = true;
                    // Filter out the chat to be deleted
                    remainingChats = initialChats.filter(c => c.id !== chatId);
                    return { ...session, chats: remainingChats };
                }
                return session;
            })
        );

        // Error handling after attempting update
        if (!sessionFound) {
             const error = `Error: Session ${sessionId} not found when deleting chat.`;
             console.error(error);
             return { success: false, error };
        }
        if (!chatDeleted) {
            const error = `Error: Chat ${chatId} not found in session ${sessionId}.`;
            console.error(error);
            return { success: false, error };
        }

        console.log(`Deleted chat ${chatId} from session ${sessionId}`);

        // Update activeChatId if the deleted chat was the active one
        if (currentlyActiveChatId === chatId) {
            if (remainingChats.length > 0) {
                // Sort remaining chats by timestamp (most recent first) and set the newest as active
                const sortedRemaining = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp);
                newActiveChatId = sortedRemaining[0].id;
            } else {
                // No chats left in the session
                newActiveChatId = null;
            }
            set(activeChatIdAtom, newActiveChatId);
            console.log(`Active chat was deleted. New active chat ID: ${newActiveChatId}`);
        } else {
            // The active chat was not the one deleted, so keep it active
            newActiveChatId = currentlyActiveChatId;
        }

        // Return success status and the ID of the chat that *should* be active now
        return { success: true, newActiveChatId: newActiveChatId };
    }
);


export const startNewChatAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(
    null,
    async (get, set, { sessionId }) => {
        if (sessionId === null || isNaN(sessionId)) {
            const error = "Error: Could not find session to start new chat.";
            console.error(error);
            set(chatErrorAtom, error);
            return { success: false, error };
        }

        const newChatId = Date.now(); // Use timestamp as unique ID for simplicity
        const initialMessageId = newChatId + 1; // Ensure message ID is unique

        const newChat: ChatSession = {
            id: newChatId,
            timestamp: Date.now(),
            messages: [
                { id: initialMessageId, sender: 'ai', text: "New chat started." }
            ]
            // name is optional and starts undefined
        };

        let success = false;
        set(basePastSessionsAtom, (prev) =>
            prev.map(s => {
                if (s.id === sessionId) {
                    success = true;
                    // Ensure chats is an array before spreading
                    const currentChats = Array.isArray(s.chats) ? s.chats : [];
                    return { ...s, chats: [...currentChats, newChat] };
                }
                return s;
            })
        );

        if (success) {
            console.log(`Created new chat (${newChatId}) for session ${sessionId}`);
             // Automatically make the new chat active
             set(activeChatIdAtom, newChatId);
            return { success: true, newChatId: newChatId };
        } else {
            const error = `Error: Session ${sessionId} not found when adding new chat.`;
            console.error(error);
            set(chatErrorAtom, error);
            return { success: false, error };
        }
    }
);


// Transcription Action
export const handleStartTranscriptionAtom = atom<null, [{ file: File, metadata: SessionMetadata }], Promise<TranscriptionResult>>(
    null,
    async (get, set, { file, metadata }) => {
        set(isTranscribingAtom, true);
        set(transcriptionErrorAtom, '');
        console.log("Starting transcription simulation for:", file.name, metadata);

        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));

        // Simulate success/failure
        const success = Math.random() > 0.1; // 90% success rate for simulation

        if (success) {
            // Create dummy transcription content
            const dummyTranscription = `Therapist: Okay ${metadata.clientName}, let's begin session "${metadata.sessionName}" from ${metadata.date}. What's been on your mind?\nPatient: Well, it's been a challenging week...\nTherapist: Tell me more about that.\n(Simulated transcription content for ${file.name})`;

            // Generate IDs for the new session and its initial chat/message
            const newSessionId = Date.now(); // Simple unique ID generation
            const initialChatId = newSessionId + 1;
            const initialMessageId = newSessionId + 2;

            // Create the initial chat for the new session
            const initialChat: ChatSession = {
                id: initialChatId,
                timestamp: Date.now(),
                messages: [
                    { id: initialMessageId, sender: 'ai', text: `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.` }
                ]
            };

            // Create the new session object
            const newSession: Session = {
                id: newSessionId,
                fileName: file.name,
                ...metadata, // Spread the provided metadata
                transcription: dummyTranscription,
                chats: [initialChat] // Add the initial chat
            };

            // Add the new session to the store
            set(addSessionAtom, newSession); // Use the dedicated action atom
            set(isTranscribingAtom, false); // Turn off transcribing state
             // set(isUploadModalOpenAtom, false); // Close modal on success - Moved to component logic after navigation
            console.log("Transcription successful. New session added:", newSessionId);

            // Return success and the new IDs
            return { success: true, newSessionId: newSessionId, newChatId: initialChatId };

        } else {
            // Handle simulated failure
            const errorMsg = 'Simulated transcription failed. Please check the file or try again.';
            set(transcriptionErrorAtom, errorMsg);
            set(isTranscribingAtom, false);
            console.error("Transcription failed (simulated).");
            return { success: false, error: errorMsg };
        }
    }
);


// Chat Submission Action
export const handleChatSubmitAtom = atom(
    null,
    async (get, set) => {
        const query = get(currentQueryAtom);
        const sessionId = get(activeSessionIdAtom);
        const chatId = get(activeChatIdAtom);
        const chatting = get(isChattingAtom);

        // 1. Pre-submission checks
        if (chatting) {
            console.warn("Attempted to submit chat while AI is responding.");
            set(toastMessageAtom, "Please wait for the AI to finish responding."); // Use toast for this
            return;
        }
        if (!query.trim()) {
            console.log("Attempted to send empty message.");
             // set(chatErrorAtom, "Cannot send an empty message."); // Or just silently ignore
             return; // Silently ignore empty submission
        }
        if (sessionId === null || chatId === null) {
            set(chatErrorAtom, "Please select or start a chat first."); // Use non-toast error
            return;
        }

        // Ensure session/chat exist (though selection implies they should)
        const session = get(activeSessionAtom);
        const chat = get(activeChatAtom);
        if (!session || !chat) {
             const errorMsg = `Error: Active session (${sessionId}) or chat (${chatId}) not found during submit.`;
             console.error(errorMsg);
            set(chatErrorAtom, errorMsg);
            return;
        }

        // 2. Add User Message Optimistically
        const userMessageId = Date.now() + 1; // Simple unique ID
        const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: query, starred: false };
        set(addChatMessageAtom, newUserMessage);

        // 3. Prepare for API Call
        const querySentToApi = query; // Store query before clearing
        set(currentQueryAtom, ''); // Clear input field
        set(isChattingAtom, true); // Set loading state
        set(chatErrorAtom, ''); // Clear previous non-toast errors
        set(toastMessageAtom, null); // Clear any pending toasts

        // --- Simulate API Call ---
        console.log("Simulating AI response for:", querySentToApi);
        // Placeholder for cancellation logic in real API
        const cancellationToken = { cancelled: false };
        const timeoutId = setTimeout(() => {}, 10000); // Placeholder timeout logic if needed

        try {
             // Simulate network delay
             await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));

            // Check if cancelled *during* the wait
            if (!get(isChattingAtom) || cancellationToken.cancelled) {
                console.log("Chat response cancelled before completion.");
                // cancelChatResponseAtom handles toast/state reset
                return;
            }

             // --- Simulate Response Generation ---
            // Example: Generate a response based on the query
            const aiResponseText = `Simulated analysis for "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response for chat ${chatId}]`;
            const aiMessageId = Date.now() + 2; // Simple unique ID
            const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };

             // Add AI message to the store
             set(addChatMessageAtom, aiResponseMessage);

        } catch (error) {
            console.error("Chat API simulation error:", error);
            set(chatErrorAtom, "Failed to get response from AI (simulated error).");
            // Optionally set a toast message as well
            set(toastMessageAtom, "An error occurred while getting the AI response.");
        } finally {
            // Clear timeout/API call related resources
            clearTimeout(timeoutId);

             // Reset loading state *only* if it wasn't cancelled externally
             if (get(isChattingAtom)) {
               set(isChattingAtom, false);
            }
        }
    }
);


// Cancellation Action
export const cancelChatResponseAtom = atom(
    null,
    (get, set) => {
        if (get(isChattingAtom)) {
            console.log("Attempting to cancel chat response...");
            // **Placeholder:** In a real app, you would abort the fetch/axios request here.
            // For simulation, we just update the state.

            set(isChattingAtom, false); // Immediately reset chatting state
            set(chatErrorAtom, ''); // Clear any potentially related errors
            set(toastMessageAtom, "AI response cancelled."); // Set confirmation toast
        } else {
            console.log("No active chat response to cancel.");
        }
    }
);


// Sorting Action
export const setSessionSortAtom = atom(
    null,
    (get, set, newCriteria: SessionSortCriteria) => {
        const currentCriteria = get(sessionSortCriteriaAtom);
        const currentDirection = get(sessionSortDirectionAtom);

        if (newCriteria === currentCriteria) {
            // If clicking the same column header, toggle direction
            set(sessionSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // If clicking a new column header, set criteria and default direction
            set(sessionSortCriteriaAtom, newCriteria);
             // Default to descending for date, ascending for others
             set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
        }
    }
);
