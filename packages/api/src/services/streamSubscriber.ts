import { Redis } from 'ioredis';
import config from '../config/index.js';

// Define the event shape again for type safety on the API side
export interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy';
  type: 'start' | 'token' | 'end' | 'error' | 'status';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  status?: string;
  message?: string;
}

/**
 * Creates a subscription to the Redis channel for a specific analysis job.
 * Returns a cleanup function to unsubscribe and disconnect.
 */
export function createJobSubscriber(
  jobId: number,
  onMessage: (event: StreamEvent) => void
): () => void {
  const subscriber = new Redis({
    host: config.redis.host,
    port: config.redis.port,
  });

  const channel = `analysis:job:${jobId}:events`;

  // Explicitly type callback parameters
  subscriber.on('message', (ch: string, message: string) => {
    if (ch === channel) {
      try {
        const event = JSON.parse(message) as StreamEvent;
        onMessage(event);
      } catch (e) {
        console.error('[StreamSubscriber] Error parsing Redis message:', e);
      }
    }
  });

  // Subscribe to channel
  subscriber
    .subscribe(channel)
    .then(() => {
      console.log(`[StreamSubscriber] Subscribed to ${channel}`);
    })
    .catch((err: unknown) => {
      console.error(
        `[StreamSubscriber] Failed to subscribe to ${channel}:`,
        err
      );
    });

  return () => {
    console.log(`[StreamSubscriber] Unsubscribing from ${channel}`);
    subscriber.unsubscribe(channel);
    subscriber.quit();
  };
}
