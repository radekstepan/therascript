// src/store.ts
import { atom } from 'jotai';
import { SAMPLE_SESSIONS } from './sampleData';
import type { Session, ChatMessage, ChatSession, SessionMetadata } from './types';
import { getTodayDateString } from './helpers';

// --- Core State Atoms --- (Keep as is)
export const pastSessionsAtom = atom<Session[]>(SAMPLE_SESSIONS);
export const activeSessionIdAtom = atom<number | null>(null);
export const activeChatIdAtom = atom<number | null>(null);

// --- Upload Modal State Atoms --- (Keep as is)
export const isUploadModalOpenAtom = atom(false);
export const isTranscribingAtom = atom(false);
export const transcriptionErrorAtom = atom('');

// --- Chat State Atoms --- (Keep as is)
export const currentQueryAtom = atom('');
export const isChattingAtom = atom(false);
export const chatErrorAtom = atom('');

// --- Derived Read Atoms ---

// activeSessionAtom, activeChatAtom, currentChatMessagesAtom (Keep as is)
export const activeSessionAtom = atom<Session | null>((get) => {
  const sessions = get(pastSessionsAtom);
  const id = get(activeSessionIdAtom);
  return id !== null ? sessions.find(s => s.id === id) ?? null : null;
});

export const activeChatAtom = atom<ChatSession | null>((get) => {
  const session = get(activeSessionAtom);
  const chatId = get(activeChatIdAtom);
  if (!session || chatId === null) return null;
  return session.chats?.find(c => c.id === chatId) ?? null;
});

export const currentChatMessagesAtom = atom<ChatMessage[]>((get) => {
  const chat = get(activeChatAtom);
  return chat?.messages || [];
});

// Get a globally flattened list of starred messages including their names
export const starredMessagesAtom = atom<Pick<ChatMessage, 'id' | 'text' | 'starredName'>[]>((get) => { // Add starredName
    const sessions = get(pastSessionsAtom);
    const allStarred: Pick<ChatMessage, 'id' | 'text' | 'starredName'>[] = []; // Add starredName
    sessions.forEach(session => {
        session.chats?.forEach(chat => {
            chat.messages?.forEach(msg => {
                if (msg.starred) {
                    if (!allStarred.some(starred => starred.id === msg.id)) {
                        // Include starredName in the pushed object
                        allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                    }
                }
            });
        });
    });
    // Optionally sort by name or original text if needed
    // allStarred.sort((a, b) => (a.starredName || a.text).localeCompare(b.starredName || b.text));
    return allStarred;
});


// --- Write Atoms (Actions) ---

// openUploadModalAtom, closeUploadModalAtom, addSessionAtom,
// updateSessionMetadataAtom, saveTranscriptAtom, addChatMessageAtom (Keep as is)
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

// Action to star/unstar a message - Modified to handle name
export const starMessageAtom = atom(
    null,
    (get, set, payload: { chatId: number; messageId: number; shouldStar: boolean; name?: string }) => { // Add optional name
        const { chatId, messageId, shouldStar, name } = payload; // Destructure name
        const sessionId = get(activeSessionIdAtom);

        if (sessionId === null) {
            console.error("Cannot star/unstar message: No active session.");
            return;
        }

        set(pastSessionsAtom, (prevSessions) =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    const updatedChats = (session.chats || []).map(chat => {
                        if (chat.id === chatId) {
                            const updatedMessages = (chat.messages || []).map(msg =>
                                msg.id === messageId
                                    ? {
                                        ...msg,
                                        starred: shouldStar,
                                        // Set name if starring, clear if unstarring
                                        starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined
                                      }
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
        if (shouldStar) {
            console.log(`Message ${messageId} in chat ${chatId} starred with name "${name || 'Default Name'}"`);
        } else {
            console.log(`Message ${messageId} in chat ${chatId} unstarred`);
        }
    }
);


// startNewChatAtom, renameChatAtom, handleStartTranscriptionAtom, handleChatSubmitAtom (Keep as is)
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
