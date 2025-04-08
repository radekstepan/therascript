import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { SAMPLE_SESSIONS } from './sampleData';
import type { Session, ChatMessage, ChatSession, SessionMetadata } from './types';
import { getTodayDateString } from './helpers';

// --- Constants for Sidebar Width ---
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256;

// --- Sidebar Width Atom ---
export const sidebarWidthAtom = atomWithStorage<number>('session-sidebar-width', DEFAULT_SIDEBAR_WIDTH);

// --- Define Sort Types ---
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';
export type SortDirection = 'asc' | 'desc';

// --- Sorting Atoms ---
export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');

// --- Theme Atom ---
export type Theme = 'light' | 'dark' | 'system'; // Export Theme type
export const themeAtom = atomWithStorage<Theme>('ui-theme', 'system');

// Derived atom to get the *effective* theme (resolving 'system')
export const effectiveThemeAtom = atom<Exclude<Theme, 'system'>>((get) => {
    const theme = get(themeAtom);
    if (theme === 'system') {
        if (typeof window !== 'undefined') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light'; // Default fallback for SSR
    }
    return theme;
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
export const isChattingAtom = atom(false); // Tracks if AI response is pending
export const chatErrorAtom = atom(''); // Keep for other errors like empty message

// --- Toast State Atom ---
// Holds the message for the next toast to show. Null means no toast.
export const toastMessageAtom = atom<string | null>(null);

// --- Derived Read Atoms ---
export const activeSessionAtom = atom<Session | null>((get) => {
  const sessions = get(pastSessionsAtom);
  const id = get(activeSessionIdAtom);
  return id !== null ? sessions.find(s => s.id === id) ?? null : null;
});
export const activeChatAtom = atom<ChatSession | null>((get) => {
  const session = get(activeSessionAtom);
  const chatId = get(activeChatIdAtom);
  if (!session || chatId === null) {
    return null;
  }
  return session.chats?.find(c => c.id === chatId) ?? null;
});
export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  return chat?.messages || [];
});
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
export const sortedSessionsAtom = atom<Session[]>((get) => {
    const sessions = get(pastSessionsAtom);
    const criteria = get(sessionSortCriteriaAtom);
    const direction = get(sessionSortDirectionAtom);
    const sorted = [...sessions].sort((a, b) => {
        let valA: any;
        let valB: any;
        if (criteria === 'sessionName') {
             valA = a.sessionName || a.fileName || null;
             valB = b.sessionName || b.fileName || null;
        } else {
             valA = a[criteria] ?? null;
             valB = b[criteria] ?? null;
        }
        if (valA === null && valB !== null) return 1;
        if (valA !== null && valB === null) return -1;
        if (valA === null && valB === null) return 0;
        switch (criteria) {
            case 'date':
                const dateA = new Date(valA);
                const dateB = new Date(valB);
                if (isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) return 1;
                if (!isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return -1;
                if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
                return dateA.getTime() - dateB.getTime();
            case 'clientName':
            case 'sessionName':
            case 'sessionType':
            case 'therapy':
                return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
            case 'id':
            default:
                 const numA = typeof valA === 'number' ? valA : 0;
                 const numB = typeof valB === 'number' ? valB : 0;
                 return numA - numB;
        }
    });
    if (direction === 'desc') {
        sorted.reverse();
    }
    return sorted;
});
export const clampedSidebarWidthAtom = atom(
    (get) => {
        const width = get(sidebarWidthAtom);
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    (get, set, newWidth: number) => {
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        set(sidebarWidthAtom, clampedWidth);
    }
);

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
export const renameChatAtom = atom(null, (get, set, payload: { chatId: number, newName: string }) => {
    const { chatId, newName } = payload; const sessionId = get(activeSessionIdAtom);
    if (sessionId === null) { console.error("Cannot rename chat: No active session."); return; }
    set(pastSessionsAtom, (prev) => prev.map(session => { if (session.id === sessionId) { const updatedChats = (session.chats || []).map(chat => chat.id === chatId ? { ...chat, name: newName.trim() || undefined } : chat); return { ...session, chats: updatedChats }; } return session; }));
    console.log(`Renamed chat ${chatId} in session ${sessionId} to: ${newName.trim()}`);
});
type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };
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
        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    sessionFound = true;
                    const initialChats = session.chats || [];
                    const chatIndex = initialChats.findIndex(c => c.id === chatId);
                    if (chatIndex === -1) { return session; }
                    chatDeleted = true;
                    remainingChats = [ ...initialChats.slice(0, chatIndex), ...initialChats.slice(chatIndex + 1) ];
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
    const query = get(currentQueryAtom);
    const sessionId = get(activeSessionIdAtom);
    const chatId = get(activeChatIdAtom);
    const chatting = get(isChattingAtom);

    if (chatting) {
        console.warn("Attempted to submit chat while AI is responding.");
        // Set error temporarily, might be cleared by typing
        set(chatErrorAtom, "Please wait for the current response to finish.");
        return;
    }
    if (!query.trim()) {
        set(chatErrorAtom, "Cannot send an empty message.");
        return;
    }
    if (sessionId === null || chatId === null) {
        set(chatErrorAtom, "Please start or select a chat first.");
        return;
    }
    const session = get(activeSessionAtom);
    const chat = get(activeChatAtom);
    if (!session || !chat) {
        set(chatErrorAtom, `Error: Active session or chat not found.`);
        return;
    }

    const userMessageId = Date.now() + 1;
    const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: query, starred: false };
    set(addChatMessageAtom, newUserMessage); // Add user message

    const querySentToApi = query;
    set(currentQueryAtom, ''); // Clear input
    set(isChattingAtom, true); // Set chatting state
    set(chatErrorAtom, ''); // Clear any previous errors
    set(toastMessageAtom, null); // Clear any pending toast

    // --- Simulate API Call ---
    console.log("Simulating AI response for:", querySentToApi);
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));

    if (!get(isChattingAtom)) { // Check if cancelled during wait
        console.log("Chat response cancelled before completion.");
        // No need to set toast here, cancelChatResponseAtom handles it
        return;
    }
    // --- End Simulation ---

    try {
        const aiResponseText = `Simulated analysis of "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response]`;
        const aiMessageId = Date.now() + 2;
        const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };
        set(addChatMessageAtom, aiResponseMessage); // Add AI message
    } catch (error) {
        console.error("Chat API simulation error:", error);
        set(chatErrorAtom, "Failed to get response from AI (simulated error).");
    } finally {
        if (get(isChattingAtom)) { // Only reset if not cancelled
           set(isChattingAtom, false);
        }
    }
});

// --- Updated Atom for Cancelling Chat Response ---
export const cancelChatResponseAtom = atom(
    null, // Read function (not needed)
    (get, set) => {
        if (get(isChattingAtom)) {
            console.log("Attempting to cancel chat response...");
            // **Placeholder:** Abort API request here in real app.
            set(isChattingAtom, false); // Reset chatting state
            set(chatErrorAtom, ''); // Clear any potentially related errors like "waiting"
            set(toastMessageAtom, "AI response cancelled."); // Set the toast message
        }
    }
);

// Action Atom to Handle Sorting Click
export const setSessionSortAtom = atom(
    null, // No read function needed
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
