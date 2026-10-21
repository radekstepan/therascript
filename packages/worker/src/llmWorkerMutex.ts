// packages/worker/src/llmWorkerMutex.ts
//
// Cross-queue async mutex for LLM-backed worker jobs.
//
// The worker process runs `analysisWorker` and `verificationWorker` side by
// side (see `index.ts`), each with `concurrency: 1`. That only serializes
// jobs *within* one queue: an analysis job and a verification job can still
// run concurrently and interleave their `loadLlmModelForWorker` /
// `unloadModelAtUrlForWorker` sequences, unloading each other's active model
// mid-stream on LM Studio (which serves a single model at a time).
//
// Both `processAnalysisJob` and `processVerificationJob` wrap their entire
// body in `runWithLlmWorkerLock` so at most one LLM-backed job holds the
// model slot at any moment. The transcription worker is unaffected (it uses
// the Whisper service, not LM Studio).

/** Tail of the lock chain. Resolved when no job holds the lock. */
let lockTail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` once no earlier lock holder is still running. Calls are served
 * FIFO; a rejection releases the lock for the next waiter and propagates
 * to the caller.
 */
export function runWithLlmWorkerLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lockTail.then(() => fn());
  // Advance the tail regardless of outcome so one failed job cannot wedge
  // the queue. The rejection itself still propagates via `result`.
  lockTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Test-only reset for the module-level lock chain. */
export function __resetLlmWorkerLockForTests(): void {
  lockTail = Promise.resolve();
}
