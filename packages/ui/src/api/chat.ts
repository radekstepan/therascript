// =========================================
// File: packages/ui/src/api/chat.ts
// =========================================
import axios from 'axios';
import type {
    ChatSession,
    ChatMessage,
    BackendChatSession,
    BackendChatMessage,
    StandaloneChatListItem, // <-- Import moved type
} from '../types';

// Define the API base URL (ensure this matches your backend)
const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

// --- Common Message Mapping ---
const mapBackendMessageToUi = (msg: BackendChatMessage): ChatMessage => ({
    ...msg,
    starred: !!msg.starred, // Map 0/1 to boolean
    starredName: msg.starredName ?? undefined, // Map null to undefined
});

// --- Session Chat Endpoints ---

// GET /api/sessions/{sessionId}/chats/{chatId}
export const fetchSessionChatDetails = async (sessionId: number, chatId: number): Promise<ChatSession> => {
    const response = await axios.get<BackendChatSession>(`/api/sessions/${sessionId}/chats/${chatId}`);
    return {
         ...response.data,
         tags: null, // Session chats don't have tags yet
         messages: (response.data.messages || []).map(mapBackendMessageToUi),
     };
};

// POST /api/sessions/{sessionId}/chats/
export const startSessionChat = async (sessionId: number): Promise<ChatSession> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    const chatMetadata = response.data; // Backend returns metadata only
    return {
        ...chatMetadata,
        tags: null, // Session chats don't have tags yet
        messages: [] // Initially empty
    };
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Streaming - Uses Fetch)
export const addSessionChatMessageStream = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    // Fetch implementation remains the same, just moved here
    const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), });
    if (!response.ok || !response.body) { let errTxt = `HTTP err ${response.status}`; try { const e = await response.json(); errTxt = e?.message || JSON.stringify(e); } catch {} throw new Error(`Failed stream init: ${errTxt}`); }
    const uid = response.headers.get('X-User-Message-Id');
    const userMessageId = uid ? parseInt(uid, 10) : -1;
    return { userMessageId, stream: response.body };
};

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name (Should be /details if adding tags)
export const renameSessionChat = async (sessionId: number, chatId: number, name: string | null): Promise<ChatSession> => {
    // Note: Backend currently only handles name for session chats
    const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
    const chatMetadata = response.data;
    return { ...chatMetadata, tags: null, messages: undefined }; // Return only metadata
};

// DELETE /api/sessions/{sessionId}/chats/{chatId}
export const deleteSessionChat = async (sessionId: number, chatId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}/chats/${chatId}`);
    return response.data;
};

// --- Standalone Chat Endpoints ---

// GET /api/chats
export const fetchStandaloneChats = async (): Promise<StandaloneChatListItem[]> => {
    const response = await axios.get<StandaloneChatListItem[]>('/api/chats');
    return response.data.map(chat => ({ ...chat, tags: chat.tags ?? null }));
};

// POST /api/chats
export const createStandaloneChat = async (): Promise<StandaloneChatListItem> => {
    const response = await axios.post<StandaloneChatListItem>('/api/chats');
    return { ...response.data, tags: response.data.tags ?? null };
};

// GET /api/chats/{chatId}
export const fetchStandaloneChatDetails = async (chatId: number): Promise<ChatSession> => {
    const response = await axios.get<BackendChatSession>(`/api/chats/${chatId}`);
    return { ...response.data, tags: response.data.tags ?? null, messages: (response.data.messages || []).map(mapBackendMessageToUi) };
};

// POST /api/chats/{chatId}/messages (Streaming - Uses Fetch)
export const addStandaloneChatMessageStream = async (chatId: number, text: string): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    const url = `${API_BASE_URL}/api/chats/${chatId}/messages`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), });
    if (!response.ok || !response.body) { let errTxt = `HTTP err ${response.status}`; try { const e = await response.json(); errTxt = e?.message || JSON.stringify(e); } catch {} throw new Error(`Failed stream init: ${errTxt}`); }
    const uid = response.headers.get('X-User-Message-Id');
    const userMessageId = uid ? parseInt(uid, 10) : -1;
    return { userMessageId, stream: response.body };
};

// PATCH /api/chats/{chatId}/details
export const renameStandaloneChat = async (chatId: number, name: string | null, tags: string[] | null): Promise<StandaloneChatListItem> => {
    const response = await axios.patch<StandaloneChatListItem>(`/api/chats/${chatId}/details`, { name, tags });
    return { ...response.data, tags: response.data.tags ?? null };
};

// DELETE /api/chats/{chatId}
export const deleteStandaloneChat = async (chatId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/chats/${chatId}`);
    return response.data;
};

// --- Shared Chat Endpoints ---

// PATCH Message Star Status
export const updateMessageStarStatus = async (messageId: number, starred: boolean, starredName?: string | null, chatId?: number, sessionId?: number | null): Promise<ChatMessage> => {
    const payload = { starred, starredName: starred ? starredName : null };
    let url: string;
    if (sessionId !== undefined && sessionId !== null && chatId !== undefined) url = `/api/sessions/${sessionId}/chats/${chatId}/messages/${messageId}`;
    else if (chatId !== undefined) url = `/api/chats/${chatId}/messages/${messageId}`;
    else throw new Error("Missing IDs for star update.");
    const response = await axios.patch<BackendChatMessage>(url, payload);
    return mapBackendMessageToUi(response.data);
};

// GET Starred Messages
export const fetchStarredMessages = async (): Promise<ChatMessage[]> => {
    const response = await axios.get<BackendChatMessage[]>('/api/starred-messages');
    return (response.data || []).map(mapBackendMessageToUi);
};
// TODO comments should not be removed
