// =========================================
// File: packages/ui/src/types.ts
// =========================================
// packages/ui/src/types.ts
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
  audioPath: string | null; // Path/Identifier to the original uploaded audio file
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  date: string; // ISO string from backend
  transcriptTokenCount?: number | null;
  chats: Pick<ChatSession, 'id' | 'sessionId' | 'timestamp' | 'name'>[];
}

export interface BackendChatSession {
  id: number;
  sessionId: number | null; // Important: can be null
  timestamp: number;
  name?: string;
  messages?: BackendChatMessage[];
  tags?: string[] | null;
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
  progress?: number;
  error?: string;
  completedBytes?: number;
  totalBytes?: number;
}

export interface DockerContainerStatus {
  id: string;
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

// --- UPDATED: Search Result Type (UI) ---
export interface SearchResultItem {
  id: number;
  type: 'chat' | 'transcript';
  chatId: number | null;
  sessionId: number | null;
  sender: 'user' | 'ai' | null;
  timestamp: number;
  snippet: string; // The text content that matched the search
  rank: number;
  // Add fields needed for accurate filtering
  clientName?: string | null; // Added from backend
  tags?: string[] | null; // Added from backend
}

export interface SearchApiResponse {
  query: string;
  results: SearchResultItem[];
}
// --- END: Search Result Type ---

// --- ADDED: UI Transcription Status Type ---
export interface UITranscriptionStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  progress?: number;
  error?: string;
  duration?: number;
}
// --- END: UI Transcription Status Type ---

// --- ADDED: Standalone Chat List Item Type ---
// Define type for standalone chat list item (metadata only)
export interface StandaloneChatListItem {
  id: number;
  sessionId: null; // Should always be null
  timestamp: number;
  name?: string;
  tags?: string[] | null; // <-- Added tags
}
// --- END: Standalone Chat List Item Type ---

// TODO comments should not be removed
