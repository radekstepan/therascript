import axios from 'axios';
import type { Session, SessionMetadata, ChatSession, ChatMessage } from '../types';

// TODO can we get types on all of the responses?
// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    // This endpoint likely returns an array of objects that match SessionMetadata
    // plus 'id' and 'fileName'. It might NOT include 'transcription' or 'chats'.
    const response = await axios.get('/api/sessions/');
    return response.data;
};

// POST /api/sessions/upload
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<Session> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
    const response = await axios.post('/api/sessions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    // Assume the upload response includes the full session details including transcription
    return response.data;
};

// GET /api/sessions/{sessionId} - Fetches metadata and chat list (messages likely missing in chats)
export const fetchSession = async (sessionId: number): Promise<Session> => {
    // Backend might return chats without messages here. Type is Session for simplicity,
    // but be aware 'messages' might be undefined/missing in the response's chat objects.
    const response = await axios.get(`/api/sessions/${sessionId}`);
    return response.data;
};

// GET /api/sessions/{sessionId}/transcript - Fetches only the transcript content
export const fetchTranscript = async (sessionId: number): Promise<string> => {
    const response = await axios.get(`/api/sessions/${sessionId}/transcript`);
    // Assuming API returns { transcriptContent: "..." } based on spec or actual behavior
    return response.data.transcriptContent;
};

// GET /api/sessions/{sessionId}/chats/{chatId} - Fetches full chat details including messages
export const fetchChatDetails = async (sessionId: number, chatId: number): Promise<ChatSession> => {
    // This endpoint is expected to return the ChatSession with the 'messages' array populated.
    const response = await axios.get(`/api/sessions/${sessionId}/chats/${chatId}`);
    return response.data; // Should match the ChatSession type (with messages)
};

// PUT /api/sessions/{sessionId}/metadata
export const updateSessionMetadata = async (
    sessionId: number,
    metadata: Partial<SessionMetadata>
): Promise<SessionMetadata> => {
    const response = await axios.put(`/api/sessions/${sessionId}/metadata`, metadata);
    return response.data;
};

// PATCH /api/sessions/{sessionId}/transcript - Update a specific paragraph
export const updateTranscriptParagraph = async (
    sessionId: number,
    paragraphIndex: number,
    newText: string
): Promise<string> => {
    const response = await axios.patch(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
    // Assuming API returns the updated full transcript content
    return response.data.transcriptContent;
};

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
    // This likely returns the new chat metadata, potentially without messages initially
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    // The response type from the backend should match ChatSession metadata (no messages)
    // Map it to ChatSession type for consistency, knowing messages might be missing
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        messages: [] // Initialize with empty messages array
    };
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages
export const addChatMessage = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessage: ChatMessage; aiMessage: ChatMessage }> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/${chatId}/messages`, { text });
    // The response type from the backend should match { userMessage: ChatMessage; aiMessage: ChatMessage }
    return response.data;
};

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name
export const renameChat = async (sessionId: number, chatId: number, name: string | null): Promise<ChatSession> => {
    // Returns updated chat metadata
    const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
    // Map response to ChatSession type, messages will be missing
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        // Messages are not returned by this endpoint, so keep them undefined or empty
        messages: undefined
    };
};

// DELETE /api/sessions/{sessionId}/chats/{chatId}
export const deleteChat = async (sessionId: number, chatId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}/chats/${chatId}`);
    return response.data;
};

// POST /api/ollama/unload
export const unloadOllamaModel = async (): Promise<{ message: string }> => {
    console.log("Sending request to /api/ollama/unload");
    const response = await axios.post('/api/ollama/unload');
    return response.data;
};

// GET /api/ollama/status
export const fetchOllamaStatus = async (): Promise<{ loaded: boolean; model?: string }> => {
    console.log("Fetching Ollama status from /api/ollama/status");
    const response = await axios.get('/api/ollama/status');
    return response.data;
};
