export interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy' | 'status';
  type: 'start' | 'token' | 'end' | 'error' | 'status';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  status?: string;
  message?: string;
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
}
