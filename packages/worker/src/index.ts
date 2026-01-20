// packages/worker/src/index.ts
import { Worker, Job } from 'bullmq';
import { configureDb, closeDb } from '@therascript/db';
import { configureFileService } from '@therascript/services';
import config from './config/index.js';
import { redisConnection } from './redisConnection.js';
import transcriptionProcessor, {
  transcriptionQueueName,
} from './jobs/transcriptionProcessor.js';
import analysisProcessor, {
  analysisQueueName,
} from './jobs/analysisProcessor.js';

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
  `[Worker] Initializing worker for queue: "${transcriptionQueueName}"`
);
const transcriptionWorker = new Worker(
  transcriptionQueueName,
  transcriptionProcessor,
  {
    connection: redisConnection,
    concurrency: 1, // Process one transcription job at a time to not overload GPU
    limiter: {
      max: 1,
      duration: 5000, // 1 job every 5 seconds
    },
  }
);

console.log(`[Worker] Initializing worker for queue: "${analysisQueueName}"`);
const analysisWorker = new Worker(analysisQueueName, analysisProcessor, {
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
  } catch (err) {
    console.error('[Worker] Error during graceful shutdown:', err);
  } finally {
    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
