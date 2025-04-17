import axios from 'axios';
import type {
    Session,
    SessionMetadata,
    ChatSession,
    ChatMessage,
    StructuredTranscript,
    OllamaStatus,
    AvailableModelsResponse,
    // Add the UI Pull status type
    UIPullJobStatus,
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

// Removed SSE related types (OllamaPullProgressUpdate, OllamaPullCallbacks)


// --- Axios setup: Ensure baseURL is set if not done globally ---
// axios.defaults.baseURL = API_BASE_URL; // Uncomment if not set in App.tsx or index.tsx

// --- Session and Transcript Endpoints (Unchanged) ---

// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    const response = await axios.get('/api/sessions/');
    // Ensure chats array exists, even if empty
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
    return response.data; // Expects { sessionId, jobId, message }
};

// GET /api/transcription/status/{jobId}
export const fetchTranscriptionStatus = async (jobId: string): Promise<UITranscriptionStatus> => {
    const response = await axios.get<UITranscriptionStatus>(`/api/transcription/status/${jobId}`);
    return response.data;
};

// POST /api/sessions/{sessionId}/finalize
export const finalizeSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.post<Session>(`/api/sessions/${sessionId}/finalize`);
     // Ensure chats array exists in the response
     return {
        ...response.data,
        chats: response.data.chats || [],
     };
};


// GET /api/sessions/{sessionId}
export const fetchSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.get(`/api/sessions/${sessionId}`);
    // Ensure chats array exists
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

// PATCH /api/sessions/{sessionId}/transcript
export const updateTranscriptParagraph = async (
    sessionId: number,
    paragraphIndex: number, // Backend uses index
    newText: string
): Promise<StructuredTranscript> => { // Returns the full updated structured transcript
    const response = await axios.patch<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
    return response.data;
};

// --- Chat Endpoints (Unchanged, addChatMessageStream still uses Fetch API) ---

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    const chatMetadata = response.data;
    // Initialize with empty messages array for consistency
    return {
        ...chatMetadata,
        messages: []
    };
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Streaming - Still uses Fetch)
export const addChatMessageStream = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    let response: Response;
    // Construct URL using API_BASE_URL for Fetch
    const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
    console.log(`[addChatMessageStream] Fetching URL: ${url}`);
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    } catch (networkError) {
        console.error("[addChatMessageStream] Network error during fetch:", networkError);
        throw new Error(`Network error sending message: ${networkError instanceof Error ? networkError.message : 'Unknown network error'}`);
    }

    // Check response status
    if (!response.ok || !response.body) {
        let errorBodyText = `HTTP error ${response.status}`;
        let errorJson = null;
        try {
            errorJson = await response.json();
            errorBodyText = errorJson?.message || JSON.stringify(errorJson);
            console.error(`[addChatMessageStream] Server error response (JSON): ${response.status}`, errorJson);
        } catch (e) {
            console.warn("[addChatMessageStream] Error response was not valid JSON.");
            try {
                 const textResponse = await response.text();
                 errorBodyText = textResponse || errorBodyText;
                 console.error(`[addChatMessageStream] Server error response (Text): ${response.status}`, errorBodyText);
            } catch (textError) {
                 console.error("[addChatMessageStream] Failed to read error response body as Text:", textError);
            }
        }
        throw new Error(`Failed to initiate stream: ${errorBodyText}`);
    }

    // Extract user message ID from headers (optional but helpful)
    const userMessageIdStr = response.headers.get('X-User-Message-Id');
    const userMessageId = userMessageIdStr ? parseInt(userMessageIdStr, 10) : -1; // Use -1 if header missing

    if(userMessageId === -1) {
        console.warn("[addChatMessageStream] X-User-Message-Id header not found or invalid in response. Will rely on SSE event if available.");
    }

    return { userMessageId, stream: response.body };
};

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name
export const renameChat = async (sessionId: number, chatId: number, name: string | null): Promise<ChatSession> => {
    const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, { name });
    const chatMetadata = response.data;
    // Return metadata only, messages not relevant here
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


// --- Ollama Management Endpoints (Updated for Polling) ---

// POST /api/ollama/unload (Unchanged)
export const unloadOllamaModel = async (): Promise<{ message: string }> => {
    console.log("Sending request to /api/ollama/unload");
    const response = await axios.post('/api/ollama/unload');
    return response.data;
};

// GET /api/ollama/status (Unchanged)
export const fetchOllamaStatus = async (modelName?: string): Promise<OllamaStatus> => {
    const endpoint = '/api/ollama/status';
    const params = modelName ? { modelName } : {};
    console.log(`Fetching Ollama status from ${endpoint} ${modelName ? `for model ${modelName}`: '(active)'}`);
    const response = await axios.get<OllamaStatus>(endpoint, { params });
    return response.data;
};

// GET /api/ollama/available-models (Unchanged)
export const fetchAvailableModels = async (): Promise<AvailableModelsResponse> => {
    console.log("Fetching available models from /api/ollama/available-models");
    const response = await axios.get<AvailableModelsResponse>('/api/ollama/available-models');
    return response.data;
};

// POST /api/ollama/set-model (Unchanged)
export const setOllamaModel = async (modelName: string, contextSize?: number | null): Promise<{ message: string }> => {
    console.log(`Sending request to set active model: ${modelName} with contextSize: ${contextSize ?? 'default'}`);
    const payload = {
        modelName,
        // Ensure contextSize is null if undefined or <= 0
        contextSize: contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize
    };
    const response = await axios.post('/api/ollama/set-model', payload);
    return response.data;
};

// --- RENAMED: Start Pull Ollama Model Job ---
export const startPullOllamaModel = async (modelName: string): Promise<{ jobId: string }> => {
    console.log(`[API] Initiating POST to start pull job for model: ${modelName}`);
    // POST to the backend endpoint that starts the job
    const response = await axios.post<{ jobId: string; message: string }>(
        '/api/ollama/pull-model',
        { modelName } // Send model name in the body
    );
    // Check for 202 Accepted status and jobId in response
    if (response.status !== 202 || !response.data.jobId) {
         throw new Error(`Failed to start pull job. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
    }
    return { jobId: response.data.jobId }; // Return only the jobId
};

// --- NEW: Fetch Pull Ollama Model Status ---
export const fetchPullOllamaModelStatus = async (jobId: string): Promise<UIPullJobStatus> => {
     console.log(`[API] Fetching status for pull job ID: ${jobId}`);
     if (!jobId) {
         console.error("[API] fetchPullOllamaModelStatus called with no jobId");
         // Indicate a client-side error or return a default 'unknown' status
         throw new Error("Cannot fetch status without a Job ID.");
     }
     // GET the status from the backend using the jobId
     const response = await axios.get<UIPullJobStatus>(`/api/ollama/pull-status/${jobId}`);
     // Basic validation on the response data
     if (!response.data || typeof response.data !== 'object' || !response.data.jobId || !response.data.status) {
         console.error("[API] Received invalid status object:", response.data);
         throw new Error("Received invalid status object from API");
     }
     return response.data;
 };

 // --- NEW: Cancel Pull Ollama Model Job ---
export const cancelPullOllamaModel = async (jobId: string): Promise<{ message: string }> => {
     console.log(`[API] Sending request to cancel pull job ID: ${jobId}`);
     if (!jobId) {
         console.error("[API] cancelPullOllamaModel called with no jobId");
         throw new Error("Cannot cancel job without a Job ID.");
     }
     // POST to the cancel endpoint
     const response = await axios.post<{ message: string }>(`/api/ollama/cancel-pull/${jobId}`);
     return response.data;
 };
 