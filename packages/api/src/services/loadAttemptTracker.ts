/**
 * In-process record of the most recent LLM model load attempt, keyed to the
 * single load the UI cares about (the active model). The `/api/llm/set-model`
 * route fires `loadLlmModel` without awaiting it, so without this tracker a
 * background failure is visible only in the server console while the UI
 * status poll carries no trace of what went wrong.
 *
 * Lifecycle (driven exclusively from `loadLlmModel` in llamaCppService.ts):
 *   - attempt start   -> `{ status: 'loading', modelName, error: null }`
 *   - attempt success -> `{ status: 'idle', ... }` (loaded truth comes from
 *                        LM Studio itself via `checkModelStatus`, not from here)
 *   - attempt failure -> `{ status: 'failed', modelName, error }` where
 *                        `error` is the human-readable reason (usually the
 *                        LM Studio API's own message, e.g. "No LM Runtime
 *                        found for model format 'gguf'").
 *
 * A new attempt always overwrites the previous record, so a stale failure
 * can never outlive the retry that follows it.
 *
 * Process-local like `loadedModelsTracker`: a server restart resets to idle
 * and the boot sync reconciles actual loaded state separately.
 */

export type LoadAttemptStatus = 'idle' | 'loading' | 'failed';

export interface LoadAttemptState {
  status: LoadAttemptStatus;
  /** Model key the last attempt targeted, or null when idle/never attempted. */
  modelName: string | null;
  /** Human-readable failure reason; non-null only when status is 'failed'. */
  error: string | null;
  /** ISO timestamp of the last transition, or null when never attempted. */
  attemptedAt: string | null;
}

const IDLE_STATE: LoadAttemptState = {
  status: 'idle',
  modelName: null,
  error: null,
  attemptedAt: null,
};

let lastAttempt: LoadAttemptState = { ...IDLE_STATE };

export const markLoadStarted = (modelName: string): void => {
  lastAttempt = {
    status: 'loading',
    modelName,
    error: null,
    attemptedAt: new Date().toISOString(),
  };
};

export const markLoadSucceeded = (): void => {
  lastAttempt = { ...IDLE_STATE };
};

export const markLoadFailed = (modelName: string, error: string): void => {
  lastAttempt = {
    status: 'failed',
    modelName,
    error,
    attemptedAt: new Date().toISOString(),
  };
};

/** Snapshot of the last load attempt. Returned by copy; safe to serialize. */
export const getLastLoadAttempt = (): LoadAttemptState => ({
  ...lastAttempt,
});

// Test-only — exported so unit tests can reset state between cases.
export const __resetForTests = (): void => {
  lastAttempt = { ...IDLE_STATE };
};
