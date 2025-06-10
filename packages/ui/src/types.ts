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
  starred?: boolean;
  starredName?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface ChatSession {
  id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null;
  messages?: ChatMessage[];
  tags?: string[] | null;
}

export interface SessionMetadata {
  clientName: string;
  sessionName: string;
  date: string; // YYYY-MM-DD for input
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

export interface BackendChatSession {
  /* ... as before ... */ id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null;
  messages?: BackendChatMessage[];
  tags?: string[] | null;
}
export interface BackendChatMessage {
  /* ... as before ... */ id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  starred?: number;
  starredName?: string | null;
}

export interface OllamaModelInfo {
  /* ... as before ... */ name: string;
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
  expires_at?: string | null;
}
export interface OllamaStatus {
  /* ... as before ... */ activeModel: string;
  modelChecked: string;
  loaded: boolean;
  details?: OllamaModelInfo | null;
  configuredContextSize?: number | null;
}
export interface AvailableModelsResponse {
  models: OllamaModelInfo[];
}
export type UIPullJobStatusState =
  /* ... as before ... */
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceling'
  | 'canceled';
export interface UIPullJobStatus {
  /* ... as before ... */ jobId: string;
  modelName: string;
  status: UIPullJobStatusState;
  message: string;
  progress?: number | null;
  error?: string | null;
  completedBytes?: number | null;
  totalBytes?: number | null;
}

export interface DockerContainerStatus {
  /* ... as before ... */ id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: {
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
    IP?: string;
  }[];
}

// Updated SearchResultItem for Elasticsearch
export interface SearchResultItem {
  id: string | number; // ES _id is string, paragraph_id (sessionId_idx) also string
  type: 'chat' | 'transcript';
  chatId: number | null;
  sessionId: number | null;
  sender: 'user' | 'ai' | null;
  timestamp: number; // Milliseconds since epoch
  snippet: string; // Can be highlighted HTML
  score?: number;
  highlights?: Record<string, string[]>; // e.g., { "text": ["<mark>highlighted</mark> term"] }
  clientName?: string | null;
  tags?: string[] | null;
}

export interface SearchApiResponse {
  query: string;
  results: SearchResultItem[];
  total: number; // Total number of hits from ES
}

export interface UITranscriptionStatus {
  /* ... as before ... */ job_id: string;
  status:
    | 'queued'
    | 'model_loading'
    | 'model_downloading'
    | 'processing'
    | 'transcribing'
    | 'completed'
    | 'failed'
    | 'canceled';
  progress?: number | null;
  error?: string | null;
  duration?: number | null;
  message?: string | null;
}
export interface StandaloneChatListItem {
  /* ... as before ... */ id: number;
  sessionId: null;
  timestamp: number;
  name?: string | null;
  tags?: string[] | null;
}
