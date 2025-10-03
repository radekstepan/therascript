// packages/api/src/types/index.ts

export interface Template {
  id: number;
  title: string;
  text: string;
  createdAt: number; // UNIX Milliseconds
}

export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai' | 'system';
  text: string;
  timestamp: number; // UNIX Milliseconds
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface BackendChatSession {
  id: number;
  sessionId: number | null; // Null for standalone chats
  timestamp: number; // UNIX Milliseconds
  name?: string | null;
  messages?: BackendChatMessage[];
  tags?: string[] | null; // For standalone chats primarily
}

// Metadata for a chat, excluding its messages list
export type ChatMetadata = Omit<BackendChatSession, 'messages'> & {
  tags?: string[] | null; // Ensure tags are part of this if they can be associated with a chat's metadata
};

export interface BackendTranscriptParagraph {
  id: number; // Primary key of the transcript_paragraphs table
  sessionId: number;
  paragraphIndex: number; // Logical order of the paragraph within the session transcript
  timestampMs: number; // Original timestamp in milliseconds from Whisper
  text: string;
}

// Structure used for API responses for transcript content
export interface TranscriptParagraphData {
  id: number; // Corresponds to paragraphIndex for UI display purposes
  timestamp: number; // start time in milliseconds (maps from timestampMs)
  text: string;
}
export type StructuredTranscript = TranscriptParagraphData[];

export interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
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
  // FIX: Added 'started' to the list of valid statuses.
  status:
    | 'queued'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'model_loading'
    | 'model_downloading'
    | 'transcribing'
    | 'started'
    | 'canceling';
  progress?: number; // Percentage 0-100
  result?: WhisperTranscriptionResult;
  error?: string;
  start_time?: number; // UNIX Milliseconds
  end_time?: number; // UNIX Milliseconds
  duration?: number; // Audio duration in seconds
  message?: string; // Optional descriptive message from Whisper service
}

export interface BackendSession {
  id: number;
  fileName: string; // Original uploaded filename
  clientName: string;
  sessionName: string;
  date: string; // ISO 8601 string (e.g., "2023-10-27T12:00:00.000Z")
  sessionType: string;
  therapy: string;
  audioPath: string | null; // Relative path/identifier for the audio file
  status: 'pending' | 'queued' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  transcriptTokenCount?: number | null;
  chats?: (Omit<ChatMetadata, 'tags'> & { sessionId: number })[]; // For session details endpoint, session chats don't have tags from this relation
}

// Metadata for creating/updating a session
export type BackendSessionMetadata = Omit<
  BackendSession,
  | 'id'
  | 'transcriptTokenCount'
  | 'chats'
  | 'fileName' // fileName is usually derived from upload, not direct metadata input
  | 'status'
  | 'whisperJobId'
  | 'audioPath'
>;

// For API documentation via Swagger (if used)
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
  message: string; // Added for consistency with Elysia error responses
  details?: string | Record<string, any>;
  validationErrors?: any;
}

// Ollama related types (internal API representation, dates are Date objects)
export interface OllamaModelInfo {
  name: string;
  modified_at: Date; // Date object
  size: number; // in bytes
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  defaultContextSize?: number | null;
  size_vram?: number; // Optional field from newer Ollama versions
  expires_at?: Date; // Optional Date object
}

export type OllamaPullJobStatusState =
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceling'
  | 'canceled';

export interface OllamaPullJobStatus {
  jobId: string;
  modelName: string;
  status: OllamaPullJobStatusState;
  message: string;
  progress?: number; // 0-100
  completedBytes?: number;
  totalBytes?: number;
  currentLayer?: string; // For detailed progress
  startTime: number; // UNIX Milliseconds
  endTime?: number; // UNIX Milliseconds
  error?: string;
}

// Docker related types (as provided by Dockerode, simplified for API)
export interface DockerContainerStatus {
  id: string;
  name: string;
  image: string;
  state: string; // e.g., 'running', 'exited'
  status: string; // Human-readable status, e.g., 'Up 5 minutes'
  ports: {
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
    IP?: string;
  }[];
}

// Elasticsearch Search Result Item (API internal representation before sending to UI)
export interface ApiSearchResultItem {
  id: string | number;
  type: 'chat' | 'transcript';
  chatId: number | null;
  sessionId: number | null;
  sender: 'user' | 'ai' | 'system' | null;
  timestamp: number;
  snippet: string;
  score?: number;
  highlights?: Record<string, string[]>;
  clientName?: string | null;
  tags?: string[] | null;
}

// API response structure for search
export interface ApiSearchResponse {
  query: string;
  results: ApiSearchResultItem[];
  total: number;
}

// --- NEW ANALYSIS JOB TYPES ---

export interface AnalysisStrategy {
  intermediate_question: string;
  final_synthesis_instructions: string;
}

export interface AnalysisJob {
  id: number;
  original_prompt: string;
  short_prompt: string;
  status:
    | 'pending'
    | 'generating_strategy'
    | 'mapping'
    | 'reducing'
    | 'completed'
    | 'failed'
    | 'canceling'
    | 'canceled';
  final_result: string | null;
  error_message: string | null;
  created_at: number; // UNIX Milliseconds
  completed_at: number | null; // UNIX Milliseconds
  model_name: string | null;
  context_size: number | null;
  strategy_json: string | null; // Stored as a JSON string
}

export interface IntermediateSummary {
  id: number;
  analysis_job_id: number;
  session_id: number;
  summary_text: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
}

export interface IntermediateSummaryWithSessionName
  extends IntermediateSummary {
  sessionName: string;
  sessionDate: string;
}

export interface AnalysisJobWithDetails extends AnalysisJob {
  summaries: IntermediateSummaryWithSessionName[];
  strategy: AnalysisStrategy | null; // Parsed for the UI
}

// --- END NEW ANALYSIS JOB TYPES ---
