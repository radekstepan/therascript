import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils'; // Import atomWithStorage
import { SAMPLE_SESSIONS } from './sampleData';
import type { Session, ChatMessage, ChatSession, SessionMetadata } from './types';
import { getTodayDateString } from './helpers'; // Assuming helpers are needed

// --- Constants for Sidebar Width ---
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256; // Corresponds to w-64

// --- Define Sort Types ---
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id'; // Added 'id' as a fallback
export type SortDirection = 'asc' | 'desc';

// --- Sidebar Width Atom ---
// Persist sidebar width in localStorage, default to DEFAULT_SIDEBAR_WIDTH
export const sidebarWidthAtom = atomWithStorage<number>(
    'session-sidebar-width', // Key in localStorage
    DEFAULT_SIDEBAR_WIDTH
);

// --- Derived atom to ensure sidebar width stays within bounds ---
// This is optional but good practice: ensures the stored value is always valid
export const clampedSidebarWidthAtom = atom(
    (get) => {
        const width = get(sidebarWidthAtom);
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    (get, set, newWidth: number) => {
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        set(sidebarWidthAtom, clampedWidth); // Set the original persistent atom
    }
);

// --- Sorting Atoms ---
// Persist sort criteria, default to 'date'
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
// Persist sort direction, default to 'desc' (newest date first)
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// --- Theme Atom ---
// Type for theme values
type Theme = 'light' | 'dark' | 'system';

// Atom to store the theme preference, persisted in localStorage under the key 'ui-theme'
// Defaults to 'system' preference
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');

// Derived atom to get the *effective* theme (resolving 'system')
export const effectiveThemeAtom = atom<Exclude<Theme, 'system'>>((get) => {
    const theme = get(themeAtom);
    if (theme === 'system') {
        // Check system preference only if window is available (SSR safety)
        if (typeof window !== 'undefined') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light'; // Default fallback for SSR
    }
    return theme; // Return 'light' or 'dark' directly
});


// --- Core State Atoms ---
export const pastSessionsAtom = atom<Session[]>(SAMPLE_SESSIONS);
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// --- Upload Modal State Atoms ---
export const isUploadModalOpenAtom = atom(false);
export const isTranscribingAtom = atom(false);
export const transcriptionErrorAtom = atom('');

// --- Chat State Atoms ---
export const currentQueryAtom = atom('');
export const isChattingAtom = atom(false);
export const chatErrorAtom = atom('');

// --- Derived Read Atoms ---

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

// Get a globally flattened list of starred messages including their names
export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = [];
    sessions.forEach(session => {
        session.chats?.forEach(chat => {
            chat.messages?.forEach(msg => {
                if (msg.starred) {
                    if (!allStarred.some(starred => starred.id === msg.id)) {
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    return allStarred;
});

// Derived Atom for Sorted Sessions
export const sortedSessionsAtom = atom<Session[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);

    // Create a mutable copy before sorting
    const sorted = [...sessions].sort((a, b) => {
        // Prioritize sessionName if available, otherwise fallback to fileName for 'sessionName' sort
        let valA: any;
        let valB: any;

        if (criteria === 'sessionName') {
             valA = a.sessionName || a.fileName || null;
             valB = b.sessionName || b.fileName || null;
        } else {
             valA = a[criteria] ?? null; // Use nullish coalescing for undefined/null
             valB = b[criteria] ?? null;
        }

        // Handle nulls/undefined consistently (e.g., push them to the end)
        if (valA === null && valB !== null) return 1; // a is null, b is not -> b comes first
        if (valA !== null && valB === null) return -1; // a is not null, b is -> a comes first
        if (valA === null && valB === null) return 0; // both null -> equal

        // Specific comparison logic based on criteria
        switch (criteria) {
            case 'date':
                // Assuming date strings are in 'YYYY-MM-DD' format or similar that Date can parse
                // Treat invalid dates like nulls (push to end)
                const dateA = new Date(valA);
                const dateB = new Date(valB);
                if (isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) return 1;
                if (!isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return -1;
                if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
                return dateA.getTime() - dateB.getTime(); // Chronological comparison

            case 'clientName':
            case 'sessionName': // Will use the prepared valA/valB including fallback
            case 'sessionType':
            case 'therapy':
                // Case-insensitive string comparison
                return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });

            case 'id': // Fallback/default numeric sort
            default:
                 // Ensure values are numbers if possible, fallback to 0
                 const numA = typeof valA === 'number' ? valA : 0;
                 const numB = typeof valB === 'number' ? valB : 0;
                 return numA - numB;
        }
    });

    // Apply direction
    if (direction === 'desc') {
        sorted.reverse(); // Reverse the array for descending order
    }

    return sorted;
});


// --- Write Atoms (Actions) ---

export const openUploadModalAtom = atom(null, (get, set) => { set(transcriptionErrorAtom, ''); set(isUploadModalOpenAtom, true); });
export const closeUploadModalAtom = atom(null, (get, set) => { if (!get(isTranscribingAtom)) { set(isUploadModalOpenAtom, false); }});
export const addSessionAtom = atom(null, (get, set, newSession: Session) => { set(pastSessionsAtom, (prev) => [newSession, ...prev]); });
export const updateSessionMetadataAtom = atom(null, (get, set, update: { sessionId: number; metadata: Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'> }) => { set(pastSessionsAtom, (prev) => prev.map(s => s.id === update.sessionId ? { ...s, ...update.metadata } : s)); console.log(`Metadata updated for session: ${update.sessionId}`); });
export const saveTranscriptAtom = atom(null, (get, set, update: { sessionId: number; transcript: string }) => { set(pastSessionsAtom, (prev) => prev.map(s => s.id === update.sessionId ? { ...s, transcription: update.transcript } : s)); console.log(`Transcript updated for session: ${update.sessionId}`); });
export const addChatMessageAtom = atom(null, (get, set, message: ChatMessage) => {
    const sessionId = get(activeSessionIdAtom);
    const chatId = get(activeChatIdAtom);
    if (sessionId === null || chatId === null) { console.error("Cannot add message: No active session or chat."); set(chatErrorAtom, "Error: Could not determine active session/chat."); return; }
    set(pastSessionsAtom, (prev) => prev.map((session) => {
        if (session.id === sessionId) {
            const currentChats = Array.isArray(session.chats) ? session.chats : [];
            const updatedChats = currentChats.map((chat) => {
                if (chat.id === chatId) {
                    const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
                    return { ...chat, messages: [...currentMessages, message] };
                }
                return chat;
            });
            if (!updatedChats.some(c => c.id === chatId)) { console.error(`Chat ${chatId} not found in session ${sessionId} when adding message.`); return session; }
            return { ...session, chats: updatedChats };
        }
        return session;
    }));
});
export const starMessageAtom = atom(null, (get, set, payload: { chatId: number; messageId: number; shouldStar: boolean; name?: string }) => {
    const { chatId, messageId, shouldStar, name } = payload;
    const sessionId = get(activeSessionIdAtom);
    if (sessionId === null) { console.error("Cannot star/unstar message: No active session."); return; }
    set(pastSessionsAtom, (prevSessions) => prevSessions.map(session => {
        if (session.id === sessionId) {
            const updatedChats = (session.chats || []).map(chat => {
                if (chat.id === chatId) {
                    const updatedMessages = (chat.messages || []).map(msg => msg.id === messageId ? { ...msg, starred: shouldStar, starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined } : msg );
                    return { ...chat, messages: updatedMessages };
                }
                return chat;
            });
            return { ...session, chats: updatedChats };
        }
        return session;
    }));
    if (shouldStar) { console.log(`Message ${messageId} in chat ${chatId} starred with name "${name || 'Default Name'}"`); }
    else { console.log(`Message ${messageId} in chat ${chatId} unstarred`); }
});
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };
export const startNewChatAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(null, async (get, set, { sessionId }) => {
    if (sessionId === null || isNaN(sessionId)) { const error = "Error: Could not find session to start new chat."; console.error(error); set(chatErrorAtom, error); return { success: false, error }; }
    const newChatId = Date.now(); const initialMessageId = newChatId + 1;
    const newChat: ChatSession = { id: newChatId, timestamp: Date.now(), messages: [{ id: initialMessageId, sender: 'ai', text: "New chat started." }] };
    let success = false;
    set(pastSessionsAtom, (prev) => prev.map(s => { if (s.id === sessionId) { success = true; return { ...s, chats: [...(Array.isArray(s.chats) ? s.chats : []), newChat] }; } return s; }));
    if (success) { console.log(`Created new chat (${newChatId}) for session ${sessionId}`); return { success: true, newChatId: newChatId }; }
    else { const error = `Error: Session ${sessionId} not found when adding new chat.`; console.error(error); set(chatErrorAtom, error); return { success: false, error }; }
});
export const renameChatAtom = atom(null, (get, set, payload: { chatId: number, newName: string }) => {
    const { chatId, newName } = payload; const sessionId = get(activeSessionIdAtom);
    if (sessionId === null) { console.error("Cannot rename chat: No active session."); return; }
    set(pastSessionsAtom, (prev) => prev.map(session => { if (session.id === sessionId) { const updatedChats = (session.chats || []).map(chat => chat.id === chatId ? { ...chat, name: newName.trim() || undefined } : chat); return { ...session, chats: updatedChats }; } return session; }));
    console.log(`Renamed chat ${chatId} in session ${sessionId} to: ${newName.trim()}`);
});
type TranscriptionResult = { success: true, newSessionId: number, newChatId: number } | { success: false, error: string };
export const handleStartTranscriptionAtom = atom<null, [{ file: File, metadata: SessionMetadata }], Promise<TranscriptionResult>>(null, async (get, set, { file, metadata }) => {
    set(isTranscribingAtom, true); set(transcriptionErrorAtom, ''); console.log("Starting transcription simulation for:", file.name, metadata);
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000)); const success = Math.random() > 0.1;
    if (success) {
        const dummyTranscription = `Therapist: Okay ${metadata.clientName}, let's begin session "${metadata.sessionName}" from ${metadata.date}. What's been on your mind?\nPatient: Well, it's been a challenging week...\nTherapist: Tell me more about that.\n(Simulated transcription content...)`;
        const newSessionId = Date.now(); const initialChatId = newSessionId + 1; const initialMessageId = newSessionId + 2;
        const initialChat: ChatSession = { id: initialChatId, timestamp: Date.now(), messages: [{ id: initialMessageId, sender: 'ai', text: `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.` }] };
        const newSession: Session = { id: newSessionId, fileName: file.name, ...metadata, transcription: dummyTranscription, chats: [initialChat] };
        set(addSessionAtom, newSession); set(isUploadModalOpenAtom, false); set(isTranscribingAtom, false); console.log("Transcription successful. New session added:", newSessionId);
        return { success: true, newSessionId: newSessionId, newChatId: initialChatId };
    } else {
        const errorMsg = 'Simulated transcription failed. Please check the file or try again.'; set(transcriptionErrorAtom, errorMsg); set(isTranscribingAtom, false); console.error("Transcription failed (simulated).");
        return { success: false, error: errorMsg };
    }
});
export const handleChatSubmitAtom = atom(null, async (get, set) => {
    const query = get(currentQueryAtom); const sessionId = get(activeSessionIdAtom); const chatId = get(activeChatIdAtom); const chatting = get(isChattingAtom);
    if (!query.trim()) { set(chatErrorAtom, "Cannot send an empty message."); return; }
    if (chatting) return;
    if (sessionId === null || chatId === null) { set(chatErrorAtom, "Please start or select a chat before sending a message."); return; }
    const session = get(activeSessionAtom); const chat = get(activeChatAtom);
    if (!session || !chat) { set(chatErrorAtom, `Error: Active session or chat not found. Please select again.`); return; }
    const userMessageId = Date.now() + 1; const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: query, starred: false };
    set(addChatMessageAtom, newUserMessage);
    const querySentToApi = query; set(currentQueryAtom, ''); set(isChattingAtom, true); set(chatErrorAtom, '');
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));
    try {
        const aiResponseText = `Simulated analysis of "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response]`;
        const aiMessageId = Date.now() + 2; const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };
        set(addChatMessageAtom, aiResponseMessage);
    } catch (error) { console.error("Chat API simulation error:", error); set(chatErrorAtom, "Failed to get response from AI (simulated error)."); }
    finally { set(isChattingAtom, false); }
});

// Action Atom to Handle Sorting Click
export const setSessionSortAtom = atom(
    null, // No read function needed
    (get, set, newCriteria: SessionSortCriteria) => {
        const currentCriteria = get(sessionSortCriteriaAtom);
        const currentDirection = get(sessionSortDirectionAtom);

        if (newCriteria === currentCriteria) {
            // If clicking the same column, toggle direction
            set(sessionSortDirectionAtom, currentDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // If clicking a new column, set new criteria and default direction
            set(sessionSortCriteriaAtom, newCriteria);
            // Default to 'desc' for date, 'asc' for others
            set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
        }
    }
);
