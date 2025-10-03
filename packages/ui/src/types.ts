// packages/ui/src/types.ts

// --- NEW GPU STATS TYPES ---
export interface GpuProcess {
  pid: number;
  name: string;
  memoryUsedMb: number;
}

export interface GpuDeviceStats {
  id: number;
  name: string;
  fanSpeedPercent: number | null;
  performanceState: string;
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
  };
  utilization: {
    gpuPercent: number | null;
    memoryPercent: number | null;
  };
  temperature: {
    currentCelsius: number | null;
  };
  power: {
    drawWatts: number | null;
    limitWatts: number | null;
  };
  processes: GpuProcess[];
}

export interface GpuStats {
  available: boolean;
  driverVersion: string | null;
  cudaVersion: string | null;
  gpus: GpuDeviceStats[];
  summary: {
    gpuCount: number;
    totalMemoryMb: number;
    totalMemoryUsedMb: number;
    avgGpuUtilizationPercent: number | null;
    avgMemoryUtilizationPercent: number | null;
    avgTemperatureCelsius: number | null;
    totalPowerDrawWatts: number | null;
    totalPowerLimitWatts: number | null;
  };
}
// --- END NEW GPU STATS TYPES ---

export interface Template {
  id: number;
  title: string;
  text: string;
  createdAt: number;
}

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
  status: 'pending' | 'queued' | 'transcribing' | 'completed' | 'failed';
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
}

export interface OllamaModelInfo {
  name: string;
  modified_at: string; // ISO string
  size: number; // in bytes
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  defaultContextSize?: number | null; // <-- ADDED
  size_vram?: number;
  expires_at?: string | null; // ISO string
}
export interface OllamaStatus {
  activeModel: string;
  modelChecked: string; // The model whose details are provided below
  loaded: boolean;
  details?: OllamaModelInfo | null; // Contains details of modelChecked, including defaultContextSize
  configuredContextSize?: number | null; // The num_ctx the backend is currently using for the activeModel
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
    | 'canceled'
    | 'started'
    | 'canceling';
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

export interface ReadinessStatus {
  ready: boolean;
  services: {
    database: 'connected' | 'disconnected';
    elasticsearch: 'connected' | 'disconnected';
    ollama: 'connected' | 'disconnected';
    whisper: 'connected' | 'disconnected';
  };
  timestamp: string;
}

// --- NEW ANALYSIS JOB TYPES ---
export interface AnalysisStrategy {
  intermediate_question: string;
  final_synthesis_instructions: string;
}

export interface IntermediateSummaryWithSessionName {
  id: number;
  analysis_job_id: number;
  session_id: number;
  summary_text: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  sessionName: string;
  sessionDate: string;
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
  summaries?: IntermediateSummaryWithSessionName[];
  strategy?: AnalysisStrategy | null; // Parsed strategy object from API
}

export type AnalysisJobSortCriteria =
  | 'original_prompt'
  | 'short_prompt'
  | 'status'
  | 'created_at'
  | 'completed_at'
  | 'model_name';
