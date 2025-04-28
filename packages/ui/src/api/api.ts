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
    OllamaModelInfo,
    DockerContainerStatus,
    BackendChatSession,
    BackendChatMessage, // Import backend type
    SearchApiResponse, // <-- Import new type
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

// Define type for standalone chat list item (metadata only)
export interface StandaloneChatListItem {
  id: number;
  sessionId: null; // Should always be null
  timestamp: number;
  name?: string;
  tags?: string[] | null; // <-- Added tags
}


// --- Session and Transcript Endpoints ---

// GET /api/sessions/
// Fetch only metadata for list view
export const fetchSessions = async (): Promise<Session[]> => {
    const response = await axios.get('/api/sessions/');
    // API now returns only metadata, map it to the Session type for UI consistency for now
    // although the 'chats' array will be empty/not populated
    return response.data.map((sessionMeta: any) => ({
        ...sessionMeta,
        chats: [], // Indicate no chat details fetched here
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
// Renamed for clarity: fetches details for a chat *within* a session
// Map BackendChatMessage to UI ChatMessage
export const fetchSessionChatDetails = async (sessionId: number, chatId: number): Promise<ChatSession> => {
    const response = await axios.get<BackendChatSession>(`/api/sessions/${sessionId}/chats/${chatId}`);
    return {
         ...response.data,
         messages: (response.data.messages || []).map(msg => ({
             ...msg,
             starred: !!msg.starred, // Map 0/1 to boolean
             starredName: msg.starredName ?? undefined, // Map null to undefined
         })),
     };
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

// DELETE /api/sessions/{sessionId}
export const deleteSession = async (sessionId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}`);
    return response.data;
};


// --- Session Chat Endpoints ---

// POST /api/sessions/{sessionId}/chats/
// Renamed for clarity: starts a chat *within* a session
export const startSessionChat = async (sessionId: number): Promise<ChatSession> => {
    const response = await axios.post(`/api/sessions/${sessionId}/chats/`);
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        messages: []
    };
};

// POST /api/sessions/{sessionId}/chats/{chatId}/messages (Streaming - Uses Fetch)
// Renamed for clarity
export const addSessionChatMessageStream = async (
    sessionId: number,
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    let response: Response;
    const url = `${API_BASE_URL}/api/sessions/${sessionId}/chats/${chatId}/messages`;
    console.log(`[addSessionChatMessageStream] Fetching URL: ${url}`);
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    } catch (networkError) {
        console.error("[addSessionChatMessageStream] Network error during fetch:", networkError);
        throw new Error(`Network error sending message: ${networkError instanceof Error ? networkError.message : 'Unknown network error'}`);
    }

    if (!response.ok || !response.body) {
        let errorBodyText = `HTTP error ${response.status}`;
        try { const errorJson = await response.json(); errorBodyText = errorJson?.message || JSON.stringify(errorJson); } catch (e) { /* ignore json parse error */ }
        throw new Error(`Failed to initiate stream: ${errorBodyText}`);
    }

    const userMessageIdStr = response.headers.get('X-User-Message-Id');
    const userMessageId = userMessageIdStr ? parseInt(userMessageIdStr, 10) : -1;
    if(userMessageId === -1) { console.warn("[addSessionChatMessageStream] X-User-Message-Id header not found or invalid."); }

    return { userMessageId, stream: response.body };
};

// PATCH /api/sessions/{sessionId}/chats/{chatId}/name (Should be /details if adding tags)
// Renamed for clarity - NOTE: Backend needs update for tags
export const renameSessionChat = async (
    sessionId: number,
    chatId: number,
    name: string | null,
    tags?: string[] // <-- Add tags parameter conceptually
): Promise<ChatSession> => {
    // TODO: Update backend to accept tags
    // Note: Backend currently only handles name for session chats
    const payload = { name };
    console.log(`[API Placeholder] Renaming session chat ${chatId} with payload:`, payload);
    const response = await axios.patch(`/api/sessions/${sessionId}/chats/${chatId}/name`, payload);
    const chatMetadata = response.data;
    return {
        ...chatMetadata,
        tags: chatMetadata.tags ?? null, // <-- Include tags in response conceptually
        messages: undefined // Return only metadata
    };
};

// DELETE /api/sessions/{sessionId}/chats/{chatId}
// Renamed for clarity
export const deleteSessionChat = async (sessionId: number, chatId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/sessions/${sessionId}/chats/${chatId}`);
    return response.data;
};


// --- Standalone Chat Endpoints ---

// GET /api/chats
// Update return type to include tags
export const fetchStandaloneChats = async (): Promise<StandaloneChatListItem[]> => {
    const response = await axios.get<StandaloneChatListItem[]>('/api/chats');
    // Ensure tags is an array or null
    return response.data.map(chat => ({ ...chat, tags: chat.tags ?? null }));
};

// POST /api/chats
// Update return type to include tags
export const createStandaloneChat = async (): Promise<StandaloneChatListItem> => {
    const response = await axios.post<StandaloneChatListItem>('/api/chats');
    return { ...response.data, tags: response.data.tags ?? null }; // Returns metadata of the created chat
};

// GET /api/chats/{chatId}
// Map BackendChatMessage to UI ChatMessage, include tags
export const fetchStandaloneChatDetails = async (chatId: number): Promise<ChatSession> => {
    const response = await axios.get<BackendChatSession>(`/api/chats/${chatId}`);
    return {
         ...response.data,
         tags: response.data.tags ?? null, // <-- Include tags
         messages: (response.data.messages || []).map(msg => ({
             ...msg,
             starred: !!msg.starred, // Map 0/1 to boolean
             starredName: msg.starredName ?? undefined, // Map null to undefined
         })),
     };
};


// POST /api/chats/{chatId}/messages (Streaming - Uses Fetch)
export const addStandaloneChatMessageStream = async (
    chatId: number,
    text: string
): Promise<{ userMessageId: number; stream: ReadableStream<Uint8Array> }> => {
    let response: Response;
    const url = `${API_BASE_URL}/api/chats/${chatId}/messages`;
    console.log(`[addStandaloneChatMessageStream] Fetching URL: ${url}`);
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    } catch (networkError) {
        console.error("[addStandaloneChatMessageStream] Network error during fetch:", networkError);
        throw new Error(`Network error sending message: ${networkError instanceof Error ? networkError.message : 'Unknown network error'}`);
    }

    if (!response.ok || !response.body) {
        let errorBodyText = `HTTP error ${response.status}`;
        try { const errorJson = await response.json(); errorBodyText = errorJson?.message || JSON.stringify(errorJson); } catch (e) { /* ignore json parse error */ }
        throw new Error(`Failed to initiate stream: ${errorBodyText}`);
    }

    const userMessageIdStr = response.headers.get('X-User-Message-Id');
    const userMessageId = userMessageIdStr ? parseInt(userMessageIdStr, 10) : -1;
    if(userMessageId === -1) { console.warn("[addStandaloneChatMessageStream] X-User-Message-Id header not found or invalid."); }

    return { userMessageId, stream: response.body };
};

// PATCH /api/chats/{chatId}/details - Handles name AND tags
// Updated function signature and payload
export const renameStandaloneChat = async ( // Function name kept for simplicity, but it edits details now
    chatId: number,
    name: string | null,
    tags: string[] | null // <-- Added tags parameter
): Promise<StandaloneChatListItem> => {
    // TODO: Update backend to accept { name, tags }
    const payload = { name, tags };
    // Use the corrected path: /api/chats/:chatId/details
    console.log(`[API] Editing standalone chat ${chatId} at /details with payload:`, payload);
    const response = await axios.patch<StandaloneChatListItem>(`/api/chats/${chatId}/details`, payload);
    return { ...response.data, tags: response.data.tags ?? null }; // Returns updated metadata
};

// DELETE /api/chats/{chatId}
export const deleteStandaloneChat = async (chatId: number): Promise<{ message: string }> => {
    const response = await axios.delete(`/api/chats/${chatId}`);
    return response.data;
};

// --- Message Star Endpoint ---
// PATCH /api/sessions/{sessionId}/chats/{chatId}/messages/{messageId} OR /api/chats/{chatId}/messages/{messageId}
export const updateMessageStarStatus = async (
    messageId: number,
    starred: boolean,
    starredName?: string | null,
    chatId?: number, // Required if standalone or for clarity
    sessionId?: number | null // Required if session-based
): Promise<ChatMessage> => {
    const payload = { starred, starredName: starred ? starredName : null };
    let url: string;

    if (sessionId !== undefined && sessionId !== null && chatId !== undefined) {
        url = `/api/sessions/${sessionId}/chats/${chatId}/messages/${messageId}`;
        console.log(`[API] Updating star (session): ${url}`);
    } else if (chatId !== undefined) {
        url = `/api/chats/${chatId}/messages/${messageId}`;
        console.log(`[API] Updating star (standalone): ${url}`);
    } else {
        throw new Error("Either sessionId/chatId or just chatId must be provided to update star status.");
    }

    const response = await axios.patch<BackendChatMessage>(url, payload);
    // Map BackendChatMessage to UI ChatMessage
    return {
        ...response.data,
        starred: !!response.data.starred,
        starredName: response.data.starredName ?? undefined,
    };
};

// GET /api/starred-messages
export const fetchStarredMessages = async (): Promise<ChatMessage[]> => {
    console.log(`[API] Fetching starred messages`);
    const response = await axios.get<BackendChatMessage[]>('/api/starred-messages');
    // Map BackendChatMessage to UI ChatMessage
    return (response.data || []).map(msg => ({
        ...msg,
        starred: !!msg.starred,
        starredName: msg.starredName ?? undefined,
    }));
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
    const response = await axios.post<{ message: string }>('/api/ollama/delete-model', { modelName });
    return response.data;
};

// --- Docker Management Endpoint ---

// GET /api/docker/status
export const fetchDockerStatus = async (): Promise<DockerContainerStatus[]> => {
    console.log("Fetching Docker status from /api/docker/status");
    const response = await axios.get<{ containers: DockerContainerStatus[] }>('/api/docker/status');
    return response.data.containers;
};
// --- END Docker ---

// --- System Endpoints ---

/**
 * Sends a request to the backend API to initiate a system shutdown.
 * @returns Promise resolving to the API response message.
 * @throws {Error} If the API call fails.
 */
export const triggerShutdown = async (): Promise<{ message: string }> => {
    console.log("[UI API] Sending shutdown request to backend...");
    try {
        const response = await axios.post<{ message: string }>('/api/system/shutdown');
        console.log("[UI API] Shutdown request response:", response.data);
        return response.data;
    } catch (error: any) {
        console.error("[UI API] Error triggering shutdown:", error);
        const message = error.response?.data?.message || error.message || "Unknown error triggering shutdown";
        throw new Error(message);
    }
};

// --- END System ---


// --- ADDED: Search Endpoint ---
export const searchMessages = async (query: string, limit: number = 20): Promise<SearchApiResponse> => {
    console.log(`[API] Sending search request for query: "${query}", limit: ${limit}`);
    const response = await axios.get<SearchApiResponse>('/api/search', {
        params: { q: query, limit }
    });
    return response.data;
};
// --- END: Search Endpoint ---


// TODO comments should not be removed
