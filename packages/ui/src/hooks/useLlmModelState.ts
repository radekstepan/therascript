// packages/ui/src/hooks/useLlmModelState.ts
import { useMemo } from 'react';
import type { LlmStatus } from '../types';

export interface LlmModelState {
  hasActiveModel: boolean;
  isModelLoading: boolean;
  isModelReady: boolean;
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
    const isModelLoading = hasActive && (!loaded || checked !== active);
    return {
      hasActiveModel: hasActive,
      isModelLoading,
      isModelReady,
    };
  }, [llmStatus]);
}
