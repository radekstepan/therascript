import { atom } from 'jotai';
import { SAMPLE_SESSIONS } from './sampleData';
import type { Session, ChatMessage, ChatSession, SessionMetadata } from './types';
import { getTodayDateString } from './helpers';

// --- Core State Atoms ---

// All session data
export const pastSessionsAtom = atom<Session[]>(SAMPLE_SESSIONS);

// ID of the currently active session (Set by SessionView based on URL)
export const activeSessionIdAtom = atom<number | null>(null);

// ID of the currently active chat within the active session (Set by SessionView based on URL)
export const activeChatIdAtom = atom<number | null>(null);

// --- Upload Modal State Atoms --- (No change)
export const isUploadModalOpenAtom = atom(false);
export const isTranscribingAtom = atom(false);
export const transcriptionErrorAtom = atom('');

// --- Chat State Atoms --- (No change)
export const currentQueryAtom = atom('');
export const isChattingAtom = atom(false);
export const chatErrorAtom = atom('');

// --- Derived Read Atoms --- (No change)

// Get the full Session object for the active session ID
export const activeSessionAtom = atom<Session | null>((get) => {
  const sessions = get(pastSessionsAtom);
  const id = get(activeSessionIdAtom);
  return id !== null ? sessions.find(s => s.id === id) ?? null : null;
});

// Get the full ChatSession object for the active chat ID within the active session
export const activeChatAtom = atom<ChatSession | null>((get) => {
  const session = get(activeSessionAtom);
  const chatId = get(activeChatIdAtom);
  if (!session || chatId === null) {
    return null;
  }
  // Ensure chats array exists and find the chat
  return session.chats?.find(c => c.id === chatId) ?? null;
});

// Get the messages for the currently active chat
export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  return chat?.messages || [];
});

// Get a globally flattened list of starred messages (for the template popover)
export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text'>[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text'>[] = [];
    sessions.forEach(session => {
        session.chats?.forEach(chat => {
            chat.messages?.forEach(msg => {
                if (msg.starred) {
                    // Avoid duplicates just in case
                    if (!allStarred.some(starred => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text });
                    }
                }
            });
        });
    });
    return allStarred;
});


// --- Write Atoms (Actions) ---

// Removed navigateToSessionAtom
// Removed navigateBackAtom

// Action to open the upload modal (No change)
export const openUploadModalAtom = atom(
    null,
    (get, set) => {
        set(transcriptionErrorAtom, ''); // Clear previous errors
        set(isUploadModalOpenAtom, true);
    }
);

// Action to close the upload modal (No change)
export const closeUploadModalAtom = atom(
    null,
    (get, set) => {
        // Only allow closing if not currently transcribing
        if (!get(isTranscribingAtom)) {
             set(isUploadModalOpenAtom, false);
        }
    }
);

// Action to add a new session (No change in core logic)
// The navigation will happen in the component calling handleStartTranscriptionAtom
export const addSessionAtom = atom(
    null,
    (get, set, newSession: Session) => {
        set(pastSessionsAtom, (prevSessions) => [newSession, ...prevSessions]);
    }
);

