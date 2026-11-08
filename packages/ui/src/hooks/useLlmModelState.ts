// packages/ui/src/hooks/useLlmModelState.ts
import { useMemo } from 'react';
import type { LlmStatus } from '../types';

export interface LlmModelState {
  hasActiveModel: boolean;
  isModelLoading: boolean;
  isModelReady: boolean;
  /** True when the last load attempt for the active model failed. */
  loadFailed: boolean;
  /** Human-readable failure reason when loadFailed, else null. */
  loadError: string | null;
  /** True when the LM Studio server did not respond at all. */
  isServerUnreachable: boolean;
  /**
   * True when the server verifiably holds a different model than the
   * configured one (settled state — not while loading).
   */
  modelMismatch: boolean;
  /** Key the server actually has loaded, or null when nothing is. */
  actualLoadedModel: string | null;
  /**
   * True when a model is configured but settled into not-loaded with
   * no other story to tell (not loading, failed, unreachable, or
   * mismatched) — e.g. right after an Unload. Callers must render an
   * explicit "Not loaded" state here, never a spinner and never the
   * same calm display as a loaded model.
   */
  isSettledNotLoaded: boolean;
}

/**
 * Model-key equality tolerant of the `publisher/` prefix: stored
 * actives may carry it while LM Studio reports a bare key (or vice
 * versa). The backend's status probe matches both forms, so the
 * mismatch detector must too — otherwise `meta/llama` vs `llama`
 * would false-positive as "server has X, you configured Y".
 */
export function llmModelKeysMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function useLlmModelState(
  llmStatus: LlmStatus | undefined
): LlmModelState {
  return useMemo(() => {
    const active = llmStatus?.activeModel;
    const hasActive = !!active && active !== 'default';
    const loaded = !!llmStatus?.loaded;
    const checked = llmStatus?.modelChecked;
    const isModelReady = hasActive && loaded && checked === active;
    // A failure only applies when it targets the currently active model,
    // so a stale record can never alarm about a model already replaced.
    // Missing loadState (stale response) means no known failure.
    const load = llmStatus?.loadState;
    const loadFailed =
      hasActive && load?.status === 'failed' && load.modelName === active;
    const loadError = loadFailed
      ? (load?.error ?? 'Model failed to load.')
      : null;
    // A failed load is terminal, not in-progress: report not-loading so
    // callers stop spinning and render the error instead. Likewise, an
    // explicit idle with nothing loaded is settled (e.g. right after an
    // Unload) — render the plain "not loaded" state, not a spinner. A
    // missing loadState (stale response) keeps the old inference.
    const isModelLoading =
      hasActive &&
      !loadFailed &&
      load?.status !== 'idle' &&
      (!loaded || checked !== active);
    // Missing reachability (stale/cached response) assumes reachable so
    // old payloads never false-alarm.
    const isServerUnreachable =
      llmStatus?.serverReachable === false ||
      llmStatus?.status === 'unavailable';
    const actualLoadedModel = llmStatus?.actualLoadedModel ?? null;
    // Only a settled, verifiable difference counts: while a load is in
    // flight the server legitimately still holds the old model, and
    // when the configured model itself is loaded an extra resident
    // must not demote the ready state.
    const modelMismatch =
      hasActive &&
      !isModelReady &&
      !isModelLoading &&
      actualLoadedModel !== null &&
      !llmModelKeysMatch(actualLoadedModel, active);
    const isSettledNotLoaded =
      hasActive &&
      !isModelReady &&
      !isModelLoading &&
      !loadFailed &&
      !isServerUnreachable &&
      !modelMismatch;
    return {
      hasActiveModel: hasActive,
      isModelLoading,
      isModelReady,
      loadFailed,
      loadError,
      isServerUnreachable,
      modelMismatch,
      actualLoadedModel,
      isSettledNotLoaded,
    };
  }, [llmStatus]);
}
