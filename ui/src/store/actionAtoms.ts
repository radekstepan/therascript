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
import { currentQueryAtom, isChattingAtom, chatErrorAtom, toastMessageAtom } from './chatAtoms';
import { fetchSessions, uploadSession, startNewChat, addChatMessage, renameChat } from '../api/api';
import type { Session, ChatMessage, SessionMetadata } from '../types';

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

// Session Actions
export const addSessionAtom = atom(null, async (get, set, newSession: Session) => {
  set(pastSessionsAtom, (prev) => [newSession, ...prev]);
  await fetchSessions(); // Refresh from backend
});

// Chat Message Actions
export const addChatMessageAtom = atom(null, async (get, set, message: ChatMessage) => {
  const sessionId = get(activeSessionIdAtom);
  const chatId = get(activeChatIdAtom);
  if (sessionId === null || chatId === null) {
    set(chatErrorAtom, "Cannot add message: No active session or chat.");
    return;
  }
  try {
    const { userMessage, aiMessage } = await addChatMessage(sessionId, chatId, message.text);
    set(pastSessionsAtom, (prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, userMessage, aiMessage] } : c)),
            }
          : s
      )
    );
  } catch (err) {
    set(chatErrorAtom, 'Failed to add message.');
  }
});

// Star Message Action
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
          const updatedChats = (Array.isArray(session.chats) ? session.chats : []).map((chat) => {
            if (chat.id === chatId) {
              const updatedMessages = (Array.isArray(chat.messages) ? chat.messages : []).map((msg) => {
                if (msg.id === messageId) {
                  return {
                    ...msg,
                    starred: shouldStar,
                    starredName: shouldStar ? (name?.trim() || msg.text.substring(0, 50) + '...') : undefined,
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
    const updatedChat = await renameChat(sessionId, chatId, newName.trim() || null);
    set(pastSessionsAtom, (prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, chats: s.chats.map((c) => (c.id === chatId ? { ...c, name: updatedChat.name } : c)) }
          : s
      )
    );
  } catch (err) {
    console.error(`Failed to rename chat ${chatId}:`, err);
    set(chatErrorAtom, "Failed to rename chat.");
  }
});

// Delete Chat Action (Synchronous, API call moved to component)
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
          const remainingChats = session.chats.filter((c) => c.id !== chatId);
          if (remainingChats.length > 0) {
            newActiveChatId = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
          }
          return { ...session, chats: remainingChats };
        }
        return session;
      })
    );
    const currentActiveChatId = get(activeChatIdAtom);
    if (currentActiveChatId === chatId) {
      set(activeChatIdAtom, newActiveChatId);
    }
    return { success: true, newActiveChatId };
  }
);

// Start New Chat
export const startNewChatAtom = atom<null, [{ sessionId: number }], Promise<StartNewChatResult>>(
  null,
  async (get, set, { sessionId }) => {
    if (!sessionId) {
      const error = "Error: Could not find session to start new chat.";
      set(chatErrorAtom, error);
      return { success: false, error };
    }
    try {
      const newChat = await startNewChat(sessionId);
      set(pastSessionsAtom, (prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, chats: [...(s.chats || []), newChat] } : s))
      );
      set(activeChatIdAtom, newChat.id);
      return { success: true, newChatId: newChat.id };
    } catch (err) {
      const error = 'Failed to start new chat.';
      set(chatErrorAtom, error);
      return { success: false, error };
    }
  }
);

// Transcription Action
export const handleStartTranscriptionAtom = atom<null, [{ file: File; metadata: SessionMetadata }], Promise<void>>(
  null,
  async (get, set, { file, metadata }) => {
    set(isTranscribingAtom, true);
    set(transcriptionErrorAtom, '');
    try {
      const newSession = await uploadSession(file, metadata);
      set(pastSessionsAtom, (prev) => [newSession, ...prev]);
    } catch (err) {
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
    set(sessionSortDirectionAtom, newCriteria === 'date' ? 'desc' : 'asc');
  }
});