// Action to update metadata for a specific session (No change)
export const updateSessionMetadataAtom = atom(
  null,
  (get, set, update: { sessionId: number; metadata: Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'> }) => {
    set(pastSessionsAtom, (prevSessions) =>
      prevSessions.map(session =>
        session.id === update.sessionId ? { ...session, ...update.metadata } : session
      )
    );
    console.log(`Metadata updated for session: ${update.sessionId}`);
  }
);

// Action to save the transcript for a specific session (No change)
export const saveTranscriptAtom = atom(
  null,
  (get, set, update: { sessionId: number; transcript: string }) => {
    set(pastSessionsAtom, (prevSessions) =>
      prevSessions.map(session =>
        session.id === update.sessionId ? { ...session, transcription: update.transcript } : session
      )
    );
    console.log(`Transcript updated for session: ${update.sessionId}`);
  }
);

// Action to add a message to the currently active chat (No change)
// Note: This directly modifies the main pastSessionsAtom
export const addChatMessageAtom = atom(
    null,
    (get, set, message: ChatMessage) => {
        const sessionId = get(activeSessionIdAtom);
        const chatId = get(activeChatIdAtom);
        if (sessionId === null || chatId === null) {
            console.error("Cannot add message: No active session or chat.");
            set(chatErrorAtom, "Error: Could not determine active session/chat to save message.");
            return;
        }
        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map((session) => {
                if (session.id === sessionId) {
                    // Ensure chats array exists and is an array
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const updatedChats = currentChats.map((chat) => {
                        if (chat.id === chatId) {
                            // Ensure messages array exists
                             const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
                             return { ...chat, messages: [...currentMessages, message] };
                        }
                        return chat;
                    });
                    // If the chat didn't exist (shouldn't happen with current flow but safety check)
                    if (!updatedChats.some(c => c.id === chatId)) {
                         console.error(`Chat ${chatId} not found in session ${sessionId} when trying to add a message.`);
                         return session; // Return original session if chat not found
                    }
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
    }
);


// Action to star/unstar a message (No change)
export const starMessageAtom = atom(
    null,
    (get, set, payload: { chatId: number; messageId: number; shouldStar: boolean }) => {
        const { chatId, messageId, shouldStar } = payload;
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot star message: No active session.");
            return;
        }

        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    const updatedChats = (session.chats || []).map(chat => {
                        if (chat.id === chatId) {
                            const updatedMessages = (chat.messages || []).map(msg =>
                                msg.id === messageId
                                    ? { ...msg, starred: shouldStar }
                                    : msg
                            );
                            return { ...chat, messages: updatedMessages };
                        }
                        return chat;
                    });
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
        console.log(`Message ${messageId} in chat ${chatId} ${shouldStar ? 'starred' : 'unstarred'}`);
    }
);

// Action to start a new chat within the active session
// This atom NOW returns the ID of the newly created chat, so the component can navigate.
// It receives the sessionId as an argument because activeSessionIdAtom might not be updated yet
// when called immediately after navigation.
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };
export const startNewChatAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(
    null, // Read function is null
    async (get, set, { sessionId }) => { // async to potentially handle future async ops if needed
        if (sessionId === null || isNaN(sessionId)) {
             const error = "Error: Could not find the current session to start a new chat.";
            console.error(error);
            set(chatErrorAtom, error);
            return { success: false, error };
        }

        const newChatId = Date.now(); // Use timestamp for unique ID
        const initialMessageId = newChatId + 1;
        const newChat: ChatSession = {
            id: newChatId,
            timestamp: Date.now(),
            messages: [
                { id: initialMessageId, sender: 'ai', text: "New chat started." }
            ]
        };

        let success = false;
        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(s => {
                if (s.id === sessionId) {
                    success = true; // Mark success if session was found and updated
                    return { ...s, chats: [...(Array.isArray(s.chats) ? s.chats : []), newChat] };
                }
                return s;
            })
        );

        if (success) {
            // Don't set activeChatIdAtom here - the component will navigate, causing re-render and effect run
            // Don't set currentQueryAtom etc here - the effect in SessionView handles this on nav
            console.log(`Created new chat (${newChatId}) for session ${sessionId}`);
            return { success: true, newChatId: newChatId };
        } else {
             const error = `Error: Session ${sessionId} not found when trying to add new chat.`;
             console.error(error);
             set(chatErrorAtom, error);
            return { success: false, error };
        }
    }
);


// Action to rename a chat (No change)
export const renameChatAtom = atom(
    null,
    (get, set, payload: { chatId: number, newName: string }) => {
        const { chatId, newName } = payload;
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot rename chat: No active session.");
            return;
        }

        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    const updatedChats = (session.chats || []).map(chat =>
                        chat.id === chatId
                            ? { ...chat, name: newName.trim() || undefined } // Set name, or undefined if empty
                            : chat
                    );
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
        console.log(`Renamed chat ${chatId} in session ${sessionId} to: ${newName.trim()}`);
    }
);

