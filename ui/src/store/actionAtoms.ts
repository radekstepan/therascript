// src/store/actionAtoms.ts
import { atom, Getter, Setter } from 'jotai';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    SessionSortCriteria,
    SortDirection,
} from './sessionAtoms';
import {
    activeChatIdAtom,
    isChattingAtom,
    chatErrorAtom,
} from './chatAtoms'; // Correct path
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
    toastMessageAtom,
} from './uiAtoms';
import {
    activeChatAtom,
} from './derivedAtoms';
import {
    fetchSessions,
    uploadSession,
    startNewChat as startNewChatApi,
    addChatMessage as addChatMessageApi,
    renameChat as renameChatApi,
    deleteChat as deleteChatApi,
    updateSessionMetadata as updateSessionMetadataApi,
    updateTranscriptParagraph as updateTranscriptParagraphApi,
    fetchChatDetails as fetchChatDetailsApi,
    fetchTranscript as fetchTranscriptApi,
    fetchSession as fetchSessionApi,
} from '../api/api';
import type { Session, ChatMessage, SessionMetadata, ChatSession } from '../types';

// --- Types for Action Results ---
type DeleteChatResult = { success: true; newActiveChatId: number | null } | { success: false; error: string };
type StartNewChatResult = { success: true; newChatId: number } | { success: false; error: string };

// --- UI Actions ---
export const openUploadModalActionAtom = atom(
    null,
    (get: Getter, set: Setter) => {
        set(transcriptionErrorAtom, '');
        set(isUploadModalOpenAtom, true);
    }
);

export const closeUploadModalActionAtom = atom(
    null,
    (get: Getter, set: Setter) => {
        if (!get(isTranscribingAtom)) {
            set(isUploadModalOpenAtom, false);
            set(transcriptionErrorAtom, '');
        } else {
            set(toastMessageAtom, "Please wait for the transcription to finish.");
        }
    }
);

// --- Session List Actions ---
export const refreshSessionsActionAtom = atom(
    null,
    async (get: Getter, set: Setter) => {
        try {
            const sessions = await fetchSessions();
            set(pastSessionsAtom, sessions);
        } catch (error) {
            console.error("Failed to refresh sessions:", error);
            set(toastMessageAtom, "Failed to refresh session list.");
        }
    }
);

export const setSessionSortActionAtom = atom(
    null,
    (get: Getter, set: Setter, newCriteria: SessionSortCriteria) => {
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

// --- Active Session Actions ---
export const loadSessionCoreActionAtom = atom(
    null,
    async (get: Getter, set: Setter, sessionId: number): Promise<Session | null> => {
        try {
            const [sessionBaseData, transcriptContent] = await Promise.all([
                fetchSessionApi(sessionId),
                fetchTranscriptApi(sessionId),
            ]);
            const initialChats = (Array.isArray(sessionBaseData.chats) ? sessionBaseData.chats : [])
                .map((chat: any) => ({ ...chat, messages: undefined }));

            const fullSession: Session = {
                ...sessionBaseData,
                transcription: transcriptContent || '',
                chats: initialChats as ChatSession[],
            };
            set(pastSessionsAtom, (prevSessions: Session[]) => {
                const sessionExists = prevSessions.some(s => s.id === sessionId);
                if (sessionExists) { return prevSessions.map((s: Session) => s.id === sessionId ? fullSession : s); }
                else { return [fullSession, ...prevSessions]; }
            });
            set(activeSessionIdAtom, sessionId);
            return fullSession;
        } catch (err) {
            console.error(`Error loading core session data for ${sessionId}:`, err);
            set(toastMessageAtom, `Failed to load session ${sessionId}.`);
            set(activeSessionIdAtom, null);
            return null;
        }
    }
);

export const loadChatMessagesActionAtom = atom(
    null,
    async (get: Getter, set: Setter, { sessionId, chatId }: { sessionId: number; chatId: number }): Promise<boolean> => {
        try {
            const detailedChatData = await fetchChatDetailsApi(sessionId, chatId);
            const chatWithMessages: ChatSession = { ...detailedChatData, messages: detailedChatData.messages || [] };
            set(pastSessionsAtom, (prevGlobalSessions: Session[]) => {
                return prevGlobalSessions.map((session: Session) => {
                    if (session.id === sessionId) {
                        return { ...session, chats: (session.chats || []).map((chat: ChatSession) => chat.id === chatId ? chatWithMessages : chat) };
                    } return session;
                })
            });
            return true;
        } catch (err) {
            console.error(`Failed load messages for chat ${chatId} in session ${sessionId}:`, err);
            set(chatErrorAtom, `Failed to load messages for this chat.`);
             set(pastSessionsAtom, (prevGlobalSessions: Session[]) => {
                return prevGlobalSessions.map((session: Session) => {
                    if (session.id === sessionId) {
                        return { ...session, chats: (session.chats || []).map((chat: ChatSession) => chat.id === chatId ? { ...chat, messages: [] } : chat) };
                    } return session;
                })
            });
            return false;
        }
    }
);

export const updateSessionMetadataActionAtom = atom(
    null,
    async (get: Getter, set: Setter, { sessionId, metadata }: { sessionId: number, metadata: Partial<SessionMetadata> }) => {
        const currentSession = get(pastSessionsAtom).find(s => s.id === sessionId);
        const originalMetadata = currentSession ? { clientName: currentSession.clientName, sessionName: currentSession.sessionName, date: currentSession.date, sessionType: currentSession.sessionType, therapy: currentSession.therapy } : {};
        try {
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, ...metadata } : s));
            const updatedMetadata = await updateSessionMetadataApi(sessionId, metadata);
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, ...updatedMetadata } : s));
            set(toastMessageAtom, "Session details updated.");
        } catch (error) {
            console.error(`Failed to update metadata for session ${sessionId}:`, error);
            set(toastMessageAtom, "Error updating session details.");
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, ...originalMetadata } : s));
        }
    }
);

