export interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy' | 'status';
  type:
    | 'start'
    | 'token'
    | 'thinking'
    | 'end'
    | 'error'
    | 'status'
    | 'truncated';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  status?: string;
  message?: string;
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
  /** Truncation metadata (only set when type === 'truncated'). */
  originalTokens?: number;
  finalTokens?: number;
  droppedParagraphs?: number;
}

/**
 * Worker lifecycle phase for a verification job. Published on `phase`
 * events (and echoed on terminal events) so the UI can show truthful
 * indeterminate activity while `processedMessages` legitimately stays
 * flat during LLM generation.
 */
export type VerificationStreamPhase =
  | 'waiting_for_lock'
  | 'loading_judge'
  | 'checking_message'
  | 'generating'
  | 'retrying'
  | 'finishing';

/**
 * Progress event published by the verification worker (`verification-jobs`)
 * on the `verification-stream:<jobId>` channel. Consumed by
 * `GET /api/verification/jobs/:jobId/stream` (SSE) and the /verification
 * dashboard.
 */
export interface VerificationStreamEvent {
  jobId: number;
  timestamp: number;
  type:
    | 'status'
    | 'progress'
    | 'phase'
    | 'message_verified'
    | 'complete'
    | 'error';
  /** Job lifecycle status (present on `status` / `complete` / `error`). */
  status?: string;
  /** Human-readable detail (present on `status` / `phase` / `error`). */
  message?: string;
  totalMessages?: number;
  processedMessages?: number;
  /** Finished-attempt outcome split (present on `progress` / `phase` / terminal events). */
  succeededMessages?: number;
  failedMessages?: number;
  skippedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  /** Per-message detail (present on `message_verified`). */
  messageId?: number;
  chatId?: number;
  sessionId?: number;
  accuracyScore?: number;
  totalClaims?: number;
  /** Live phase detail (present on `phase`; `phase` also echoed on terminal events). */
  phase?: VerificationStreamPhase;
  /** 1-based index of the message being worked on within this run. */
  messageIndex?: number;
  /** Judge LLM attempt number for the current message (1 = initial call, 2 = retry with thinking disabled). */
  attempt?: number;
  /** Milliseconds elapsed since the worker started processing this job. */
  elapsedMs?: number;
}
