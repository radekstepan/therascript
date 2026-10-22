/* packages/ui/src/api/verification.ts */
import axios from 'axios';
import type { ChatMessage } from '../types';

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
  /** Machine-readable failure category (present on `failed` rows). */
  error_code?: string | null;
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
  baseUrl?: string;
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

/**
 * Backwards-compatible alias for {@link triggerSingleChatVerification}
 * (previously a duplicate implementation of the same endpoint).
 */
export const verifySingleChat = triggerSingleChatVerification;

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

export type VerificationPhase =
  | 'waiting_for_lock'
  | 'loading_judge'
  | 'checking_message'
  | 'generating'
  | 'retrying'
  | 'finishing';

export interface VerificationJob {
  id: number;
  status: VerificationJobStatus;
  scope: VerificationJobScope;
  session_ids_json: string | null;
  chat_id: number | null;
  skip_verified: boolean;
  total_messages: number;
  processed_messages: number;
  /** Finished-attempt outcome split (V21+; default 0 for older fixtures). */
  succeeded_messages?: number;
  failed_messages?: number;
  skipped_messages?: number;
  /** Live phase snapshot (active jobs only; null once terminal). */
  current_phase?: VerificationPhase | null;
  current_message_id?: number | null;
  current_attempt?: number | null;
  phase_updated_at?: number | null;
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

/**
 * Display outcome for a job row. Mixed runs stay `completed` at the API
 * level; the UI must never render them as unqualified success.
 */
export type VerificationJobOutcome =
  | 'active'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'canceled';

export function verificationJobOutcome(
  job: VerificationJob
): VerificationJobOutcome {
  if (job.status === 'pending' || job.status === 'processing') return 'active';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'canceled') return 'canceled';
  return (job.failed_messages ?? 0) > 0 ? 'completed_with_errors' : 'completed';
}

export function verificationJobOutcomeLabel(job: VerificationJob): string {
  const outcome = verificationJobOutcome(job);
  if (outcome === 'completed_with_errors') return 'Completed with errors';
  if (outcome === 'completed') return 'completed';
  return job.status;
}

/** Short human-readable label for a per-message failure category. */
export function verificationFailureCodeLabel(
  code: string | null | undefined
): string {
  switch (code) {
    case 'empty_output':
      return 'Empty Judge output';
    case 'malformed_json':
      return 'Invalid Judge JSON';
    case 'invalid_structure':
      return 'Invalid Judge response structure';
    case 'provider_error':
      return 'Judge provider error';
    case 'context_budget':
      return 'Judge context too small';
    case 'missing_transcript':
      return 'Transcript unavailable';
    default:
      return 'Fact-check failed';
  }
}

/** Failed message assessment attributable to one job run. */
export interface FailedVerificationItem {
  messageId: number;
  chatId: number;
  sessionId: number;
  sessionName: string;
  clientName: string;
  verificationJobId: number | null;
  authoredModel: string | null;
  judgeModel: string;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  verifiedAt: number;
}

export interface JobFailuresResult {
  jobId: number;
  failures: FailedVerificationItem[];
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
  failedAiMessages?: number;
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
  /** Messages whose latest verification attempt ended with status = 'failed'. */
  failedMessagesCount?: number;
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
    | 'phase'
    | 'message_verified'
    | 'complete'
    | 'error';
  status?: string;
  message?: string;
  totalMessages?: number;
  processedMessages?: number;
  succeededMessages?: number;
  failedMessages?: number;
  skippedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  messageId?: number;
  chatId?: number;
  sessionId?: number;
  accuracyScore?: number;
  totalClaims?: number;
  phase?: VerificationPhase;
  messageIndex?: number;
  attempt?: number;
  elapsedMs?: number;
  /** Live Judge generation rate (throttled `phase` ticks; null once ended). */
  tokensPerSecond?: number | null;
  /** Cumulative estimated tokens in the current attempt. */
  generatedTokens?: number | null;
  job?: VerificationJob;
}

