// packages/api/src/types/jobQueue.ts

/**
 * Defines the data structure for a job that processes a transcription.
 */
export interface TranscriptionJobData {
  sessionId: number;
  numSpeakers?: number;
}

/**
 * Defines the data structure for a job that processes a multi-session analysis.
 */
export interface AnalysisJobData {
  jobId: number;
}

/**
 * Defines the data structure for a job that runs the LLM fact-verification
 * audit ("LLM Judge") over session-bound chats.
 */
export interface VerificationJobData {
  jobId: number;
}
