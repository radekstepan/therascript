// packages/worker/src/index.ts
import { Worker, Job } from 'bullmq';
import {
  configureDb,
  closeDb,
  openVaultDb,
  attachUnlockedDb,
  initializeDatabase,
  detectCipherSupport,
} from '@therascript/db';
import { configureFileService } from '@therascript/services';
import { closeElasticsearchClient } from '@therascript/elasticsearch-client';
import config from '@therascript/config';
import {
  supervisedVaultFd,
  readLineFromFd,
  decodeWorkerKeysPayload,
  clearVaultKeys,
  WORKER_READY_MARKER,
} from '@therascript/vault';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  redisConnection,
  TRANSCRIPTION_QUEUE_NAME,
  ANALYSIS_QUEUE_NAME,
  VERIFICATION_QUEUE_NAME,
} from '@therascript/queue';
import transcriptionProcessor from './jobs/transcriptionProcessor.js';
import analysisProcessor from './jobs/analysisProcessor.js';
import verificationProcessor from './jobs/verificationProcessor.js';
import { closePublisher } from './services/streamPublisher.js';
import {
  getLoadedBaseUrls as getTrackedLoadedBaseUrls,
  clear as clearLoadedModelsTracker,
} from './jobs/loadedModelsTracker.js';
import { unloadModelAtUrlForWorker } from './jobs/analysisProcessor.js';
import { closeQueueActivityReaders } from './services/queueActivity.js';
import { setWorkerVaultContext } from './vaultContext.js';
import { decideStandaloneBoot } from './standaloneBoot.js';

console.log('[Worker] Initializing worker process...');

configureFileService(config.db.uploadsDir);

// Note: QueueScheduler has been removed in BullMQ 5.x
// If you need scheduler functionality, consider using the worker with job scheduling features
// or external scheduling solutions like node-cron

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

export interface SupervisedConsumers {
  transcriptionWorker: Worker;
  analysisWorker: Worker;
  verificationWorker: Worker;
}

/**
 * Creates the BullMQ consumers. Deferred until the vault is open in
 * supervised mode so no job can run against a locked database.
 */
export function createConsumers(): SupervisedConsumers {
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

  console.log(
    `[Worker] Initializing worker for queue: "${ANALYSIS_QUEUE_NAME}"`
  );
  const analysisWorker = new Worker(ANALYSIS_QUEUE_NAME, analysisProcessor, {
    connection: redisConnection,
    // concurrency: 1 prevents a race condition where two jobs using different
    // models simultaneously call loadLlmModelForWorker, causing them to
    // interleave their unload/load sequences and corrupt each other's state.
    concurrency: 1,
  });

  console.log(
    `[Worker] Initializing worker for queue: "${VERIFICATION_QUEUE_NAME}"`
  );
  const verificationWorker = new Worker(
    VERIFICATION_QUEUE_NAME,
    verificationProcessor,
    {
      connection: redisConnection,
      // Same single-model-at-a-time constraint as the analysis worker: the
      // Judge loads its own model via loadLlmModelForWorker.
      concurrency: 1,
    }
  );

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
  setupWorkerEventListeners(verificationWorker, 'Verification');

  console.log('[Worker] All workers initialized and waiting for jobs.');
  return { transcriptionWorker, analysisWorker, verificationWorker };
}

let consumers: SupervisedConsumers | null = null;

/**
 * Supervised boot: read the data keys from the inherited
 * private pipe, open + migrate the vault database, publish the worker
 * vault context, then create consumers and signal readiness on stdout.
 * Exits non-zero (no ready marker) on any failure so the API's
 * unlock fails closed.
 */
