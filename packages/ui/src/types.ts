// packages/ui/src/types.ts
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
    date: string;
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
    chats: ChatSession[];
}

// --- New Types for LLM Management ---

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
    // --- Renamed configuredModel to activeModel ---
    activeModel: string; // The model currently active in the backend state
    // --- End Rename ---
    // --- Add modelChecked field ---
    modelChecked: string; // The specific model name whose status was checked
    // --- End Add ---
    loaded: boolean; // Whether modelChecked is loaded
    details?: OllamaModelInfo; // Details if loaded (refers to modelChecked)
}

export interface AvailableModelsResponse {
    models: OllamaModelInfo[];
}
// --- End New Types ---
