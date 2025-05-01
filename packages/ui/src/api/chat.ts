// Purpose: Contains API call functions related to chat sessions (both session-based and standalone).
// =========================================
import axios from 'axios';
import type {
  ChatSession, // UI type for a full chat session (metadata + messages)
  ChatMessage, // UI type for a single message
  BackendChatSession, // Backend type for chat session (includes numeric starred)
  BackendChatMessage, // Backend type for message
  StandaloneChatListItem, // UI type for listing standalone chats
} from '../types';

// Define the API base URL (ensure this matches your backend)
const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

// --- Common Message Mapping ---
/**
 * Maps a backend chat message structure to the UI chat message structure.
 * Converts numeric `starred` (0/1) to boolean and handles `starredName`.
 * @param msg - The BackendChatMessage object.
 * @returns The corresponding ChatMessage object for the UI.
 */
const mapBackendMessageToUi = (msg: BackendChatMessage): ChatMessage => ({
  ...msg,
  starred: !!msg.starred, // Convert 0/1 to boolean
  starredName: msg.starredName ?? undefined, // Map null/undefined from DB to undefined for UI consistency
});
// --- End Common Message Mapping ---

// ==============================
// --- Session Chat Endpoints ---
// ==============================

/**
 * Fetches the full details of a specific chat within a session.
 * GET /api/sessions/{sessionId}/chats/{chatId}
 * @param sessionId - The ID of the parent session.
 * @param chatId - The ID of the chat to fetch.
 * @returns A promise resolving to the full ChatSession object (UI type).
 */
export const fetchSessionChatDetails = async (
  sessionId: number,
  chatId: number
): Promise<ChatSession> => {
  const response = await axios.get<BackendChatSession>(
    `/api/sessions/${sessionId}/chats/${chatId}`
  );
  // Map the backend response to the UI ChatSession type
  return {
    ...response.data,
    tags: null, // Session chats do not currently support tags in the backend/UI
    // Map backend messages to UI messages
    messages: (response.data.messages || []).map(mapBackendMessageToUi),
  };
};

/**
 * Starts a new chat within a specific session.
 * POST /api/sessions/{sessionId}/chats/
 * @param sessionId - The ID of the session to create the chat in.
 * @returns A promise resolving to the metadata of the newly created ChatSession (UI type, initially no messages).
 */
export const startSessionChat = async (
  sessionId: number
): Promise<ChatSession> => {
  // Backend returns only metadata for the new chat
  const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
  const chatMetadata = response.data;
  // Return a ChatSession object with empty messages array
  return {
    ...chatMetadata,
    tags: null, // Session chats don't have tags
    messages: [], // Initialize with empty messages
  };
};

/**
 * Adds a user message to a session chat and initiates a streaming response from the AI.
 * POST /api/sessions/{sessionId}/chats/{chatId}/messages
 * Uses the Fetch API directly to handle the ReadableStream response.
 * @param sessionId - The ID of the parent session.
 * @param chatId - The ID of the chat to add the message to.
 * @param text - The user's message text.
 * @returns A promise resolving to an object containing the actual user message ID (from header) and the response stream.
 * @throws If the request fails or the response body is not a stream.
 */
export const addSessionChatMessageStream = async (
  sessionId: number,
  chatId: number,
  text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
  const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
  // Use Fetch API for streaming response
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  // Check for successful response and presence of a response body
  if (!response.ok || !response.body) {
    let errTxt = `HTTP error ${response.status}`;
    try {
      // Attempt to parse error details from response body
      const e = await response.json();
      errTxt = e?.message || JSON.stringify(e);
    } catch {
      /* Ignore parsing error if body isn't JSON */
    }
    throw new Error(`Failed to initialize stream: ${errTxt}`);
  }
  // Get the actual user message ID from the custom header set by the backend
  const uid = response.headers.get('X-User-Message-Id');
  const userMessageId = uid ? parseInt(uid, 10) : -1; // Use -1 if header is missing
  // Return the ID and the stream
  return { userMessageId, stream: response.body };
};

/**
 * Renames a specific chat within a session.
 * PATCH /api/sessions/{sessionId}/chats/{chatId}/name
 * Note: Backend currently only supports updating the name for session chats.
 * @param sessionId - The ID of the parent session.
 * @param chatId - The ID of the chat to rename.
 * @param name - The new name for the chat (or null to remove the name).
 * @returns A promise resolving to the updated ChatSession metadata (UI type, messages undefined).
 */
export const renameSessionChat = async (
  sessionId: number,
  chatId: number,
  name: string | null
): Promise<ChatSession> => {
  // Backend expects { name: string | null }
  const response = await axios.patch(
    `/api/sessions/${sessionId}/chats/${chatId}/name`,
    { name }
  );
  const chatMetadata = response.data;
  // Return only metadata, explicitly setting messages to undefined as they aren't returned
  return { ...chatMetadata, tags: null, messages: undefined };
};

/**
 * Deletes a specific chat within a session.
 * DELETE /api/sessions/{sessionId}/chats/{chatId}
 * @param sessionId - The ID of the parent session.
 * @param chatId - The ID of the chat to delete.
 * @returns A promise resolving to a confirmation message object.
 */
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

/**
 * Fetches the list of all standalone chats (metadata only).
 * GET /api/chats
 * @returns A promise resolving to an array of StandaloneChatListItem objects.
 */
export const fetchStandaloneChats = async (): Promise<
  StandaloneChatListItem[]
