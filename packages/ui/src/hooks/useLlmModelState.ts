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
    return {
      hasActiveModel: hasActive,
      isModelLoading,
      isModelReady,
      loadFailed,
      loadError,
    };
  }, [llmStatus]);
}
