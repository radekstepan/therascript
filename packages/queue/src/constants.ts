export const TRANSCRIPTION_QUEUE_NAME = 'transcription-jobs';
export const ANALYSIS_QUEUE_NAME = 'analysis-jobs';

export function getAnalysisChannel(jobId: number): string {
  return `analysis:job:${jobId}:events`;
}
