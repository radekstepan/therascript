// TODO can we infer these from the API?

export interface TranscriptParagraphData {
    id: number;
    timestamp: number; // start time in milliseconds
    text: string;
}
export type StructuredTranscript = TranscriptParagraphData[];


export interface ChatMessage {
    id: number;
    chatId: number; // Added chatId for consistency
    sender: 'user' | 'ai';
    text: string;
    timestamp: number; // Added timestamp
    starred?: boolean; // Changed from optional 0/1 to optional boolean
    starredName?: string;
    promptTokens?: number;
    completionTokens?: number;
}

export interface ChatSession {
    id: number;
    sessionId: number | null; // Session ID can be null for standalone chats
    timestamp: number;
    name?: string;
    messages?: ChatMessage[];
    tags?: string[] | null; // <-- Added tags for standalone chats
}

export interface SessionMetadata {
    clientName: string;
    sessionName: string;
    date: string; // Expects YYYY-MM-DD format for input, backend stores ISO
    sessionType: string; // TODO this is an enum
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
    transcriptTokenCount?: number | null;
    // Changed chats to use ChatSession metadata, sessionId must be number here
    chats: Pick<ChatSession, 'id' | 'sessionId' | 'timestamp' | 'name'>[];
}

// --- Standalone Chat Type (potentially reused BackendChatSession metadata type) ---
export interface BackendChatSession {
  id: number;
  sessionId: number | null; // Important: can be null
  timestamp: number;
  name?: string;
  messages?: BackendChatMessage[];
  tags?: string[] | null; // <-- Added tags
}

export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number;
  completionTokens?: number;
  starred?: number; // 0 or 1 from DB
  starredName?: string | null;
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