export const updateTranscriptParagraphActionAtom = atom(
    null,
    async (get: Getter, set: Setter, { sessionId, paragraphIndex, newText }: { sessionId: number, paragraphIndex: number, newText: string }) => {
         const originalTranscript = get(pastSessionsAtom).find(s => s.id === sessionId)?.transcription;
        try {
            const updatedFullTranscript = await updateTranscriptParagraphApi(sessionId, paragraphIndex, newText);
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, transcription: updatedFullTranscript } : s));
             set(toastMessageAtom, "Transcript updated.");
        } catch (error) {
            console.error(`Failed to update paragraph ${paragraphIndex} for session ${sessionId}:`, error);
            set(toastMessageAtom, "Error updating transcript.");
             if (originalTranscript !== undefined) {
                  set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, transcription: originalTranscript } : s));
             }
        }
    }
);

// --- Chat Actions ---
export const startNewChatActionAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(
    null,
    async (get: Getter, set: Setter, { sessionId }: { sessionId: number }): Promise<StartNewChatResult> => {
        set(chatErrorAtom, '');
        try {
            const newChatMetaData = await startNewChatApi(sessionId);
            const newChatForState: ChatSession = { ...newChatMetaData, messages: [] };
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, chats: [...(s.chats || []), newChatForState] } : s));
            set(activeChatIdAtom, newChatForState.id);
            return { success: true, newChatId: newChatForState.id };
        } catch (err) {
            console.error("Failed to start new chat:", err);
            const error = 'Failed to start new chat.'; set(chatErrorAtom, error); return { success: false, error };
        }
    }
);

export const addChatMessageActionAtom = atom(
    null,
    async (get: Getter, set: Setter, messageText: string) => {
        const sessionId = get(activeSessionIdAtom); const chatId = get(activeChatIdAtom);
        if (sessionId === null || chatId === null) { set(chatErrorAtom, "Cannot send message: No active session or chat selected."); return; }
        if (!messageText.trim()) { set(chatErrorAtom, "Cannot send an empty message."); return; }
        set(chatErrorAtom, ''); set(isChattingAtom, true);
        try {
            const { userMessage, aiMessage } = await addChatMessageApi(sessionId, chatId, messageText.trim());
            set(pastSessionsAtom, (prevSessions: Session[]) =>
                prevSessions.map((session: Session) => {
                    if (session.id === sessionId) {
                        const updatedChats = (session.chats || []).map((chat: ChatSession) => {
                            if (chat.id === chatId) { return { ...chat, messages: [...(chat.messages || []), userMessage, aiMessage] }; } return chat;
                        }); return { ...session, chats: updatedChats };
                    } return session;
                })
            );
        } catch (err) {
            console.error("Error sending chat message:", err); set(chatErrorAtom, 'Failed to send message. Please try again.');
        } finally { set(isChattingAtom, false); }
    }
);

export const starMessageActionAtom = atom(
    null,
    (get: Getter, set: Setter, payload: { chatId: number; messageId: number; shouldStar: boolean; name?: string }) => {
        const { chatId, messageId, shouldStar, name } = payload; const sessionId = get(activeSessionIdAtom);
        if (sessionId === null) { set(toastMessageAtom, "Error: No active session selected."); return; }
        set(pastSessionsAtom, (prevSessions: Session[]) =>
            prevSessions.map((session: Session) => {
                if (session.id === sessionId) {
                    const updatedChats = (session.chats || []).map((chat: ChatSession) => {
                        if (chat.id === chatId) {
                            const updatedMessages = (chat.messages || []).map((msg: ChatMessage) => {
                                if (msg.id === messageId) { return { ...msg, starred: shouldStar, starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined }; } return msg;
                            }); return { ...chat, messages: updatedMessages };
                        } return chat;
                    }); return { ...session, chats: updatedChats };
                } return session;
            })
        );
        set(toastMessageAtom, shouldStar ? "Message starred as template." : "Message unstarred.");
    }
);

