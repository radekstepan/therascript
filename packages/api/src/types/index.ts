// packages/api/src/types/index.ts
export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface BackendChatSession {
  id: number;
  sessionId: number | null; // Session ID can be null for standalone chats
  timestamp: number;
  name?: string | null; // Allow null explicitly
  messages?: BackendChatMessage[]; // Optional, loaded on demand
}

// Specific type for Chat Metadata (excluding messages)
// sessionId can be number or null here, handlers will specify
export type ChatMetadata = Omit<BackendChatSession, 'messages'>;


export interface TranscriptParagraphData {
  id: number;
  timestamp: number; // Start time of the paragraph in milliseconds from audio start
  text: string;
}

export type StructuredTranscript = TranscriptParagraphData[];

export interface WhisperSegment {
    id: number;
    seek: number;
    start: number; // seconds
    end: number;   // seconds
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
}

export interface WhisperTranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
}

export interface WhisperJobStatus {
    job_id: string;
    status: "queued" | "processing" | "completed" | "failed" | "canceled";
    progress?: number;
    result?: WhisperTranscriptionResult;
    error?: string;
    start_time?: number;
    end_time?: number;
    duration?: number;
}

export interface BackendSession {
  id: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string; // ISO 8601 string
  sessionType: string;
  therapy: string;
  transcriptPath: string | null;
  audioPath: string | null; // Path to the original uploaded audio file
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  transcriptTokenCount?: number | null; // <-- Added optional token count
  // Use ChatMetadata type here - session chats always have a number sessionId
  chats?: (ChatMetadata & { sessionId: number })[];
}

// Adjusted to include optional audioPath for creation/update scenarios
// Metadata does not include the derived token count
export type BackendSessionMetadata = Omit<BackendSession, 'id' | 'transcriptPath' | 'transcriptTokenCount' | 'chats' | 'fileName' | 'status' | 'whisperJobId' | 'audioPath'>;

export interface ActionSchema {
    endpoint: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    description: string;
    requestBody?: Record<string, unknown> | string;
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    responseBody?: Record<string, unknown> | string;
}

export interface ApiErrorResponse {
    error: string;
    details?: string | Record<string, any>;
    validationErrors?: any;
}

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

// --- Docker Container Status Type ---
export interface DockerContainerStatus {
    id: string;
    name: string;
    image: string;
    state: string; // e.g., 'running', 'stopped', 'exited'
    status: string; // e.g., 'Up 2 hours', 'Exited (0) 5 minutes ago'
    ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[];
}
// --- END Docker Container Status Type ---
