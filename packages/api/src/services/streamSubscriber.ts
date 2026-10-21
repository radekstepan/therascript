import {
  createRedisClient,
  getAnalysisChannel,
  getVerificationChannel,
  type StreamEvent,
  type VerificationStreamEvent,
} from '@therascript/queue';

function createChannelSubscriber<T>(
  channel: string,
  onMessage: (event: T) => void
): () => void {
  const subscriber = createRedisClient();

  subscriber.on('message', (ch: string, message: string) => {
    if (ch === channel) {
      try {
        const event = JSON.parse(message) as T;
        // Yield to the event loop so the SSE controller has a chance to
        // flush the previous event to the wire before we enqueue the next
        // one. Without this, back-to-back Redis messages get coalesced into
        // a single kernel-send-buffer flush on remote (non-loopback) sockets,
        // which is what makes streaming appear to "burst" and stall
        // on proxies.
        setImmediate(() => onMessage(event));
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

export function createJobSubscriber(
  jobId: number,
  onMessage: (event: StreamEvent) => void
): () => void {
  return createChannelSubscriber<StreamEvent>(
    getAnalysisChannel(jobId),
    onMessage
  );
}

export function subscribeToVerificationStream(
  jobId: number,
  onMessage: (event: VerificationStreamEvent) => void
): () => void {
  return createChannelSubscriber<VerificationStreamEvent>(
    getVerificationChannel(jobId),
    onMessage
  );
}
