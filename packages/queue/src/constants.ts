export const TRANSCRIPTION_QUEUE_NAME = 'transcription-jobs';
export const ANALYSIS_QUEUE_NAME = 'analysis-jobs';
export const VERIFICATION_QUEUE_NAME = 'verification-jobs';

export function getAnalysisChannel(jobId: number): string {
  return `analysis:job:${jobId}:events`;
}

export const getVerificationChannel = (jobId: number | string): string =>
  `verification-stream:${jobId}`;
