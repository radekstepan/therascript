/* packages/ui/src/api/chat.ts */
import axios from 'axios';
import type {
  ChatSession,
  ChatMessage,
  BackendChatSession,
  BackendChatMessage,
  StandaloneChatListItem,
  UIContextUsageResponse,
} from '../types';

const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

// Common Message Mapping
const mapBackendMessageToUi = (msg: BackendChatMessage): ChatMessage => ({
  id: msg.id,
  chatId: msg.chatId,
  sender: msg.sender,
  text: msg.text,
  timestamp: msg.timestamp,
  promptTokens: msg.promptTokens ?? undefined,
  completionTokens: msg.completionTokens ?? undefined,
  duration: msg.duration ?? undefined,
});

// ==============================
// --- Session Chat Endpoints ---
// ==============================

export const fetchSessionChatDetails = async (
  sessionId: number,
  chatId: number
): Promise<ChatSession> => {
  const response = await axios.get<BackendChatSession>(
    `/api/sessions/${sessionId}/chats/${chatId}`
  );
  const backendData = response.data;
  return {
    id: backendData.id,
    sessionId: backendData.sessionId,
    timestamp: backendData.timestamp,
    name: backendData.name === null ? null : backendData.name || undefined,
    tags: null,
    messages: (backendData.messages || []).map(mapBackendMessageToUi),
  };
};

export const startSessionChat = async (
  sessionId: number
): Promise<ChatSession> => {
  // Backend returns metadata without messages or tags for new chat
  const response = await axios.post<
    Omit<BackendChatSession, 'messages' | 'tags'>
  >(`/api/sessions/${sessionId}/chats/`);
  const chatMetadata = response.data;
  return {
    id: chatMetadata.id,
    sessionId: chatMetadata.sessionId,
    timestamp: chatMetadata.timestamp,
    name: chatMetadata.name === null ? null : chatMetadata.name || undefined,
    tags: null,
    messages: [], // New chat starts with no messages
  };
};

// Streaming Logic
const sendMessageAndStreamResponse = async (
  url: string,
  text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok || !response.body) {
    let errTxt = `HTTP error ${response.status}`;
    try {
      const e = await response.json();
      errTxt = e?.message || JSON.stringify(e);
    } catch {
      /* Ignore if body isn't JSON */
    }
    throw new Error(`Failed to initialize stream: ${errTxt}`);
  }
  const uid = response.headers.get('X-User-Message-Id');
  const userMessageId = uid ? parseInt(uid, 10) : -1; // Use -1 if header is missing or invalid
  if (isNaN(userMessageId)) {
    console.warn('Invalid X-User-Message-Id header received:', uid);
    // Decide on a fallback or throw an error. For now, using -1.
  }
  return { userMessageId, stream: response.body };
};

export const addSessionChatMessageStream = async (
  sessionId: number,
  chatId: number,
  text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
  const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
  return sendMessageAndStreamResponse(url, text);
};

export const renameSessionChat = async (
  sessionId: number,
  chatId: number,
  name: string | null
): Promise<ChatSession> => {
  // Returns metadata, messages undefined
  const response = await axios.patch<
    Omit<BackendChatSession, 'messages' | 'tags'>
  >(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
  const chatMetadata = response.data;
  return {
    id: chatMetadata.id,
    sessionId: chatMetadata.sessionId,
    timestamp: chatMetadata.timestamp,
    name: chatMetadata.name === null ? null : chatMetadata.name || undefined,
    tags: null,
    messages: undefined, // Explicitly set as API doesn't return messages here
  };
};

export const deleteSessionChat = async (
  sessionId: number,
  chatId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(
    `/api/sessions/${sessionId}/chats/${chatId}`
  );
  return response.data;
};

// =================================
// --- Standalone Chat Endpoints ---
// =================================

export const fetchStandaloneChats = async (): Promise<
  StandaloneChatListItem[]
> => {
  const response = await axios.get<BackendChatSession[]>('/api/chats'); // Backend returns BackendChatSession[]
  return response.data.map((chat) => ({
    id: chat.id,
    sessionId: null, // Explicitly null
    timestamp: chat.timestamp,
    name: chat.name === null ? null : chat.name || undefined,
    tags: chat.tags === null ? null : chat.tags || undefined, // Map null, or undefined to undefined
  }));
};

export const createStandaloneChat =
  async (): Promise<StandaloneChatListItem> => {
    const response = await axios.post<BackendChatSession>('/api/chats'); // Backend returns BackendChatSession
    const chatData = response.data;
    return {
      id: chatData.id,
      sessionId: null,
      timestamp: chatData.timestamp,
      name: chatData.name === null ? null : chatData.name || undefined,
      tags: chatData.tags === null ? null : chatData.tags || undefined,
    };
  };

export const fetchStandaloneChatDetails = async (
  chatId: number
): Promise<ChatSession> => {
  const response = await axios.get<BackendChatSession>(`/api/chats/${chatId}`);
  const backendData = response.data;
  return {
    id: backendData.id,
    sessionId: backendData.sessionId, // Should be null
    timestamp: backendData.timestamp,
    name: backendData.name === null ? null : backendData.name || undefined,
    tags: backendData.tags === null ? null : backendData.tags || undefined,
    messages: (backendData.messages || []).map(mapBackendMessageToUi),
  };
};

export const addStandaloneChatMessageStream = async (
  chatId: number,
  text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
  const url = `${API_BASE_URL}/api/chats/${chatId}/messages`;
  return sendMessageAndStreamResponse(url, text);
};

export const renameStandaloneChat = async (
  chatId: number,
  name: string | null,
  tags: string[] | null
): Promise<StandaloneChatListItem> => {
  const response = await axios.patch<BackendChatSession>( // Backend returns BackendChatSession
    `/api/chats/${chatId}/details`,
    { name, tags }
  );
  const chatData = response.data;
  return {
    id: chatData.id,
    sessionId: null,
    timestamp: chatData.timestamp,
    name: chatData.name === null ? null : chatData.name || undefined,
    tags: chatData.tags === null ? null : chatData.tags || undefined,
  };
};

export const deleteStandaloneChat = async (
  chatId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/chats/${chatId}`);
  return response.data;
};

// ================================
// --- Context Usage Endpoints  ---
// ================================

export const fetchSessionContextUsage = async (
  sessionId: number,
  chatId: number,
  opts?: { inputDraft?: string; reservedOutputTokens?: number }
): Promise<UIContextUsageResponse> => {
  const params: Record<string, any> = {};
  if (opts?.inputDraft) params.inputDraft = opts.inputDraft;
  if (typeof opts?.reservedOutputTokens === 'number')
    params.reservedOutputTokens = String(opts.reservedOutputTokens);
  const response = await axios.get<UIContextUsageResponse>(
    `/api/sessions/${sessionId}/chats/${chatId}/context-usage`,
    { params }
  );
  return response.data;
};

export const fetchStandaloneContextUsage = async (
  chatId: number,
  opts?: { inputDraft?: string; reservedOutputTokens?: number }
): Promise<UIContextUsageResponse> => {
  const params: Record<string, any> = {};
  if (opts?.inputDraft) params.inputDraft = opts.inputDraft;
  if (typeof opts?.reservedOutputTokens === 'number')
    params.reservedOutputTokens = String(opts.reservedOutputTokens);
  const response = await axios.get<UIContextUsageResponse>(
    `/api/chats/${chatId}/context-usage`,
    { params }
  );
  return response.data;
};
