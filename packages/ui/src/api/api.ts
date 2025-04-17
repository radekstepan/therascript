/* packages/ui/src/api/api.ts */
// packages/ui/src/api/api.ts
import axios from 'axios';
import type {
    Session,
    SessionMetadata,
    ChatSession,
    ChatMessage,
    StructuredTranscript,
    TranscriptParagraphData,
    // --- Import new LLM types ---
    OllamaStatus,
    AvailableModelsResponse,
    // --- End LLM types ---
    // Remove WhisperJobStatus from this import
} from '../types';

// Define WhisperJobStatus for UI (matching API response schema)
export interface UITranscriptionStatus {
    job_id: string;
    status: "queued" | "processing" | "completed" | "failed" | "canceled";
    progress?: number;
    error?: string;
    duration?: number;
}


// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    const response = await axios.get('/api/sessions/');
    return response.data.map((item: any) => ({
        ...item,
        chats: item.chats || [],
    }));
};

// POST /api/sessions/upload (Modified Return Type)
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<{ sessionId: number; jobId: string; message: string }> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
    // Endpoint now returns { sessionId, jobId, message } with status 202
    const response = await axios.post('/api/sessions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// NEW: GET /api/transcription/status/{jobId}
export const fetchTranscriptionStatus = async (jobId: string): Promise<UITranscriptionStatus> => {
    const response = await axios.get<UITranscriptionStatus>(`/api/transcription/status/${jobId}`);
    return response.data;
};

// NEW: POST /api/sessions/{sessionId}/finalize
export const finalizeSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.post<Session>(`/api/sessions/${sessionId}/finalize`);
     // API returns the full session details including chats after finalization
     return {
        ...response.data,
        chats: response.data.chats || [], // Ensure chats array exists
     };
};


// GET /api/sessions/{sessionId}
export const fetchSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.get(`/api/sessions/${sessionId}`);
    return {
        ...response.data,
        chats: response.data.chats || [],
    };
};

// GET /api/sessions/{sessionId}/transcript
export const fetchTranscript = async (sessionId: number): Promise<StructuredTranscript> => {
    const response = await axios.get<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`);
    return response.data;
};

// GET /api/sessions/{sessionId}/chats/{chatId}
export const fetchChatDetails = async (sessionId: number, chatId: number): Promise<ChatSession> => {
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

// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Modified Return Type)
export const addChatMessage = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessage: ChatMessage; aiMessage: ChatMessage }> => { // aiMessage now includes tokens
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

// --- Modified fetchOllamaStatus ---
// Accepts optional modelName to check specific model status
export const fetchOllamaStatus = async (modelName?: string): Promise<OllamaStatus> => {
    const endpoint = '/api/ollama/status';
    const params = modelName ? { modelName } : {}; // Add query param if name is provided
    console.log(`Fetching Ollama status from ${endpoint} ${modelName ? `for model ${modelName}`: '(active)'}`);
    const response = await axios.get<OllamaStatus>(endpoint, { params });
    // The response from the backend *should* now include modelChecked field matching the requested modelName (or default)
    return response.data;
};
// --- End Modification ---

export const fetchAvailableModels = async (): Promise<AvailableModelsResponse> => {
    console.log("Fetching available models from /api/ollama/available-models");
    const response = await axios.get<AvailableModelsResponse>('/api/ollama/available-models');
    return response.data;
};

// --- NEW: Set Active Model API Call ---
export const setOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    console.log(`Sending request to set active model: ${modelName}`);
    const response = await axios.post('/api/ollama/set-model', { modelName });
    return response.data; // { message: "Active model set to..." }
};
// --- End New API Call ---

// --- NEW: Pull Model API Call ---
export const pullOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    console.log(`Sending request to pull model: ${modelName}`);
    // Backend returns 202 Accepted
    const response = await axios.post('/api/ollama/pull-model', { modelName });
    return response.data; // { message: "Pull initiated for model..." }
};
// --- End New API Call ---
