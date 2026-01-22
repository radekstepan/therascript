// packages/worker/src/index.ts
import { Worker, Job } from 'bullmq';
import { configureDb, closeDb } from '@therascript/db';
import { configureFileService } from '@therascript/services';
import { closeElasticsearchClient } from '@therascript/elasticsearch-client';
import config from '@therascript/config';
import {
  redisConnection,
  TRANSCRIPTION_QUEUE_NAME,
  ANALYSIS_QUEUE_NAME,
} from '@therascript/queue';
import transcriptionProcessor from './jobs/transcriptionProcessor.js';
import analysisProcessor from './jobs/analysisProcessor.js';
import { closePublisher } from './services/streamPublisher.js';

console.log('[Worker] Initializing worker process...');

// Configure database connection for worker
configureDb({
  dbPath: config.db.sqlitePath,
  isDev: config.server.nodeEnv === 'development',
});

configureFileService(config.db.uploadsDir);

// Note: QueueScheduler has been removed in BullMQ 5.x
// If you need scheduler functionality, consider using the worker with job scheduling features
// or external scheduling solutions like node-cron

console.log(
  `[Worker] Initializing worker for queue: "${TRANSCRIPTION_QUEUE_NAME}"`
);
const transcriptionWorker = new Worker(
  TRANSCRIPTION_QUEUE_NAME,
  transcriptionProcessor,
  {
    connection: redisConnection,
    concurrency: 1, // Critical: Prevents GPU memory exhaustion by allowing only one Whisper job at a time
  }
);

console.log(`[Worker] Initializing worker for queue: "${ANALYSIS_QUEUE_NAME}"`);
const analysisWorker = new Worker(ANALYSIS_QUEUE_NAME, analysisProcessor, {
  connection: redisConnection,
  concurrency: 2, // Can run a couple of analysis jobs in parallel
});

// --- Event Listeners for Logging ---
const setupWorkerEventListeners = (worker: Worker, name: string) => {
  worker.on('active', (job: Job) => {
    console.log(`[${name} Worker] Job ${job.id} is now active.`);
  });
  worker.on('completed', (job: Job, returnValue: any) => {
    console.log(
      `[${name} Worker] Job ${job.id} completed with result:`,
      returnValue
    );
  });
  worker.on('failed', (job: Job | undefined, error: Error) => {
    console.error(
      `[${name} Worker] Job ${job?.id || 'unknown'} failed:`,
      error
    );
  });
  worker.on('error', (err: Error) => {
    console.error(`[${name} Worker] A worker error occurred:`, err);
  });
};

let lastTranscriptionJobStartTime: number | null = null;
transcriptionWorker.on('active', (job: Job) => {
  const now = Date.now();
  if (lastTranscriptionJobStartTime) {
    const interval = now - lastTranscriptionJobStartTime;
    console.log(`[Transcription Worker] Job interval: ${interval}ms`);
  }
  lastTranscriptionJobStartTime = now;
});

setupWorkerEventListeners(transcriptionWorker, 'Transcription');
setupWorkerEventListeners(analysisWorker, 'Analysis');

console.log('[Worker] All workers initialized and waiting for jobs.');

// --- Graceful Shutdown ---
let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);
  try {
    await Promise.all([transcriptionWorker.close(), analysisWorker.close()]);
    console.log('[Worker] All BullMQ components closed.');
    closeDb();
    console.log('[Worker] Database connection closed.');
    await closeElasticsearchClient();
    await closePublisher();
    console.log('[Worker] Redis publisher closed.');
  } catch (err) {
    console.error('[Worker] Error during graceful shutdown:', err);
  } finally {
    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