async function bootSupervised(): Promise<void> {
  const fd = supervisedVaultFd();
  if (fd === null) throw new Error('Supervised boot without vault fd');
  console.log(
    '[Worker] Supervised vault boot: reading keys from parent pipe...'
  );
  const payload = decodeWorkerKeysPayload(readLineFromFd(fd));
  configureDb({
    dbPath: payload.dbPath,
    isDev: config.server.nodeEnv === 'development',
  });
  const connection = openVaultDb(payload.dbPath, payload.database);
  try {
    // Runs pending migrations (the worker-side upgrade step).
    initializeDatabase(connection);
    attachUnlockedDb(connection);
  } catch (error) {
    try {
      connection.close();
    } catch {
      // ignore
    }
    throw error;
  }
  setWorkerVaultContext({
    keys: { database: payload.database, recordings: payload.recordings },
    generationId: payload.generationId,
    dbPath: payload.dbPath,
    recordingsDir: path.join(path.dirname(payload.dbPath), 'recordings'),
  });
  consumers = createConsumers();
  process.stdout.write(`${WORKER_READY_MARKER}\n`);
}

/** Legacy boot: plaintext database, consumers start immediately. */
function bootStandalone(): void {
  const decision = decideStandaloneBoot({
    vaultExists: existsSync(path.join(config.vault.dir, 'CURRENT')),
    cipherSupport: detectCipherSupport(),
  });
  if (decision.action === 'exit') {
    // Exit 0 on purpose: the dev/prod wrappers run this worker alongside
    // the API, and `--kill-others-on-fail` must not take down the stack.
    console.log(
      decision.reason === 'vault-exists'
        ? '[Worker] A vault exists; the API starts the supervised worker after unlock. ' +
            'Exiting this standalone worker.'
        : '[Worker] Vault support is available; the API will supervise the worker ' +
            'after vault setup/unlock. Exiting this standalone worker.'
    );
    process.exit(0);
  }
  configureDb({
    dbPath: config.db.sqlitePath,
    isDev: config.server.nodeEnv === 'development',
    mode: 'legacy-plaintext',
  });
  consumers = createConsumers();
}

let bootPromise: Promise<void>;
if (supervisedVaultFd() !== null) {
  bootPromise = bootSupervised().catch((error) => {
    console.error('[Worker] Supervised vault boot failed:', error);
    process.exit(1);
  });
} else {
  bootStandalone();
  bootPromise = Promise.resolve();
}
void bootPromise;

// --- Graceful Shutdown ---
let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);
  try {
    // Wait for boot so shutdown never races consumer creation.
    await bootPromise.catch(() => {});
    if (consumers) {
      await Promise.all([
        consumers.transcriptionWorker.close(),
        consumers.analysisWorker.close(),
        consumers.verificationWorker.close(),
      ]);
      console.log('[Worker] All BullMQ components closed.');
    }
    // Unload any models we loaded during in-flight analysis/verification
    // jobs (including per-job remote URLs the API process can't see).
    // Best-effort: a transient network blip must not block the exit.
    const trackedUrls = getTrackedLoadedBaseUrls();
    if (trackedUrls.length > 0) {
      console.log(
        `[Worker] Unloading ${trackedUrls.length} tracked URL(s): ${trackedUrls.join(', ')}`
      );
      await Promise.allSettled(
        trackedUrls.map(async (url) => {
          try {
            const count = await unloadModelAtUrlForWorker(url);
            console.log(
              `[Worker] Unloaded ${count} model instance(s) from ${url}`
            );
          } catch (err: any) {
            console.warn(
              `[Worker] Failed to unload models from ${url}: ${err?.message ?? err}`
            );
          }
        })
      );
    }
    clearLoadedModelsTracker();
    await closeQueueActivityReaders();
    closeDb();
    console.log('[Worker] Database connection closed.');
    await closeElasticsearchClient();
    await closePublisher();
    console.log('[Worker] Redis publisher closed.');
    // Drop key material on the way out (best-effort: the process exits).
    const { getWorkerVaultContext } = await import('./vaultContext.js');
    const vault = getWorkerVaultContext();
    if (vault) clearVaultKeys(vault.keys);
  } catch (err) {
    console.error('[Worker] Error during graceful shutdown:', err);
  } finally {
    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
