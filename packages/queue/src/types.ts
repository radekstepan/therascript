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
