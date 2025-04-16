import axios from 'axios';
// Import the new structured transcript types
import type { Session, SessionMetadata, ChatSession, ChatMessage, StructuredTranscript, TranscriptParagraphData } from '../types';

// TODO can we get types on all of the responses?
// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    // Endpoint returns an array of objects matching SessionMetadata + id/fileName/transcriptPath
    const response = await axios.get('/api/sessions/');
    // Map response to Session type, transcript itself isn't included here
    return response.data.map((item: any) => ({
        ...item,
        // Ensure chats is an array, even if empty (backend might omit it)
        chats: item.chats || [],
        // Transcription field is removed from the Session type
    }));
};

// POST /api/sessions/upload
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<Session> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
    const response = await axios.post('/api/sessions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    // Assume the upload response includes the session details including the chat list
    // Map response to Session type
    return {
        ...response.data,
        // Ensure chats is an array
        chats: response.data.chats || [],
        // Transcription field is removed
    };
};

// GET /api/sessions/{sessionId} - Fetches metadata and chat list (messages likely missing in chats)
export const fetchSession = async (sessionId: number): Promise<Session> => {
    // Backend returns metadata + chat list (metadata only).
    const response = await axios.get(`/api/sessions/${sessionId}`);
    // Map response to Session type
    return {
        ...response.data,
        // Ensure chats is an array
        chats: response.data.chats || [],
        // Transcription field is removed
    };
};

// GET /api/sessions/{sessionId}/transcript - Fetches the structured transcript content
export const fetchTranscript = async (sessionId: number): Promise<StructuredTranscript> => {
    const response = await axios.get<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`);
    // API directly returns the array of TranscriptParagraphData
    return response.data;
};

// GET /api/sessions/{sessionId}/chats/{chatId} - Fetches full chat details including messages
export const fetchChatDetails = async (sessionId: number, chatId: number): Promise<ChatSession> => {
    // This endpoint returns the ChatSession with the 'messages' array populated.
    const response = await axios.get(`/api/sessions/${sessionId}/chats/${chatId}`);
    return response.data; // Should match the ChatSession type (with messages)
};

// PUT /api/sessions/{sessionId}/metadata
export const updateSessionMetadata = async (
    sessionId: number,
    metadata: Partial<SessionMetadata>
): Promise<SessionMetadata> => { // Returns updated metadata
    const response = await axios.put(`/api/sessions/${sessionId}/metadata`, metadata);
    return response.data;
};

// PATCH /api/sessions/{sessionId}/transcript - Update a specific paragraph
export const updateTranscriptParagraph = async (
    sessionId: number,
    paragraphIndex: number, // Backend uses index
    newText: string
): Promise<StructuredTranscript> => { // Returns the full updated structured transcript
    const response = await axios.patch<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
    // API returns the updated full transcript array
    return response.data;
};

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
    // Returns the new chat metadata
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    // Map response to ChatSession type
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
    // Map response to ChatSession type
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        // Messages are not returned by this endpoint
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
