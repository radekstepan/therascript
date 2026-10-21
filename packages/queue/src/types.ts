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
 * Progress event published by the verification worker (`verification-jobs`)
 * on the `verification-stream:<jobId>` channel. Consumed by
 * `GET /api/verification/jobs/:jobId/stream` (SSE) and the /verification
 * dashboard.
 */
export interface VerificationStreamEvent {
  jobId: number;
  timestamp: number;
  type: 'status' | 'progress' | 'message_verified' | 'complete' | 'error';
  /** Job lifecycle status (present on `status` / `complete` / `error`). */
  status?: string;
  /** Human-readable detail (present on `status` / `error`). */
  message?: string;
  totalMessages?: number;
  processedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  /** Per-message detail (present on `message_verified`). */
  messageId?: number;
  chatId?: number;
  sessionId?: number;
  accuracyScore?: number;
  totalClaims?: number;
}
