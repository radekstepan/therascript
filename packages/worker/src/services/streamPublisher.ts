import { Redis } from 'ioredis';
import config from '../config/index.js';

// Use named import Redis for correct class construction
const publisher = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

export interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy' | 'status';
  type: 'start' | 'token' | 'end' | 'error' | 'status';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  status?: string;
  message?: string;
}

export function publishStreamEvent(
  jobId: number,
  event: Omit<StreamEvent, 'jobId' | 'timestamp'>
) {
  const payload: StreamEvent = {
    jobId,
    timestamp: Date.now(),
    ...event,
  };
  publisher
    .publish(`analysis:job:${jobId}:events`, JSON.stringify(payload))
    .catch((err: unknown) => {
      console.error(
        `[StreamPublisher] Failed to publish event for job ${jobId}:`,
        err
      );
    });
}
