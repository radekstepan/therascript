import {
  createRedisClient,
  getAnalysisChannel,
  type StreamEvent,
} from '@therascript/queue';

export function createJobSubscriber(
  jobId: number,
  onMessage: (event: StreamEvent) => void
): () => void {
  const subscriber = createRedisClient();
  const channel = getAnalysisChannel(jobId);

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

  subscriber.subscribe(channel).catch((err: unknown) => {
    console.error(`[StreamSubscriber] Failed to subscribe to ${channel}:`, err);
  });

  return () => {
    subscriber.unsubscribe(channel);
    subscriber.quit();
  };
}
