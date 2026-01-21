// packages/api/src/services/redisConnection.ts
import { ConnectionOptions } from 'bullmq';
import config from '@therascript/config';

console.log(
  `[Redis Connection] Setting up Redis connection for BullMQ: ${config.redis.host}:${config.redis.port}`
);

// Shared connection options for all queues and schedulers
export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null, // Important for robustness
};

// --- Queue Names ---
// Centralize queue names to be used by both API and Worker
export const TRANSCRIPTION_QUEUE_NAME = 'transcription-jobs';
export const ANALYSIS_QUEUE_NAME = 'analysis-jobs';

// Note: QueueScheduler has been removed in BullMQ 5.x
// If you need scheduler functionality, consider using the worker with job scheduling features
// or external scheduling solutions like node-cron

console.log('[Redis Connection] BullMQ connection configured.');
