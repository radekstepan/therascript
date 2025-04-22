// TODO can we infer these from the API?

export interface TranscriptParagraphData {
    id: number;
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
    promptTokens?: number;
    completionTokens?: number;
}

export interface ChatSession {
    id: number;
    sessionId: number;
    timestamp: number;
    name?: string;
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
    transcriptPath: string | null;
    audioPath: string | null; // Path/Identifier to the original uploaded audio file
    status: 'pending' | 'transcribing' | 'completed' | 'failed';
    whisperJobId: string | null;
    date: string; // ISO string from backend
    transcriptTokenCount?: number | null; // <-- Added optional token count
    chats: ChatSession[];
}

// --- LLM Management Types ---
// ... (rest of the types remain the same) ...

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
    size_vram?: number;
    expires_at?: string;
    size_total?: number;
}


export interface OllamaStatus {
    activeModel: string;
    modelChecked: string;
    loaded: boolean;
    details?: OllamaModelInfo;
    configuredContextSize?: number | null;
}

export interface AvailableModelsResponse {
    models: OllamaModelInfo[];
}

export type UIPullJobStatusState = 'queued' | 'parsing' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'canceling' | 'canceled';
export interface UIPullJobStatus {
    jobId: string;
    modelName: string;
    status: UIPullJobStatusState;
    message: string;
    progress?: number;
    error?: string;
    completedBytes?: number;
    totalBytes?: number;
}

// --- Docker Container Status Type (UI) ---
export interface DockerContainerStatus {
    id: string;
    name: string;
    image: string;
    state: string; // e.g., 'running', 'stopped', 'exited', 'not_found'
    status: string; // e.g., 'Up 2 hours', 'Exited (0) 5 minutes ago', 'Container not found'
    ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[];
}
// --- END Docker Container Status Type ---

// TODO comments should not be removed
