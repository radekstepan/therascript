/* packages/ui/src/api/verification.ts */
import axios from 'axios';

// UI-local mirrors of the backend verification DTOs (see
// BackendMessageVerification / BackendVerifiedStatement in
// @therascript/domain). The UI package stays decoupled from workspace
// domain types, so these are declared here and kept in sync by shape.

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

export interface VerifiedStatement {
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
  /** Parsed transcript_evidence_json (populated by the API layer). */
  evidence?: TranscriptEvidenceItem[];
  created_at: number;
}

export type MessageVerificationStatus = 'completed' | 'failed' | 'skipped';

export interface MessageVerification {
  id: number;
  message_id: number;
  chat_id: number;
  session_id: number;
  verification_job_id: number | null;
  authored_model: string | null;
  judge_model: string;
  status: MessageVerificationStatus;
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
  statements?: VerifiedStatement[];
}

/** React Query key for per-chat verification verdicts. */
export const chatVerificationsQueryKey = (
  sessionId: number | null,
  chatId: number | null
) => ['chatVerifications', sessionId, chatId] as const;

/**
 * Fetch fact-verification verdicts (with nested statements) for every AI
 * message in a session-bound chat.
 */
export const fetchChatVerifications = async (
  sessionId: number,
  chatId: number
): Promise<MessageVerification[]> => {
  const response = await axios.get<MessageVerification[]>(
    `/api/sessions/${sessionId}/chats/${chatId}/verifications`
  );
  if (!Array.isArray(response.data)) {
    console.error(
      '[UI API] Invalid response from chat verifications: expected array, got',
      response.data
    );
    return [];
  }
  return response.data;
};

export interface SingleChatVerifyOverrides {
  skipVerified?: boolean;
  modelName?: string;
  contextSize?: number | null;
  thinkingBudget?: number | null;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  numGpuLayers?: number | null;
}

/** Trigger a single-chat verification job from the chat header. */
export const triggerSingleChatVerification = async (
  sessionId: number,
  chatId: number,
  overrides?: SingleChatVerifyOverrides
): Promise<{ jobId: number }> => {
  const response = await axios.post<{ jobId: number }>(
    `/api/sessions/${sessionId}/chats/${chatId}/verify`,
    overrides ?? {}
  );
  return response.data;
};

// ---------------------------------------------------------------------------
// Dashboard-level DTOs + client for `/api/verification/*` (VerificationAuditPage).
// ---------------------------------------------------------------------------

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

export interface VerificationJob {
  id: number;
  status: VerificationJobStatus;
  scope: VerificationJobScope;
  session_ids_json: string | null;
  chat_id: number | null;
  skip_verified: boolean;
  total_messages: number;
  processed_messages: number;
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

/** Alias kept for dashboard components (same shape as MessageVerification). */
export type MessageVerificationDetail = MessageVerification;

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
  fabricationRate: number;
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
  isFullyVerified: boolean;
  flaggedIssues: number;
  averageAccuracy: number | null;
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
  byModel: ModelAccuracyStat[];
  overTime: VerificationTimepointStat[];
  sessionsSummary: SessionVerificationSummary[];
}

export interface FlaggedStatementItem extends VerifiedStatement {
  sessionName: string;
  clientName: string;
  chatId: number;
  authoredModel: string | null;
  judgeModel: string;
  verifiedAt: number;
}

export interface FlaggedStatementsResult {
  items: FlaggedStatementItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Progress event streamed by `GET /api/verification/jobs/:jobId/stream`. */
export interface VerificationStreamEvent {
  jobId: number;
  timestamp: number;
  type:
    | 'snapshot'
    | 'status'
    | 'progress'
    | 'message_verified'
    | 'complete'
    | 'error';
  status?: string;
  message?: string;
  totalMessages?: number;
  processedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  messageId?: number;
  chatId?: number;
  sessionId?: number;
  accuracyScore?: number;
  totalClaims?: number;
  job?: VerificationJob;
}

export interface CreateVerificationJobPayload {
  scope: VerificationJobScope;
  sessionIds?: number[];
  chatId?: number;
  skipVerified?: boolean;
  modelName?: string;
  contextSize?: number | null;
  thinkingBudget?: number | null;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  numGpuLayers?: number | null;
  baseUrl?: string;
}

export interface VerificationStatsParams {
  sessionId?: number;
  model?: string;
  startDate?: string;
  endDate?: string;
}

export interface FlaggedStatementsParams {
  verdict?: StatementVerdict[];
  severity?: StatementSeverity[];
  authoredModel?: string;
  sessionId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Creates and enqueues a new fact-verification job.
 * @returns A promise resolving to an object containing the new job ID.
 */
export const createVerificationJob = async (
  data: CreateVerificationJobPayload
): Promise<{ jobId: number }> => {
  const response = await axios.post('/api/verification/jobs', data);
  return response.data;
};

/**
 * Fetches recent verification jobs (newest first).
 */
export const fetchVerificationJobs = async (): Promise<VerificationJob[]> => {
  const response = await axios.get<VerificationJob[]>('/api/verification/jobs');
  return Array.isArray(response.data) ? response.data : [];
};

/**
 * Fetches a single verification job by its ID.
 */
export const fetchVerificationJob = async (
  jobId: number
): Promise<VerificationJob> => {
  const response = await axios.get<VerificationJob>(
    `/api/verification/jobs/${jobId}`
  );
  return response.data;
};

/**
 * Requests cancellation of a pending/processing verification job.
 */
export const cancelVerificationJob = async (
  jobId: number
): Promise<{ message: string }> => {
  const response = await axios.post(`/api/verification/jobs/${jobId}/cancel`);
  return response.data;
};

/**
 * Fetches global verification analytics (KPIs, per-model accuracy,
 * time series, session coverage).
 */
export const fetchVerificationStats = async (
  params?: VerificationStatsParams
): Promise<VerificationGlobalStats> => {
  const response = await axios.get<VerificationGlobalStats>(
    '/api/verification/stats',
    { params }
  );
  return response.data;
};

/**
 * Fetches paginated/filterable flagged statements (fabrications,
 * contradictions, partial support, omissions).
 */
export const fetchFlaggedStatements = async (
  params?: FlaggedStatementsParams
): Promise<FlaggedStatementsResult> => {
  const response = await axios.get<FlaggedStatementsResult>(
    '/api/verification/statements',
    {
      params: {
        ...params,
        verdict: params?.verdict?.join(',') || undefined,
        severity: params?.severity?.join(',') || undefined,
      },
    }
  );
  return response.data;
};

/**
 * Clears the verification for a specific chat message.
 */
export const deleteMessageVerification = async (
  messageId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(
    `/api/verification/messages/${messageId}`
  );
  return response.data;
};

/**
 * Clears all verifications so chats can be re-audited from scratch.
 * Refused (409) while a job is pending/processing.
 */
export const resetVerifications = async (): Promise<{
  message: string;
  deletedVerifications: number;
}> => {
  const response = await axios.delete('/api/verification/reset');
  return response.data;
};

/**
 * Triggers a quick single-chat verification job (dashboard-level alias
 * accepting the full job payload overrides, including baseUrl).
 */
export const verifySingleChat = async (
  sessionId: number,
  chatId: number,
  overrides?: Partial<CreateVerificationJobPayload>
): Promise<{ jobId: number }> => {
  const response = await axios.post(
    `/api/sessions/${sessionId}/chats/${chatId}/verify`,
    overrides ?? {}
  );
  return response.data;
};
