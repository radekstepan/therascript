// packages/worker/src/services/queueActivity.ts
//
// Read-only BullMQ handles so worker processors can enforce the GPU
// exclusion invariant ("at most one service": local LLM xor transcription)
// without importing API-layer services (separate deployable).
//
// The API side mirrors these in `jobQueueService` (`isTranscriptionActive`,
// `getLlmQueueActivity`); queue counts are the source of truth in both
// processes because DB status rows can go stale after a crash.
import { Queue } from 'bullmq';
import {
  redisConnection,
  TRANSCRIPTION_QUEUE_NAME,
  ANALYSIS_QUEUE_NAME,
  VERIFICATION_QUEUE_NAME,
} from '@therascript/queue';

let transcriptionQueue: Queue | null = null;
let analysisQueue: Queue | null = null;
let verificationQueue: Queue | null = null;

const getTranscriptionQueue = (): Queue => {
  if (!transcriptionQueue) {
    transcriptionQueue = new Queue(TRANSCRIPTION_QUEUE_NAME, {
      connection: redisConnection,
    });
  }
  return transcriptionQueue;
};

const getAnalysisQueue = (): Queue => {
  if (!analysisQueue) {
    analysisQueue = new Queue(ANALYSIS_QUEUE_NAME, {
      connection: redisConnection,
    });
  }
  return analysisQueue;
};

const getVerificationQueue = (): Queue => {
  if (!verificationQueue) {
    verificationQueue = new Queue(VERIFICATION_QUEUE_NAME, {
      connection: redisConnection,
    });
  }
  return verificationQueue;
};

/** True when any transcription job is waiting, active, or delayed. */
export const isTranscriptionQueueActive = async (): Promise<boolean> => {
  const counts = await getTranscriptionQueue().getJobCounts(
    'wait',
    'active',
    'delayed'
  );
  return counts.wait + counts.active + counts.delayed > 0;
};

/**
 * Waiting/active/delayed counts for the LLM-backed queues (analysis +
 * verification). The transcription worker refuses to start while these are
 * non-zero so it never yanks a model out from under a running job.
 */
export const getLlmQueueActivityForWorker = async (): Promise<{
  analysis: number;
  verification: number;
}> => {
  const [analysisCounts, verificationCounts] = await Promise.all([
    getAnalysisQueue().getJobCounts('wait', 'active', 'delayed'),
    getVerificationQueue().getJobCounts('wait', 'active', 'delayed'),
  ]);
  return {
    analysis:
      analysisCounts.wait + analysisCounts.active + analysisCounts.delayed,
    verification:
      verificationCounts.wait +
      verificationCounts.active +
      verificationCounts.delayed,
  };
};

/** Close lazily created reader handles (worker shutdown path). */
export const closeQueueActivityReaders = async (): Promise<void> => {
  const queues = [transcriptionQueue, analysisQueue, verificationQueue].filter(
    (q): q is Queue => q !== null
  );
  transcriptionQueue = null;
  analysisQueue = null;
  verificationQueue = null;
  await Promise.all(queues.map((q) => q.close()));
};