// --- Complex Actions (Involving Async/Multiple State Updates) ---

// Action to handle the transcription process
// Returns the new session ID and chat ID on success, so the calling component can navigate
type TranscriptionResult = { success: true, newSessionId: number, newChatId: number } | { success: false, error: string };
export const handleStartTranscriptionAtom = atom<null, [{ file: File, metadata: SessionMetadata }], Promise<TranscriptionResult>>(
    null, // Read function is null
    async (get, set, { file, metadata }) => {
        set(isTranscribingAtom, true);
        set(transcriptionErrorAtom, '');
        console.log("Starting transcription simulation for:", file.name, metadata);

        // Simulate network delay and processing time
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
        const success = Math.random() > 0.1; // 90% chance of success

        if (success) {
            const dummyTranscription = `Therapist: Okay ${metadata.clientName}, let's begin session "${metadata.sessionName}" from ${metadata.date}. What's been on your mind?\nPatient: Well, it's been a challenging week...\nTherapist: Tell me more about that.\n(Simulated transcription content...)`;
            const newSessionId = Date.now();
            const initialChatId = newSessionId + 1; // Unique IDs
            const initialMessageId = newSessionId + 2;

            const initialChat: ChatSession = {
                id: initialChatId,
                timestamp: Date.now(),
                messages: [{
                    id: initialMessageId,
                    sender: 'ai',
                    text: `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.`
                }]
            };
            const newSession: Session = {
                id: newSessionId,
                fileName: file.name,
                ...metadata,
                transcription: dummyTranscription,
                chats: [initialChat]
            };

            set(addSessionAtom, newSession); // Add the session to the state
            set(isUploadModalOpenAtom, false); // Close modal
            set(isTranscribingAtom, false); // Stop loading
            console.log("Transcription successful. New session added:", newSessionId);
            // Return success and the IDs so the component can navigate
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

// Action to handle chat submission (No change in core logic)
export const handleChatSubmitAtom = atom(
    null,
    async (get, set) => {
        const query = get(currentQueryAtom);
        const sessionId = get(activeSessionIdAtom);
        const chatId = get(activeChatIdAtom);
        const chatting = get(isChattingAtom);

        // --- Input Validation ---
        if (!query.trim()) { set(chatErrorAtom, "Cannot send an empty message."); return; }
        if (chatting) { /* Already handled by UI disabling */ return; }
        if (sessionId === null || chatId === null) {
            set(chatErrorAtom, "Please start or select a chat before sending a message.");
            return;
        }
        // Check if session/chat still exist (safety check)
        const session = get(activeSessionAtom);
        const chat = get(activeChatAtom);
         if (!session || !chat) {
             set(chatErrorAtom, `Error: Active session or chat not found. Please select again.`);
             // Let the SessionView effect handle potential redirection if needed
             // set(activeChatIdAtom, null); // Reset potentially invalid chat ID
             return;
         }

        // --- Prepare and Send User Message ---
        const userMessageId = Date.now() + 1; // Simple unique ID generation
        const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: query, starred: false };

        // Add user message optimistically using addChatMessageAtom
        set(addChatMessageAtom, newUserMessage);

        const querySentToApi = query; // Capture query before clearing
        set(currentQueryAtom, ''); // Clear input field
        set(isChattingAtom, true); // Set loading state
        set(chatErrorAtom, ''); // Clear previous errors

        // --- Simulate API Call ---
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800)); // Simulate delay

        try {
            // Simulate successful AI response
            const aiResponseText = `Simulated analysis of "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response]`;
            const aiMessageId = Date.now() + 2; // Simple unique ID generation
            const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };

            // Add AI response message using addChatMessageAtom
            set(addChatMessageAtom, aiResponseMessage);

        } catch (error) {
            console.error("Chat API simulation error:", error);
            set(chatErrorAtom, "Failed to get response from AI (simulated error).");
            // Note: No need to manually revert state, optimistic update remains.
            // Could implement rollback if needed by removing the user message here.
        } finally {
            set(isChattingAtom, false); // End loading state
        }
    }
);
