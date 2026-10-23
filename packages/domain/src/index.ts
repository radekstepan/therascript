import type { StatementReviewStatus } from './verificationReview.js';

export interface VramEstimate {
  /** Total estimated VRAM required (weights on GPU + KV cache + CUDA overhead) */
  vram_bytes: number;
  /** Total estimated CPU RAM required (weights on CPU when layers are split) */
  ram_bytes: number;
  /** Estimated model weight size in bytes (from quant formula or file size fallback) */
  weights_bytes: number;
  /** KV cache size in bytes for the requested context length */
  kv_cache_bytes: number;
  /** CUDA/cuBLAS baseline overhead bytes (only present when any layers are on GPU) */
  overhead_bytes: number;
}

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
  duration?: number | null;
  isTruncated?: boolean | null;
  model?: string | null;
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
  speaker?: string | null;
}

export interface TranscriptParagraphData {
  id: number;
  timestamp: number;
  text: string;
  speaker?: string;
}

export type StructuredTranscript = TranscriptParagraphData[];

export interface WhisperSegment {
  id?: number;
  seek?: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  tokens?: number[];
  temperature?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
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
  duration?: number | null;
  errorMessage?: string | null;
  showSpeakers?: number | null;
  chats?: (Omit<ChatMetadata, 'tags'> & { sessionId: number })[];
  /** Number of chats linked to the session. Populated by list endpoints only, not a DB column. */
  chatCount?: number;
  /** Chats with at least one completed fact-check verification. Populated by list endpoints only, not a DB column. */
  factCheckedChatCount?: number;
}

export type BackendSessionMetadata = Omit<
  BackendSession,
  | 'id'
  | 'transcriptTokenCount'
  | 'chats'
  | 'chatCount'
  | 'factCheckedChatCount'
  | 'fileName'
  | 'status'
  | 'whisperJobId'
  | 'audioPath'
  | 'duration'
  | 'errorMessage'
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

export interface LlmModelInfo {
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

  architecture?: {
    num_layers?: number;
    num_attention_heads?: number;
    num_key_value_heads?: number;
    hidden_size?: number;
    head_dim?: number;
    precision?: number;
  } | null;
}

export type ModelDownloadJobStatusState =
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceling'
  | 'canceled';

