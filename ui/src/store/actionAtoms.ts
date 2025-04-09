// src/store/actionAtoms.ts
import { atom } from 'jotai';
import {
    // Import the actual state atom now
    pastSessionsAtom,
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

// --- Types for Action Results ---
type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };
type TranscriptionResult = { success: true, newSessionId: number, newChatId: number } | { success: false, error: string };


// --- Write Atoms (Actions) ---

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
        console.warn("Attempted to close modal while transcription is in progress.");
        set(toastMessageAtom, "Please wait for the transcription to finish before closing.");
    }
});


// Session CRUD Actions
export const addSessionAtom = atom(
    null,
    (get, set, newSession: Session) => {
        // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) => [newSession, ...prev]);
        console.log("Added new session:", newSession.id);
    }
);

export const updateSessionMetadataAtom = atom(
    null,
    (get, set, update: { sessionId: number; metadata: Partial<Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'>> }) => {
        let found = false;
        // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) =>
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
         // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) =>
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
            set(chatErrorAtom, errorMsg);
            return;
        }

        let sessionFound = false;
        let chatFound = false;

         // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) =>
            prev.map((session) => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const updatedChats = currentChats.map((chat) => {
                        if (chat.id === chatId) {
                            chatFound = true;
                             const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
                            return { ...chat, messages: [...currentMessages, message] };
                        }
                        return chat;
                    });
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

         // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prevSessions) =>
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

        // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) =>
            prev.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const updatedChats = (Array.isArray(session.chats) ? session.chats : []).map(chat => {
                        if (chat.id === chatId) {
                            chatFound = true;
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

        // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const initialChats = Array.isArray(session.chats) ? session.chats : [];
                    const chatIndex = initialChats.findIndex(c => c.id === chatId);

                    if (chatIndex === -1) { return session; }

                    chatDeleted = true;
                    remainingChats = initialChats.filter(c => c.id !== chatId);
                    return { ...session, chats: remainingChats };
                }
                return session;
            })
        );

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

        if (currentlyActiveChatId === chatId) {
            if (remainingChats.length > 0) {
                const sortedRemaining = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp);
                newActiveChatId = sortedRemaining[0].id;
            } else {
                newActiveChatId = null;
            }
            set(activeChatIdAtom, newActiveChatId);
            console.log(`Active chat was deleted. New active chat ID: ${newActiveChatId}`);
        } else {
            newActiveChatId = currentlyActiveChatId;
        }

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

        const newChatId = Date.now();
        const initialMessageId = newChatId + 1;

        const newChat: ChatSession = {
            id: newChatId,
            timestamp: Date.now(),
            messages: [ { id: initialMessageId, sender: 'ai', text: "New chat started." } ]
        };

        let success = false;
        // Operate directly on the imported pastSessionsAtom
        set(pastSessionsAtom, (prev) =>
            prev.map(s => {
                if (s.id === sessionId) {
                    success = true;
                    const currentChats = Array.isArray(s.chats) ? s.chats : [];
                    return { ...s, chats: [...currentChats, newChat] };
                }
                return s;
            })
        );

        if (success) {
            console.log(`Created new chat (${newChatId}) for session ${sessionId}`);
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

        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
        const success = Math.random() > 0.1;

        if (success) {
            const dummyTranscription = `Therapist: Okay ${metadata.clientName}, let's begin session "${metadata.sessionName}" from ${metadata.date}. What's been on your mind?\nPatient: Well, it's been a challenging week...\nTherapist: Tell me more about that.\n(Simulated transcription content for ${file.name})`;
            const newSessionId = Date.now();
            const initialChatId = newSessionId + 1;
            const initialMessageId = newSessionId + 2;

            const initialChat: ChatSession = {
                id: initialChatId,
                timestamp: Date.now(),
                messages: [ { id: initialMessageId, sender: 'ai', text: `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.` } ]
            };

            const newSession: Session = {
                id: newSessionId, fileName: file.name, ...metadata, transcription: dummyTranscription, chats: [initialChat]
            };

            // Use the dedicated action atom to add the session
            set(addSessionAtom, newSession);
            set(isTranscribingAtom, false);
            console.log("Transcription successful. New session added:", newSessionId);

            return { success: true, newSessionId: newSessionId, newChatId: initialChatId };

        } else {
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

        if (chatting) {
            console.warn("Attempted to submit chat while AI is responding.");
            set(toastMessageAtom, "Please wait for the AI to finish responding.");
            return;
        }
        if (!query.trim()) {
             return;
        }
        if (sessionId === null || chatId === null) {
            set(chatErrorAtom, "Please select or start a chat first.");
            return;
        }
        const session = get(activeSessionAtom);
        const chat = get(activeChatAtom);
        if (!session || !chat) {
             const errorMsg = `Error: Active session (${sessionId}) or chat (${chatId}) not found during submit.`;
             console.error(errorMsg);
            set(chatErrorAtom, errorMsg);
            return;
        }

        const userMessageId = Date.now() + 1;
        const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: query, starred: false };
        set(addChatMessageAtom, newUserMessage); // Use action

        const querySentToApi = query;
        set(currentQueryAtom, '');
        set(isChattingAtom, true);
        set(chatErrorAtom, '');
        set(toastMessageAtom, null);

        const cancellationToken = { cancelled: false }; // Simple cancellation flag for simulation
        const timeoutId = setTimeout(() => { /* Potentially handle long waits */ }, 15000); // Example timeout

        try {
             await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));

            if (!get(isChattingAtom) || cancellationToken.cancelled) {
                console.log("Chat response cancelled before completion.");
                return;
            }

            const aiResponseText = `Simulated analysis for "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response for chat ${chatId}]`;
            const aiMessageId = Date.now() + 2;
            const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };

             set(addChatMessageAtom, aiResponseMessage); // Use action

        } catch (error) {
            console.error("Chat API simulation error:", error);
            set(chatErrorAtom, "Failed to get response from AI (simulated error).");
            set(toastMessageAtom, "An error occurred while getting the AI response.");
        } finally {
            clearTimeout(timeoutId);
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
            // **Placeholder:** Abort fetch/axios request here.
            set(isChattingAtom, false);
            set(chatErrorAtom, '');
            set(toastMessageAtom, "AI response cancelled.");
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
            set(sessionSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
        } else {
            set(sessionSortCriteriaAtom, newCriteria);
             set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
        }
    }
);
