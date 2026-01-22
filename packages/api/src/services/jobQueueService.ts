// packages/api/src/services/jobQueueService.ts
import { Queue } from 'bullmq';
import {
  redisConnection,
  TRANSCRIPTION_QUEUE_NAME,
  ANALYSIS_QUEUE_NAME,
} from '@therascript/queue';
import type {
  TranscriptionJobData,
  AnalysisJobData,
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

console.log('[JobQueueService] BullMQ Queues initialized.');

/**
 * Gets the number of active and waiting jobs for all queues.
 * @returns An object with total, transcription, and analysis counts.
 */
export const getActiveJobCounts = async () => {
  const [transcriptionCounts, analysisCounts] = await Promise.all([
    transcriptionQueue.getJobCounts('wait', 'active', 'delayed'),
    analysisQueue.getJobCounts('wait', 'active', 'delayed'),
  ]);

  const transcriptionTotal =
    transcriptionCounts.wait +
    transcriptionCounts.active +
    transcriptionCounts.delayed;
  const analysisTotal =
    analysisCounts.wait + analysisCounts.active + analysisCounts.delayed;

  return {
    total: transcriptionTotal + analysisTotal,
    transcription: transcriptionTotal,
    analysis: analysisTotal,
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

// --- Graceful Shutdown ---
export async function closeQueues() {
  console.log('[JobQueueService] Closing BullMQ queues...');
  try {
    await Promise.all([transcriptionQueue.close(), analysisQueue.close()]);
    console.log('[JobQueueService] BullMQ queues closed.');
  } catch (err) {
    console.error('[JobQueueService] Error closing BullMQ queues:', err);
  }
}
