// packages/api/src/types/jobQueue.ts

/**
 * Defines the data structure for a job that processes a transcription.
 */
export interface TranscriptionJobData {
  sessionId: number;
}

/**
 * Defines the data structure for a job that processes a multi-session analysis.
 */
export interface AnalysisJobData {
  jobId: number;
}
