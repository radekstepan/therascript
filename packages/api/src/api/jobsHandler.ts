// packages/api/src/api/jobsHandler.ts
import { getActiveJobCounts } from '../services/jobQueueService.js';
import { InternalServerError } from '../errors.js';
import { analysisRepository } from '../repositories/analysisRepository.js';

export const getActiveJobCountHandler = async ({ set }: any) => {
  try {
    // 1. Get counts from the Redis queue (BullMQ)
    const queueCounts = await getActiveJobCounts();

    // 2. Get pre-queue counts from the database for jobs not yet in BullMQ
    let generatingStrategyCount = 0;
    try {
      const allAnalysisJobs = analysisRepository.listJobs();
      generatingStrategyCount = allAnalysisJobs.filter(
        (job) => job.status === 'generating_strategy'
      ).length;
    } catch (dbError) {
      console.error(
        '[JobsHandler] Error getting pre-queue job counts from DB:',
        dbError
      );
      // If the DB query fails, we'll proceed with just the queue counts
      // to avoid failing the entire endpoint.
    }

    // 3. Combine the counts
    const combinedCounts = {
      ...queueCounts,
      analysis: queueCounts.analysis + generatingStrategyCount,
      total: queueCounts.total + generatingStrategyCount,
    };

    set.status = 200;
    return combinedCounts;
  } catch (error) {
    console.error('[JobsHandler] Error getting active job counts:', error);
    throw new InternalServerError(
      'Failed to retrieve active job counts.',
      error instanceof Error ? error : undefined
    );
  }
};
