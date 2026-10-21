import { Redis } from 'ioredis';
import {
  createRedisClient,
  getAnalysisChannel,
  getVerificationChannel,
  type StreamEvent,
  type VerificationStreamEvent,
} from '@therascript/queue';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = createRedisClient();
  }
  return publisher;
}

export async function closePublisher(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
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
  getPublisher()
    .publish(getAnalysisChannel(jobId), JSON.stringify(payload))
    .catch((err: unknown) => {
      console.error(
        `[StreamPublisher] Failed to publish event for job ${jobId}:`,
        err
      );
    });
}

export function publishVerificationEvent(
  jobId: number,
  event: Omit<VerificationStreamEvent, 'jobId' | 'timestamp'>
) {
  const payload: VerificationStreamEvent = {
    jobId,
    timestamp: Date.now(),
    ...event,
  };
  getPublisher()
    .publish(getVerificationChannel(jobId), JSON.stringify(payload))
    .catch((err: unknown) => {
      console.error(
        `[StreamPublisher] Failed to publish verification event for job ${jobId}:`,
        err
      );
    });
}