/** Live phase detail surfaced by `useVerificationStream`. */
export interface VerificationLivePhase {
  phase: VerificationPhase;
  message: string | null;
  messageId: number | null;
  chatId: number | null;
  sessionId: number | null;
  messageIndex: number | null;
  attempt: number | null;
  elapsedMs: number | null;
  tokensPerSecond: number | null;
  generatedTokens: number | null;
  updatedAt: number;
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
  clientName?: string;
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
 * Fetches failed message assessments attributable to one job run
 * (powers the Job History "View details" dialog).
 */
export const fetchVerificationJobFailures = async (
  jobId: number
): Promise<JobFailuresResult> => {
  const response = await axios.get<JobFailuresResult>(
    `/api/verification/jobs/${jobId}/failures`
  );
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

// ---------------------------------------------------------------------------
// Chat-scoped verification coverage (session chat header status icon).
// ---------------------------------------------------------------------------

/**
 * Mirrors the backend `WELCOME_MESSAGE_LIKE_PATTERN`
 * (`Session "%" has been transcribed and is ready for analysis.` in
 * `verificationRepository.ts`): the automatic message inserted by the
 * transcription pipeline. Such messages (with `completionTokens` NULL)
 * are never audited.
 */
const WELCOME_MESSAGE_RE =
  /^Session "[\s\S]*" has been transcribed and is ready for analysis\.$/;

/**
 * True when `message` is an AI note the backend would consider for
 * verification. Mirrors `VERIFIABLE_AI_MESSAGE_FILTER`:
 * sender is `ai`, text is non-empty, not the automatic welcome message,
 * and answering a preceding user message in the same chat.
 *
 * Two client-side allowances keep the header status truthful:
 * - Optimistic (negative-id) AI messages count even while their text is
 *   still empty, so the all-verified icon hides the moment a note is
 *   added instead of lingering through the thinking phase.
 * - The preceding-user check uses array order (identical to `u.id < m.id`
 *   for persisted rows, whose ids grow chronologically) so optimistic
 *   temp ids order correctly.
 *
 * Trivial conversational greetings are NOT excluded: the worker audits
 * them via its zero-token fast path and stores a `completed` row, so
 * they are eligible and count as checked once that row exists.
 */
export function isVerifiableChatAiMessage(
  message: ChatMessage,
  messages: ChatMessage[]
): boolean {
  if (message.sender !== 'ai') return false;
  if (
    message.completionTokens == null &&
    WELCOME_MESSAGE_RE.test(message.text)
  ) {
    return false;
  }
  if (message.text.trim() === '' && !(message.id < 0)) return false;
  const index = messages.indexOf(message);
  if (index >= 0) {
    return messages.slice(0, index).some((m) => m.sender === 'user');
  }
  return messages.some((m) => m.sender === 'user' && m.id < message.id);
}

export interface ChatVerificationSummary {
  eligibleMessageIds: number[];
  checkedMessageIds: number[];
  failedMessageIds: number[];
  /** Eligible but without a terminal record: absent or `skipped`. */
  uncheckedMessageIds: number[];
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  totalClaims: number;
  omissionsCount: number;
  /**
   * Pooled accuracy percent across completed verifications
   * (`(supported + 0.5 * partial) / (totalClaims + omissions) * 100`,
   * mirroring the worker's `computeVerificationAccuracy` weighting).
   * Null when nothing with claims was assessed — callers must label
   * this as unknown, never render it as 0%.
   */
  accuracyPercent: number | null;
  /**
   * True only when at least one note is eligible and every eligible
   * note has a `completed` verification. A completed assessment with
   * flagged claims still counts; `failed`, `skipped`, or absent does not.
   */
  allVerified: boolean;
}

/**
 * Roll up per-chat verification coverage from the chat's messages and
 * its `chatVerifications` records. Only `completed` verifications
 * contribute claim/omission/accuracy totals.
 */
export function summarizeChatVerifications(
  messages: ChatMessage[],
  verifications: MessageVerification[]
): ChatVerificationSummary {
  const byMessageId = new Map<number, MessageVerification>();
  for (const v of verifications) {
    byMessageId.set(v.message_id, v);
  }
  const eligibleMessageIds: number[] = [];
  const checkedMessageIds: number[] = [];
  const failedMessageIds: number[] = [];
  const uncheckedMessageIds: number[] = [];
  let supportedClaims = 0;
  let partialClaims = 0;
  let contradictedClaims = 0;
  let fabricatedClaims = 0;
  let totalClaims = 0;
  let omissionsCount = 0;
  for (const message of messages) {
    if (!isVerifiableChatAiMessage(message, messages)) continue;
    eligibleMessageIds.push(message.id);
    const verification = byMessageId.get(message.id);
    if (verification?.status === 'completed') {
      checkedMessageIds.push(message.id);
      supportedClaims += verification.supported_claims;
      partialClaims += verification.partial_claims;
      contradictedClaims += verification.contradicted_claims;
      fabricatedClaims += verification.fabricated_claims;
      totalClaims += verification.total_claims;
      omissionsCount += verification.omissions_count;
    } else if (verification?.status === 'failed') {
      failedMessageIds.push(message.id);
    } else {
      uncheckedMessageIds.push(message.id);
    }
  }
  const denominator = totalClaims + omissionsCount;
  const accuracyPercent =
    denominator > 0
      ? ((supportedClaims + 0.5 * partialClaims) / denominator) * 100
      : null;
  return {
    eligibleMessageIds,
    checkedMessageIds,
    failedMessageIds,
    uncheckedMessageIds,
    supportedClaims,
    partialClaims,
    contradictedClaims,
    fabricatedClaims,
    totalClaims,
    omissionsCount,
    accuracyPercent,
    allVerified:
      eligibleMessageIds.length > 0 &&
      failedMessageIds.length === 0 &&
      uncheckedMessageIds.length === 0,
  };
}