export interface ModelDownloadJobStatus {
  jobId: string;
  modelName: string;
  status: ModelDownloadJobStatusState;
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
  thinking_budget: number | null;
  temperature: number | null;
  top_p: number | null;
  repeat_penalty: number | null;
  num_gpu_layers: number | null;
  map_phase_system_prompt: string | null;
  llm_base_url: string | null;
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

export type VerificationJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type VerificationJobScope =
  | 'all_unverified'
  | 'all_force'
  | 'selected_sessions'
  | 'single_chat';

export type VerificationPhase =
  | 'waiting_for_lock'
  | 'loading_judge'
  | 'checking_message'
  | 'generating'
  | 'retrying'
  | 'finishing';

export type VerificationFailureCode =
  | 'empty_output'
  | 'malformed_json'
  | 'truncated_output'
  | 'invalid_structure'
  | 'provider_error'
  | 'context_budget'
  | 'missing_transcript';

export interface BackendVerificationJob {
  id: number;
  status: VerificationJobStatus;
  scope: VerificationJobScope;
  session_ids_json: string | null;
  chat_id: number | null;
  skip_verified: boolean;
  total_messages: number;
  processed_messages: number;
  succeeded_messages: number;
  failed_messages: number;
  skipped_messages: number;
  current_phase: VerificationPhase | null;
  current_message_id: number | null;
  current_attempt: number | null;
  phase_updated_at: number | null;
  /**
   * Human-readable preview of `current_message_id` text (derived at read
   * time via a scalar subquery — no migration). Null when the job has no
   * in-flight message or its text is empty.
   */
  current_message_preview?: string | null;
  total_statements: number;
  flagged_statements: number;
  omissions_count: number;
  created_at: number;
  completed_at: number | null;
  error_message: string | null;
  model_name: string | null;
  context_size: number | null;
  thinking_budget: number | null;
  temperature: number | null;
  top_p: number | null;
  repeat_penalty: number | null;
  num_gpu_layers: number | null;
  llm_base_url: string | null;
}

export type StatementVerdict =
  | 'supported'
  | 'partially_supported'
  | 'contradicted'
  | 'fabricated'
  | 'omission';

export type StatementSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type StatementKind = 'claim' | 'omission';

export interface TranscriptEvidenceItem {
  paragraphIndex: number | null;
  timestampMs: number | null;
  speaker: string | null;
  quote: string;
}

export interface BackendVerifiedStatement {
  id: number;
  message_verification_id: number;
  message_id: number;
  session_id: number;
  statement_index: number;
  kind: StatementKind;
  exact_quote: string;
  normalized_claim: string;
  start_char: number | null;
  end_char: number | null;
  verdict: StatementVerdict;
  severity: StatementSeverity;
  confidence: number;
  reasoning: string;
  transcript_evidence_json: string | null;
  /** Parsed transcript_evidence_json. Populated by repository/API layers, not a DB column. */
  evidence?: TranscriptEvidenceItem[];
  created_at: number;
  /**
   * Human-review state for this finding. `'confirmed'` means the user
   * dismissed it as not-an-issue; the Judge verdict above is always
   * preserved. Populated by repository readers (joined from
   * `verification_statement_reviews`), never a `verified_statements` column.
   */
  review_status: StatementReviewStatus;
  /** Milliseconds timestamp of the human confirmation, if any. */
  confirmed_at: number | null;
  /** Owning `verification_statement_reviews` row id, if any. */
  review_id: number | null;
  /**
   * Opaque token over the immutable statement snapshot + material revision.
   * Required (as `expectedReviewToken`) to dismiss this statement.
   */
  review_token: string | null;
}

export interface BackendMessageVerification {
  id: number;
  message_id: number;
  chat_id: number;
  session_id: number;
  verification_job_id: number | null;
  authored_model: string | null;
  judge_model: string;
  status: 'completed' | 'failed' | 'skipped';
  total_claims: number;
  supported_claims: number;
  partial_claims: number;
  contradicted_claims: number;
  fabricated_claims: number;
  omissions_count: number;
  accuracy_score: number;
  summary_assessment: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number | null;
  verified_at: number;
  error_message: string | null;
  error_code: VerificationFailureCode | null;
  /**
   * Fingerprint of the material actually evaluated (visible answer +
   * therapist question + full transcript content). Null for legacy rows
   * audited before revisions existed; established lazily on next audit or
   * first dismissal. Counts/scores on this row are review-aware effective
   * aggregates; raw Judge verdicts live on the nested statements.
   */
  material_revision?: string | null;
  /** Nested statements. Populated by repository/API layers, not a DB column. */
  statements?: BackendVerifiedStatement[];
}

/** Durable human confirmation of one finding (independent of statement rows). */
export interface BackendStatementReview {
  id: number;
  message_id: number;
  session_id: number;
  identity_version: number;
  context_revision: string;
  finding_key: string;
  reusable: boolean;
  confirmed_statement_id: number | null;
  confirmed_at: number;
  kind: StatementKind;
  exact_quote: string;
  normalized_claim: string;
  start_char: number | null;
  end_char: number | null;
  verdict: StatementVerdict;
  severity: StatementSeverity;
  confidence: number;
  reasoning: string;
  transcript_evidence_json: string | null;
}

export interface ModelAccuracyStat {
  model: string;
  messagesAudited: number;
  totalClaims: number;
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  omissions: number;
  accuracyPercent: number;
  /** Pooled percent-scale rate (fabricated/total*100), like accuracyPercent. */
  fabricationRate: number;
  /** Pooled percent-scale rate (contradicted/total*100), like accuracyPercent. */
  contradictionRate: number;
  omissionsPerMessage: number;
  averageAccuracyScore: number;
}

export interface VerificationTimepointStat {
  date: string;
  messagesAudited: number;
  totalClaims: number;
  accuracyPercent: number;
  fabrications: number;
  contradictions: number;
  omissions: number;
}

export interface SessionVerificationSummary {
  sessionId: number;
  sessionName: string;
  clientName: string;
  date: string;
  totalAiMessages: number;
  verifiedAiMessages: number;
  /** Messages whose latest verification attempt ended with status = 'failed'. */
  failedAiMessages: number;
  isFullyVerified: boolean;
  flaggedIssues: number;
  /** Mean per-message accuracy on the 0–100 percent scale (null when nothing verified). */
  averageAccuracy: number | null;
  /**
   * Most common chat LLM (`messages.model`) across the session's
   * verifiable AI messages (ties break alphabetically, nulls last).
   * Null when no model was recorded.
   */
  predominantModel: string | null;
}

export interface VerificationGlobalStats {
  totalMessagesAudited: number;
  overallAccuracyPercent: number;
  totalClaims: number;
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  omissions: number;
  unverifiedMessagesCount: number;
  /** Messages whose latest verification attempt ended with status = 'failed'. */
  failedMessagesCount: number;
  byModel: ModelAccuracyStat[];
  overTime: VerificationTimepointStat[];
  sessionsSummary: SessionVerificationSummary[];
}

export * from './validators.js';
export * from './messagePreview.js';
export * from './verificationReview.js';
export * from './schemas/api/index.js';
export * from './schemas/jobs/index.js';
export * from './schemas/db/index.js';
export * from './schemas/db/appSettings.js';
