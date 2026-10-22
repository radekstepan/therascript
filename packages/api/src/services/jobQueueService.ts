// packages/api/src/services/jobQueueService.ts
import { Queue } from 'bullmq';
import {
  redisConnection,
  TRANSCRIPTION_QUEUE_NAME,
  ANALYSIS_QUEUE_NAME,
  VERIFICATION_QUEUE_NAME,
} from '@therascript/queue';
import type {
  TranscriptionJobData,
  AnalysisJobData,
  VerificationJobData,
} from '../types/jobQueue.js';

// --- Initialize Queues ---
// Create queue instances that will be used to add jobs.
const transcriptionQueue = new Queue<TranscriptionJobData>(
  TRANSCRIPTION_QUEUE_NAME,
  { connection: redisConnection }
);
const analysisQueue = new Queue<AnalysisJobData>(ANALYSIS_QUEUE_NAME, {
  connection: redisConnection,
});
const verificationQueue = new Queue<VerificationJobData>(
  VERIFICATION_QUEUE_NAME,
  { connection: redisConnection }
);

console.log('[JobQueueService] BullMQ Queues initialized.');

/**
 * Gets the number of active and waiting jobs for all queues.
 * @returns An object with total, transcription, analysis, and verification counts.
 */
export const getActiveJobCounts = async () => {
  const [transcriptionCounts, analysisCounts, verificationCounts] =
    await Promise.all([
      transcriptionQueue.getJobCounts('wait', 'active', 'delayed'),
      analysisQueue.getJobCounts('wait', 'active', 'delayed'),
      verificationQueue.getJobCounts('wait', 'active', 'delayed'),
    ]);

  const transcriptionTotal =
    transcriptionCounts.wait +
    transcriptionCounts.active +
    transcriptionCounts.delayed;
  const analysisTotal =
    analysisCounts.wait + analysisCounts.active + analysisCounts.delayed;
  const verificationTotal =
    verificationCounts.wait +
    verificationCounts.active +
    verificationCounts.delayed;

  return {
    total: transcriptionTotal + analysisTotal + verificationTotal,
    transcription: transcriptionTotal,
    analysis: analysisTotal,
    verification: verificationTotal,
  };
};

// --- Service Functions to Add Jobs ---

/**
 * Adds a new transcription job to the queue.
 * @param data - The data required for the transcription job (e.g., sessionId).
 * @returns The added job instance from BullMQ.
 */
export const addTranscriptionJob = async (data: TranscriptionJobData) => {
  console.log(
    `[JobQueueService] Adding transcription job to queue for session ID: ${data.sessionId}`
  );
  const job = await transcriptionQueue.add('process-transcription', data, {
    removeOnComplete: true, // Keep job history clean
    removeOnFail: 50, // Keep last 50 failed jobs for debugging
  });
  console.log(
    `[JobQueueService] Added job ${job.id} to queue "${TRANSCRIPTION_QUEUE_NAME}"`
  );
  return job;
};

/**
 * Adds a new analysis job to the queue.
 * @param data - The data required for the analysis job (e.g., jobId from the database).
 * @returns The added job instance from BullMQ.
 */
export const addAnalysisJob = async (data: AnalysisJobData) => {
  console.log(
    `[JobQueueService] Adding analysis job to queue for DB job ID: ${data.jobId}`
  );
  const job = await analysisQueue.add('process-analysis', data, {
    removeOnComplete: true,
    removeOnFail: 50,
  });
  console.log(
    `[JobQueueService] Added job ${job.id} to queue "${ANALYSIS_QUEUE_NAME}"`
  );
  return job;
};

/**
 * Deterministic BullMQ job id for a SQLite `verification_jobs` row.
 * Re-adding the same row (e.g. after an ambiguous submission failure)
 * returns the existing queued job instead of duplicating work — BullMQ
 * dedupes `add` on `jobId` — and lets the API reconcile a rejected
 * submission with an O(1) `getJob` lookup instead of a queue scan.
 */
export const getVerificationQueueJobId = (dbJobId: number): string =>
  `verification-${dbJobId}`;

/**
 * Adds a new verification job to the queue.
 * @param data - The data required for the verification job (e.g., jobId from the database).
 * @returns The added job instance from BullMQ.
 */
export const addVerificationJob = async (data: VerificationJobData) => {
  console.log(
    `[JobQueueService] Adding verification job to queue for DB job ID: ${data.jobId}`
  );
  const job = await verificationQueue.add('process-verification', data, {
    jobId: getVerificationQueueJobId(data.jobId),
    removeOnComplete: true,
    removeOnFail: 50,
  });
  console.log(
    `[JobQueueService] Added job ${job.id} to queue "${VERIFICATION_QUEUE_NAME}"`
  );
  return job;
};

/**
 * Returns true when the queue still holds the BullMQ job for a SQLite
 * `verification_jobs` row (waiting, delayed, active, ...). Used to
 * reconcile a rejected `addVerificationJob`: a rejection that arrives
 * after the server accepted the job must not mark a live job failed.
 */
export const isVerificationJobQueued = async (
  dbJobId: number
): Promise<boolean> => {
  const queued = await verificationQueue.getJob(
    getVerificationQueueJobId(dbJobId)
  );
  return queued !== undefined && queued !== null;
};

/**
 * Removes a pending (not yet picked up by the worker) verification job from
 * the queue. Active jobs cannot be removed this way — they observe the
 * `canceled` DB status and stop cooperatively.
 * @param jobId - The SQLite `verification_jobs` row id.
 * @returns The number of queued BullMQ jobs removed.
 */
export const cancelVerificationJobFromQueue = async (
  jobId: number
): Promise<number> => {
  const queuedJobs = await verificationQueue.getJobs(['wait', 'delayed']);
  let removed = 0;
  for (const queuedJob of queuedJobs) {
    if (queuedJob.data?.jobId === jobId) {
      await queuedJob.remove();
      removed++;
    }
  }
  if (removed > 0) {
    console.log(
      `[JobQueueService] Removed ${removed} queued verification job(s) for DB job ID: ${jobId}`
    );
  }
  return removed;
};

/**
 * Obliterates all jobs in the transcription queue, including active ones.
 * Useful for clearing stuck jobs.
 */
export const resetTranscriptionQueue = async () => {
  console.log('[JobQueueService] Obliterating transcription queue...');
  await transcriptionQueue.obliterate({ force: true });
  console.log('[JobQueueService] Transcription queue obliterated.');
};

// --- Graceful Shutdown ---
export async function closeQueues() {
  console.log('[JobQueueService] Closing BullMQ queues...');
  try {
    await Promise.all([
      transcriptionQueue.close(),
      analysisQueue.close(),
      verificationQueue.close(),
    ]);
    console.log('[JobQueueService] BullMQ queues closed.');
  } catch (err) {
    console.error('[JobQueueService] Error closing BullMQ queues:', err);
  }
}
