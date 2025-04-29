export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  starred?: number; // 0 or 1 from DB
  starredName?: string | null;
}

export interface BackendChatSession {
  id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null;
  messages?: BackendChatMessage[];
  tags?: string[] | null; // <-- Ensure this exists and is optional array or null
}

// Specific type for Chat Metadata (excluding messages)
// Ensure this also includes tags
export type ChatMetadata = Omit<BackendChatSession, 'messages'> & {
    tags?: string[] | null; // <-- Ensure this exists here too
};

// --- Renamed TranscriptParagraphData to BackendTranscriptParagraph ---
// Represents the row in the DB table
export interface BackendTranscriptParagraph {
    id: number; // Primary key of the paragraph row itself
    sessionId: number;
    paragraphIndex: number; // Logical index (0, 1, 2...) within the session
    timestampMs: number; // Timestamp from Whisper
    text: string;
}

// --- Kept StructuredTranscript as the API/Service-level structure ---
// This is what Whisper service returns and what the API GET /transcript returns.
// The 'id' here corresponds to BackendTranscriptParagraph.paragraphIndex
// The 'timestamp' here corresponds to BackendTranscriptParagraph.timestampMs
export interface TranscriptParagraphData { id: number; timestamp: number; text: string; }
export type StructuredTranscript = TranscriptParagraphData[];

export interface WhisperSegment { id: number; seek: number; start: number; end: number; text: string; tokens: number[]; temperature: number; avg_logprob: number; compression_ratio: number; no_speech_prob: number; }
export interface WhisperTranscriptionResult { text: string; segments: WhisperSegment[]; language: string; }
export interface WhisperJobStatus { job_id: string; status: "queued" | "processing" | "completed" | "failed" | "canceled"; progress?: number; result?: WhisperTranscriptionResult; error?: string; start_time?: number; end_time?: number; duration?: number; }

// --- Removed transcriptPath from BackendSession ---
export interface BackendSession {
  id: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
  // transcriptPath: string | null; // Removed
  audioPath: string | null;
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  transcriptTokenCount?: number | null;
  // Use ChatMetadata, but session chats don't have tags (yet?)
  // Omit tags from ChatMetadata specifically for session.chats
  chats?: (Omit<ChatMetadata, 'tags'> & { sessionId: number })[];
}

// --- Removed transcriptPath from BackendSessionMetadata ---
export type BackendSessionMetadata = Omit<BackendSession, 'id' /* | 'transcriptPath' */ | 'transcriptTokenCount' | 'chats' | 'fileName' | 'status' | 'whisperJobId' | 'audioPath'>;

export interface ActionSchema { endpoint: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; description: string; requestBody?: Record<string, unknown> | string; pathParams?: Record<string, string>; queryParams?: Record<string, string>; responseBody?: Record<string, unknown> | string; }
export interface ApiErrorResponse { error: string; details?: string | Record<string, any>; validationErrors?: any; }
export interface OllamaModelInfo { name: string; modified_at: Date; size: number; digest: string; details: { format: string; family: string; families: string[] | null; parameter_size: string; quantization_level: string; }; size_vram?: number; expires_at?: Date; }
export type OllamaPullJobStatusState = 'queued' | 'parsing' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'canceling' | 'canceled';
export interface OllamaPullJobStatus { jobId: string; modelName: string; status: OllamaPullJobStatusState; message: string; progress?: number; completedBytes?: number; totalBytes?: number; currentLayer?: string; startTime: number; endTime?: number; error?: string; }
export interface DockerContainerStatus { id: string; name: string; image: string; state: string; status: string; ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[]; }

// TODO comments should not be removed
