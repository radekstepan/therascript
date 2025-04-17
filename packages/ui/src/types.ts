// TODO can we infer these from the API?

// Add the new structured transcript types
export interface TranscriptParagraphData {
    id: number; // or index used as ID
    timestamp: number; // start time in milliseconds
    text: string;
}
export type StructuredTranscript = TranscriptParagraphData[];


export interface ChatMessage {
    id: number;
    sender: 'user' | 'ai';
    text: string;
    starred?: boolean;
    starredName?: string;
    // Add token counts from the AI response that generated this message (if sender is 'ai')
    promptTokens?: number;
    completionTokens?: number;
}

export interface ChatSession {
    id: number;
    sessionId: number; // Added sessionId
    timestamp: number; // Keep timestamp for sorting/display
    name?: string; // Optional name for the chat
    // Messages are optional, as they might be loaded on demand when a chat is selected
    messages?: ChatMessage[];
}

export interface SessionMetadata {
    clientName: string;
    sessionName: string;
    date: string; // Expects YYYY-MM-DD format for input, backend stores ISO
    sessionType: string;
    therapy: string;
}

export interface Session extends SessionMetadata {
    id: number;
    fileName: string;
    // transcriptPath can be null if transcription is pending/failed
    transcriptPath: string | null;
    // Add status and whisperJobId to match backend
    status: 'pending' | 'transcribing' | 'completed' | 'failed';
    whisperJobId: string | null;
    // Chats array might initially contain only metadata
    // Date is now an ISO string from backend
    date: string;
    chats: ChatSession[];
}

// --- LLM Management Types ---

export interface OllamaModelInfo {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[] | null;
        parameter_size: string;
        quantization_level: string;
    };
    // Add optional fields from /ps check
    size_vram?: number;
    expires_at?: string;
    size_total?: number;
}


export interface OllamaStatus {
    activeModel: string; // The model currently active in the backend state
    modelChecked: string; // The specific model name whose status was checked
    loaded: boolean; // Whether modelChecked is loaded
    details?: OllamaModelInfo; // Details if loaded (refers to modelChecked)
    // Add configuredContextSize
    configuredContextSize?: number | null; // Currently configured num_ctx for active model
}

export interface AvailableModelsResponse {
    models: OllamaModelInfo[];
}

// --- NEW: Add Pull Job Status Type for UI ---
// Matches the PullStatusResponseSchema in the backend API
export type UIPullJobStatusState = 'queued' | 'parsing' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'canceling' | 'canceled';
export interface UIPullJobStatus {
    jobId: string;
    modelName: string;
    status: UIPullJobStatusState;
    message: string;
    progress?: number; // Overall percentage
    error?: string;
    // Optional detailed bytes, maybe useful later
    completedBytes?: number;
    totalBytes?: number;
}