> => {
  const response = await axios.get<StandaloneChatListItem[]>('/api/chats');
  // Ensure tags property exists and is null if missing from backend response
  return response.data.map((chat) => ({ ...chat, tags: chat.tags ?? null }));
};

/**
 * Creates a new standalone chat session.
 * POST /api/chats
 * @returns A promise resolving to the metadata of the newly created StandaloneChatListItem.
 */
export const createStandaloneChat =
  async (): Promise<StandaloneChatListItem> => {
    const response = await axios.post<StandaloneChatListItem>('/api/chats');
    // Ensure tags property exists and is null if missing
    return { ...response.data, tags: response.data.tags ?? null };
  };

/**
 * Fetches the full details of a specific standalone chat, including messages.
 * GET /api/chats/{chatId}
 * @param chatId - The ID of the standalone chat to fetch.
 * @returns A promise resolving to the full ChatSession object (UI type).
 */
export const fetchStandaloneChatDetails = async (
  chatId: number
): Promise<ChatSession> => {
  const response = await axios.get<BackendChatSession>(`/api/chats/${chatId}`);
  // Map backend response to UI ChatSession type
  return {
    ...response.data,
    tags: response.data.tags ?? null, // Handle tags
    messages: (response.data.messages || []).map(mapBackendMessageToUi), // Map messages
  };
};

/**
 * Adds a user message to a standalone chat and initiates a streaming response from the AI.
 * POST /api/chats/{chatId}/messages
 * Uses the Fetch API directly to handle the ReadableStream response.
 * @param chatId - The ID of the standalone chat.
 * @param text - The user's message text.
 * @returns A promise resolving to an object containing the actual user message ID (from header) and the response stream.
 * @throws If the request fails or the response body is not a stream.
 */
export const addStandaloneChatMessageStream = async (
  chatId: number,
  text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
  const url = `${API_BASE_URL}/api/chats/${chatId}/messages`;
  // Use Fetch API for streaming response
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  // Check for successful response and presence of a response body
  if (!response.ok || !response.body) {
    let errTxt = `HTTP error ${response.status}`;
    try {
      const e = await response.json();
      errTxt = e?.message || JSON.stringify(e);
    } catch {}
    throw new Error(`Failed to initialize stream: ${errTxt}`);
  }
  // Get user message ID from header
  const uid = response.headers.get('X-User-Message-Id');
  const userMessageId = uid ? parseInt(uid, 10) : -1;
  // Return ID and stream
  return { userMessageId, stream: response.body };
};

/**
 * Updates the details (name and tags) of a standalone chat.
 * PATCH /api/chats/{chatId}/details
 * @param chatId - The ID of the standalone chat to update.
 * @param name - The new name (or null to remove).
 * @param tags - The new array of tags (or null/empty array to remove).
 * @returns A promise resolving to the updated StandaloneChatListItem metadata.
 */
export const renameStandaloneChat = async (
  chatId: number,
  name: string | null,
  tags: string[] | null
): Promise<StandaloneChatListItem> => {
  // Backend expects { name: string | null, tags: string[] | null }
  const response = await axios.patch<StandaloneChatListItem>(
    `/api/chats/${chatId}/details`,
    { name, tags }
  );
  // Ensure tags property exists and is null if missing
  return { ...response.data, tags: response.data.tags ?? null };
};

/**
 * Deletes a specific standalone chat.
 * DELETE /api/chats/{chatId}
 * @param chatId - The ID of the standalone chat to delete.
 * @returns A promise resolving to a confirmation message object.
 */
export const deleteStandaloneChat = async (
  chatId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/chats/${chatId}`);
  return response.data;
};

// =============================
// --- Shared Chat Endpoints ---
// =============================

/**
 * Updates the star status and name of a specific message (user messages only).
 * Can be used for both session-based and standalone chats by providing appropriate IDs.
 * PATCH /api/sessions/{sessionId}/chats/{chatId}/messages/{messageId} OR /api/chats/{chatId}/messages/{messageId}
 * @param messageId - The ID of the message to update.
 * @param starred - The new star status (boolean).
 * @param starredName - Optional name for the starred template (used only if starred is true).
 * @param chatId - The ID of the chat containing the message.
 * @param sessionId - The ID of the session (null/undefined for standalone chats).
 * @returns A promise resolving to the updated ChatMessage object (UI type).
 * @throws If required IDs are missing or the API request fails.
 */
export const updateMessageStarStatus = async (
  messageId: number,
  starred: boolean,
  starredName?: string | null,
  chatId?: number, // Made chatId optional here, but required logically
  sessionId?: number | null // Optional sessionId distinguishes session vs standalone
): Promise<ChatMessage> => {
  // Payload for the PATCH request
  const payload = { starred, starredName: starred ? starredName : null };
  let url: string; // Determine the correct API URL based on presence of sessionId

  if (sessionId !== undefined && sessionId !== null && chatId !== undefined) {
    // Session chat message URL
    url = `/api/sessions/${sessionId}/chats/${chatId}/messages/${messageId}`;
  } else if (chatId !== undefined) {
    // Standalone chat message URL
    url = `/api/chats/${chatId}/messages/${messageId}`;
  } else {
    // Should not happen if called correctly, but defensively check
    throw new Error(
      'Missing required chat ID (and session ID if applicable) for star update.'
    );
  }

  // Make the PATCH request
  const response = await axios.patch<BackendChatMessage>(url, payload);
  // Map the backend response to the UI ChatMessage type
  return mapBackendMessageToUi(response.data);
};

// --- fetchStarredMessages removed from here, now lives in meta.ts ---
