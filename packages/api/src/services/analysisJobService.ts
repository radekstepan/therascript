// packages/api/src/services/analysisJobService.ts
import { addAnalysisJob } from './jobQueueService.js';

/**
 * The main function to trigger a multi-transcript analysis job.
 * This now only adds a job to the Redis queue. The actual processing is done by a worker.
 * @param jobId The ID of the analysis job from the database.
 */
export async function processAnalysisJob(jobId: number): Promise<void> {
  console.log(`[AnalysisService] Enqueuing job for analysis job ID: ${jobId}`);
  try {
    await addAnalysisJob({ jobId });
    console.log(
      `[AnalysisService] Successfully enqueued job for analysis job ID: ${jobId}`
    );
  } catch (error) {
    console.error(
      `[AnalysisService] FATAL ERROR: Failed to enqueue job for analysis job ID ${jobId}:`,
      error
    );
    // In a real scenario, you might want to update the job status to 'failed' here
    // if it can't even be queued.
  }
}