export const renameChatActionAtom = atom(
    null,
    async (get: Getter, set: Setter, payload: { chatId: number; newName: string }) => {
        const { chatId, newName } = payload; const sessionId = get(activeSessionIdAtom);
        if (sessionId === null) { set(chatErrorAtom, "Cannot rename chat: No active session."); return; }
        set(chatErrorAtom, ''); const originalName = get(activeChatAtom)?.name;
        try {
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, chats: (s.chats || []).map((c: ChatSession) => c.id === chatId ? { ...c, name: newName.trim() || undefined } : c) } : s));
            await renameChatApi(sessionId, chatId, newName.trim() || null); set(toastMessageAtom, "Chat renamed.");
        } catch (err) {
            console.error(`Failed to rename chat ${chatId}:`, err); set(chatErrorAtom, "Failed to rename chat.");
            set(pastSessionsAtom, (prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, chats: (s.chats || []).map((c: ChatSession) => c.id === chatId ? { ...c, name: originalName } : c) } : s));
        }
    }
);

export const deleteChatActionAtom = atom<null, [{ chatId: number }], Promise<DeleteChatResult>>(
    null,
    async (get: Getter, set: Setter, { chatId }: { chatId: number }): Promise<DeleteChatResult> => {
        const sessionId = get(activeSessionIdAtom);
        if (sessionId === null) { const error = "Cannot delete chat: No active session."; set(chatErrorAtom, error); return { success: false, error }; }
        set(chatErrorAtom, ''); const currentActiveChatIdBeforeDelete = get(activeChatIdAtom);
        try {
            await deleteChatApi(sessionId, chatId);
            let determinedNewActiveChatId: number | null = null;
            set(pastSessionsAtom, (prevSessions: Session[]) =>
                prevSessions.map((session: Session) => {
                    if (session.id === sessionId) {
                        const remainingChats = (session.chats || []).filter((c: ChatSession) => c.id !== chatId);
                        if (remainingChats.length > 0) {
                            if (currentActiveChatIdBeforeDelete === chatId) {
                                determinedNewActiveChatId = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
                            } else {
                                const currentStillExists = remainingChats.some(c => c.id === currentActiveChatIdBeforeDelete);
                                // Ensure determinedNewActiveChatId is number | null
                                const potentialNewActiveId = currentStillExists ? currentActiveChatIdBeforeDelete : [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0]?.id;
                                determinedNewActiveChatId = potentialNewActiveId ?? null;
                            }
                        } else { determinedNewActiveChatId = null; }
                        return { ...session, chats: remainingChats };
                    } return session;
                })
            );
             const sessionAfterDelete = get(pastSessionsAtom).find(s => s.id === sessionId);
             if (currentActiveChatIdBeforeDelete === chatId || sessionAfterDelete?.chats?.length === 0 ) {
                  set(activeChatIdAtom, determinedNewActiveChatId);
             }
            set(toastMessageAtom, "Chat deleted.");
            return { success: true, newActiveChatId: determinedNewActiveChatId };
        } catch (err) {
            console.error("Failed to delete chat:", err); const error = "Failed to delete chat."; set(chatErrorAtom, error); return { success: false, error };
        }
    }
);

// --- Upload/Transcription Action ---
export const uploadAndTranscribeActionAtom = atom<null, [{ file: File; metadata: SessionMetadata }], Promise<Session | null>>(
    null,
    async (get: Getter, set: Setter, { file, metadata }: { file: File; metadata: SessionMetadata }): Promise<Session | null> => {
        set(isTranscribingAtom, true); set(transcriptionErrorAtom, '');
        try {
            const newSession = await uploadSession(file, metadata);
            set(pastSessionsAtom, (prev: Session[]) => [newSession, ...prev]);
            set(isUploadModalOpenAtom, false);
            set(toastMessageAtom, "Session uploaded successfully!");
            return newSession;
        } catch (err) {
            console.error("Upload/Transcription failed:", err);
            const errorMsg = err instanceof Error ? err.message : 'An unknown error occurred during upload.';
            set(transcriptionErrorAtom, `Upload failed: ${errorMsg}`);
            return null;
        } finally { set(isTranscribingAtom, false); }
    }
);
