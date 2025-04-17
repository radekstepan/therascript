export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  // Add optional token counts - will only be present on 'ai' messages after generation
  promptTokens?: number;
  completionTokens?: number;
}

export interface BackendChatSession {
  id: number;
  sessionId: number;
  timestamp: number;
  name?: string;
  messages?: BackendChatMessage[]; // Optional, loaded on demand
}

// Represents a single paragraph with its text and starting timestamp
export interface TranscriptParagraphData {
  id: number;
  timestamp: number; // Start time of the paragraph in milliseconds from audio start
  text: string;
}

// Represents the full transcript as an array of paragraphs
export type StructuredTranscript = TranscriptParagraphData[];

// --- FIX: Define and export WhisperSegment here ---
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
// --- END FIX ---

// Represents the structure within the 'result' field when status is 'completed'
export interface WhisperTranscriptionResult {
  text: string;
  segments: WhisperSegment[]; // Uses the exported interface now
  language: string;
}

// Represents the full Whisper job status/result from the python service
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
  date: string;
  sessionType: string;
  therapy: string;
  transcriptPath: string | null;
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  chats?: Pick<BackendChatSession, 'id' | 'sessionId' | 'timestamp' | 'name'>[];
}

export type BackendSessionMetadata = Omit<BackendSession, 'id' | 'transcriptPath' | 'chats' | 'fileName' | 'status' | 'whisperJobId'>;

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

// --- Type for Ollama /api/tags response model item ---
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
    // Optional fields added by /ps
    size_vram?: number;
    expires_at?: string;
    size_total?: number; // Added for clarity if different from 'size' in list
}
// --- End Type ---
