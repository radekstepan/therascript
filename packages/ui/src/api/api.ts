// packages/ui/src/api/api.ts
import axios from 'axios';
import type {
    Session,
    SessionMetadata,
    ChatSession,
    ChatMessage,
    StructuredTranscript,
    OllamaStatus,
    AvailableModelsResponse,
    UIPullJobStatus,
    OllamaModelInfo, // Ensure this is imported
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

// --- Session and Transcript Endpoints ---

// GET /api/sessions/
export const fetchSessions = async (): Promise<Session[]> => {
    const response = await axios.get('/api/sessions/');
    return response.data.map((item: any) => ({
        ...item,
        transcriptTokenCount: item.transcriptTokenCount, // <-- Ensure token count is mapped
        chats: item.chats || [],
    }));
};

// POST /api/sessions/upload
export const uploadSession = async (file: File, metadata: SessionMetadata): Promise<{ sessionId: number; jobId: string; message: string }> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
    const response = await axios.post('/api/sessions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// GET /api/transcription/status/{jobId}
export const fetchTranscriptionStatus = async (jobId: string): Promise<UITranscriptionStatus> => {
    const response = await axios.get<UITranscriptionStatus>(`/api/transcription/status/${jobId}`);
    return response.data;
};

// POST /api/sessions/{sessionId}/finalize
export const finalizeSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.post<Session>(`/api/sessions/${sessionId}/finalize`);
     return {
        ...response.data,
        transcriptTokenCount: response.data.transcriptTokenCount, // <-- Ensure token count is mapped
        chats: response.data.chats || [],
     };
};


// GET /api/sessions/{sessionId}
export const fetchSession = async (sessionId: number): Promise<Session> => {
    const response = await axios.get(`/api/sessions/${sessionId}`);
    // Ensure audioPath is included and chats array exists
    return {
        ...response.data,
        audioPath: response.data.audioPath || null,
        transcriptTokenCount: response.data.transcriptTokenCount, // <-- Ensure token count is mapped
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
    return response.data;
};

// PUT /api/sessions/{sessionId}/metadata
export const updateSessionMetadata = async (
    sessionId: number,
    metadata: Partial<SessionMetadata & { audioPath?: string | null; transcriptTokenCount?: number | null }> // <-- Allow token count update
): Promise<SessionMetadata> => {
    const response = await axios.put(`/api/sessions/${sessionId}/metadata`, metadata);
    return response.data;
};

// PATCH /api/sessions/{sessionId}/transcript
export const updateTranscriptParagraph = async (
    sessionId: number,
    paragraphIndex: number,
    newText: string
): Promise<StructuredTranscript> => {
    const response = await axios.patch<StructuredTranscript>(`/api/sessions/${sessionId}/transcript`, { paragraphIndex, newText });
    return response.data;
};

// DELETE /api/sessions/{sessionId}/audio
export const deleteSessionAudio = async (sessionId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}/audio`);
    return response.data;
};

// --- NEW: Delete Entire Session ---
// DELETE /api/sessions/{sessionId}
export const deleteSession = async (sessionId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}`);
    return response.data;
};
// --- END NEW ---


// --- Chat Endpoints ---

// POST /api/sessions/{sessionId}/chats/
export const startNewChat = async (sessionId: number): Promise<ChatSession> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        messages: []
    };
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Streaming - Uses Fetch)
export const addChatMessageStream = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    let response: Response;
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

    if (!response.ok || !response.body) {
        let errorBodyText = `HTTP error ${response.status}`;
        try { const errorJson = await response.json(); errorBodyText = errorJson?.message || JSON.stringify(errorJson); } catch (e) { /* ignore json parse error */ }
        throw new Error(`Failed to initiate stream: ${errorBodyText}`);
    }

    const userMessageIdStr = response.headers.get('X-User-Message-Id');
    const userMessageId = userMessageIdStr ? parseInt(userMessageIdStr, 10) : -1;
    if(userMessageId === -1) { console.warn("[addChatMessageStream] X-User-Message-Id header not found or invalid."); }

    return { userMessageId, stream: response.body };
};

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


// --- Ollama Management Endpoints ---

// POST /api/ollama/unload
export const unloadOllamaModel = async (): Promise<{ message: string }> => {
    console.log("Sending request to /api/ollama/unload");
    const response = await axios.post('/api/ollama/unload');
    return response.data;
};

// GET /api/ollama/status
export const fetchOllamaStatus = async (modelName?: string): Promise<OllamaStatus> => {
    const endpoint = '/api/ollama/status';
    const params = modelName ? { modelName } : {};
    console.log(`Fetching Ollama status from ${endpoint} ${modelName ? `for model ${modelName}`: '(active)'}`);
    const response = await axios.get<OllamaStatus>(endpoint, { params });
    return response.data;
};

// GET /api/ollama/available-models
export const fetchAvailableModels = async (): Promise<AvailableModelsResponse> => {
    console.log("Fetching available models from /api/ollama/available-models");
    const response = await axios.get<AvailableModelsResponse>('/api/ollama/available-models');
    return response.data;
};

// POST /api/ollama/set-model
export const setOllamaModel = async (modelName: string, contextSize?: number | null): Promise<{ message: string }> => {
    console.log(`Sending request to set active model: ${modelName} with contextSize: ${contextSize ?? 'default'}`);
    const payload = { modelName, contextSize: contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize };
    const response = await axios.post('/api/ollama/set-model', payload);
    return response.data;
};

// POST /api/ollama/pull-model
export const startPullOllamaModel = async (modelName: string): Promise<{ jobId: string }> => {
    console.log(`[API] Initiating POST to start pull job for model: ${modelName}`);
    const response = await axios.post<{ jobId: string; message: string }>('/api/ollama/pull-model', { modelName });
    if (response.status !== 202 || !response.data.jobId) { throw new Error(`Failed to start pull job.`); }
    return { jobId: response.data.jobId };
};

// GET /api/ollama/pull-status/{jobId}
export const fetchPullOllamaModelStatus = async (jobId: string): Promise<UIPullJobStatus> => {
     console.log(`[API] Fetching status for pull job ID: ${jobId}`);
     if (!jobId) { throw new Error("Cannot fetch status without a Job ID."); }
     const response = await axios.get<UIPullJobStatus>(`/api/ollama/pull-status/${jobId}`);
     if (!response.data || typeof response.data !== 'object' || !response.data.jobId || !response.data.status) { throw new Error("Received invalid status object from API"); }
     return response.data;
 };

// POST /api/ollama/cancel-pull/{jobId}
export const cancelPullOllamaModel = async (jobId: string): Promise<{ message: string }> => {
     console.log(`[API] Sending request to cancel pull job ID: ${jobId}`);
     if (!jobId) { throw new Error("Cannot cancel job without a Job ID."); }
     const response = await axios.post<{ message: string }>(`/api/ollama/cancel-pull/${jobId}`);
     return response.data;
 };

// POST /api/ollama/delete-model
export const deleteOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    console.log(`[API] Sending request to delete model: ${modelName}`);
    // Assuming backend endpoint is POST /api/ollama/delete-model
    const response = await axios.post<{ message: string }>('/api/ollama/delete-model', { modelName });
    return response.data;
};

// TODO comments should not be removed
