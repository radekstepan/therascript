/* packages/ui/src/api/api.ts */
import axios from 'axios';
import type {
    Session,
    SessionMetadata,
    ChatSession,
    ChatMessage,
    StructuredTranscript,
    TranscriptParagraphData,
    OllamaStatus,
    AvailableModelsResponse,
} from '../types';

// Define the API base URL (ensure this matches your backend)
const API_BASE_URL = 'http://localhost:3001'; // Or use an environment variable

// Define WhisperJobStatus for UI (matching API response schema)
export interface UITranscriptionStatus {
    job_id: string;
    status: "queued" | "processing" | "completed" | "failed" | "canceled";
    progress?: number;
    error?: string;
    duration?: number;
}

// --- Axios requests remain unchanged, assuming baseURL is set globally ---

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
    return response.data;
};

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        messages: [] // Initialize with empty messages array
    };
};

// --- Modified addChatMessageStream with Base URL and Refined Error Handling ---
// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Streaming)
export const addChatMessageStream = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    let response: Response;
    // --- Construct full URL for fetch ---
    const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
    console.log(`[addChatMessageStream] Fetching URL: ${url}`);
    // --- End URL construction ---
    try {
        response = await fetch(url, { // Use the constructed URL
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    } catch (networkError) {
        console.error("[addChatMessageStream] Network error during fetch:", networkError);
        throw new Error(`Network error sending message: ${networkError instanceof Error ? networkError.message : 'Unknown network error'}`);
    }

    if (!response.ok || !response.body) {
        let errorBodyText = `HTTP error ${response.status}`;
        let errorJson = null;
        try {
            errorJson = await response.json(); // Try JSON first
            errorBodyText = errorJson?.message || JSON.stringify(errorJson);
            console.error(`[addChatMessageStream] Server error response (JSON): ${response.status}`, errorJson);
        } catch (e) {
            console.warn("[addChatMessageStream] Error response was not valid JSON.");
            try {
                 // IMPORTANT: Clone the response before reading text if you might need JSON later
                 // However, since JSON failed, we likely just need the text now.
                 const textResponse = await response.text(); // Read as text
                 errorBodyText = textResponse || errorBodyText; // Use text if available
                 console.error(`[addChatMessageStream] Server error response (Text): ${response.status}`, errorBodyText);
            } catch (textError) {
                 console.error("[addChatMessageStream] Failed to read error response body as Text:", textError);
            }
        }
        throw new Error(`Failed to initiate stream: ${errorBodyText}`);
    }

    const userMessageIdStr = response.headers.get('X-User-Message-Id');
    const userMessageId = userMessageIdStr ? parseInt(userMessageIdStr, 10) : -1;

    if(userMessageId === -1) {
        console.warn("[addChatMessageStream] X-User-Message-Id header not found in response. Will rely on SSE event.");
    }

    return { userMessageId, stream: response.body };
};
// --- End Modification ---

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name
export const renameChat = async (sessionId: number, chatId: number, name: string | null): Promise<ChatSession> => {
    const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
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

// Fetch Ollama Status
export const fetchOllamaStatus = async (modelName?: string): Promise<OllamaStatus> => {
    const endpoint = '/api/ollama/status';
    const params = modelName ? { modelName } : {};
    console.log(`Fetching Ollama status from ${endpoint} ${modelName ? `for model ${modelName}`: '(active)'}`);
    const response = await axios.get<OllamaStatus>(endpoint, { params });
    return response.data;
};

// Fetch Available Models
export const fetchAvailableModels = async (): Promise<AvailableModelsResponse> => {
    console.log("Fetching available models from /api/ollama/available-models");
    const response = await axios.get<AvailableModelsResponse>('/api/ollama/available-models');
    return response.data;
};

// Set Active Model
export const setOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    console.log(`Sending request to set active model: ${modelName}`);
    const response = await axios.post('/api/ollama/set-model', { modelName });
    return response.data;
};

// Pull Model
export const pullOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    console.log(`Sending request to pull model: ${modelName}`);
    const response = await axios.post('/api/ollama/pull-model', { modelName });
    return response.data;
};
