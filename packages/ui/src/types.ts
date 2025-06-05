// packages/ui/src/types.ts

export interface TranscriptParagraphData {
  id: number;
  timestamp: number; // start time in milliseconds
  text: string;
}
export type StructuredTranscript = TranscriptParagraphData[];

export interface ChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  starred?: boolean; // Optional boolean
  starredName?: string | null; // Can be string, null, or undefined (UI preference)
  promptTokens?: number | null; // Can be number, null, or undefined
  completionTokens?: number | null; // Can be number, null, or undefined
}

export interface ChatSession {
  id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null; // Can be string, null, or undefined (UI preference)
  messages?: ChatMessage[];
  tags?: string[] | null; // Can be string array, null, or undefined
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
  audioPath: string | null;
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  date: string; // ISO string from backend
  transcriptTokenCount?: number | null;
  chats: Pick<ChatSession, 'id' | 'sessionId' | 'timestamp' | 'name'>[];
}

// Backend types (can be useful for understanding API responses before mapping)
export interface BackendChatSession {
  id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null;
  messages?: BackendChatMessage[];
  tags?: string[] | null;
}

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

// Ollama related types
export interface OllamaModelInfo {
  name: string;
  modified_at: string; // ISO Date string
  size: number; // in bytes
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  size_vram?: number;
  expires_at?: string | null; // ISO Date string or null
  size_total?: number; // Deprecated, use size
}

export interface OllamaStatus {
  activeModel: string;
  modelChecked: string; // The model whose 'loaded' status is being reported
  loaded: boolean; // Is modelChecked loaded?
  details?: OllamaModelInfo | null; // Details of modelChecked if loaded, can be null
  configuredContextSize?: number | null;
}

export interface AvailableModelsResponse {
  models: OllamaModelInfo[];
}

export type UIPullJobStatusState =
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceling'
  | 'canceled';

export interface UIPullJobStatus {
  jobId: string;
  modelName: string;
  status: UIPullJobStatusState;
  message: string;
  progress?: number | null; // 0-100
  error?: string | null;
  completedBytes?: number | null;
  totalBytes?: number | null;
}

// Docker related types
export interface DockerContainerStatus {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string; // Human-readable status
  ports: {
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
    IP?: string;
  }[];
}

// Search related types
export interface SearchResultItem {
  id: number; // Message ID or Paragraph Index
  type: 'chat' | 'transcript';
  chatId: number | null;
  sessionId: number | null;
  sender: 'user' | 'ai' | null;
  timestamp: number;
  snippet: string;
  rank: number;
  clientName?: string | null;
  tags?: string[] | null;
}

export interface SearchApiResponse {
  query: string;
  results: SearchResultItem[];
}

// UI Transcription Status
export interface UITranscriptionStatus {
  job_id: string;
  status:
    | 'queued'
    | 'model_loading'
    | 'model_downloading'
    | 'processing'
    | 'transcribing'
    | 'completed'
    | 'failed'
    | 'canceled';
  progress?: number | null; // Percentage (0-100)
  error?: string | null;
  duration?: number | null;
  message?: string | null;
}

// Standalone Chat List Item
export interface StandaloneChatListItem {
  id: number;
  sessionId: null; // Should always be null for standalone chats
  timestamp: number;
  name?: string | null; // Can be string, null, or undefined
  tags?: string[] | null;
}
