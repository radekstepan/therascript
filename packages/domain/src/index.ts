export interface Template {
  id: number;
  title: string;
  text: string;
  createdAt: number;
}

export interface BackendChatMessage {
  id: number;
  chatId: number;
  sender: 'user' | 'ai' | 'system';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface BackendChatSession {
  id: number;
  sessionId: number | null;
  timestamp: number;
  name?: string | null;
  messages?: BackendChatMessage[];
  tags?: string[] | null;
}

export type ChatMetadata = Omit<BackendChatSession, 'messages'> & {
  tags?: string[] | null;
};

export interface BackendTranscriptParagraph {
  id: number;
  sessionId: number;
  paragraphIndex: number;
  timestampMs: number;
  text: string;
}

export interface TranscriptParagraphData {
  id: number;
  timestamp: number;
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
  progress?: number | null;
  result?: WhisperTranscriptionResult | null;
  error?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  duration?: number | null;
  message?: string | null;
}

export interface BackendSession {
  id: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
  audioPath: string | null;
  status: 'pending' | 'queued' | 'transcribing' | 'completed' | 'failed';
  whisperJobId: string | null;
  transcriptTokenCount?: number | null;
  chats?: (Omit<ChatMetadata, 'tags'> & { sessionId: number })[];
}

export type BackendSessionMetadata = Omit<
  BackendSession,
  | 'id'
  | 'transcriptTokenCount'
  | 'chats'
  | 'fileName'
  | 'status'
  | 'whisperJobId'
  | 'audioPath'
>;

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
  message: string;
  details?: string | Record<string, any>;
  validationErrors?: any;
}

export interface OllamaModelInfo {
  name: string;
  modified_at: Date;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  defaultContextSize?: number | null;
  size_vram?: number;
  expires_at?: Date;
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
  progress?: number;
  completedBytes?: number;
  totalBytes?: number;
  currentLayer?: string;
  startTime: number;
  endTime?: number;
  error?: string;
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

export interface ApiSearchResponse {
  query: string;
  results: ApiSearchResultItem[];
  total: number;
}

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
  created_at: number;
  completed_at: number | null;
  model_name: string | null;
  context_size: number | null;
  strategy_json: string | null;
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
  strategy: AnalysisStrategy | null;
}
