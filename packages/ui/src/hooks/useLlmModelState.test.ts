// packages/ui/src/hooks/useLlmModelState.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLlmModelState } from './useLlmModelState';
import type { LlmStatus, LlmLoadState } from '../types';

const idleLoadState: LlmLoadState = {
  status: 'idle',
  modelName: null,
  error: null,
  attemptedAt: null,
};

function makeStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    activeModel: 'qwen3.5-2b',
    modelChecked: 'qwen3.5-2b',
    loaded: false,
    loadState: { ...idleLoadState },
    ...overrides,
  };
}

describe('useLlmModelState', () => {
  it('reports no model when status is undefined', () => {
    const { result } = renderHook(() => useLlmModelState(undefined));
    expect(result.current).toEqual({
      hasActiveModel: false,
      isModelLoading: false,
      isModelReady: false,
      loadFailed: false,
      loadError: null,
      isServerUnreachable: false,
      modelMismatch: false,
      actualLoadedModel: null,
      isSettledNotLoaded: false,
    });
  });

  it('reports ready when the active model is loaded', () => {
    const { result } = renderHook(() =>
      useLlmModelState(makeStatus({ loaded: true }))
    );
    expect(result.current.isModelReady).toBe(true);
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.loadFailed).toBe(false);
  });

  it('reports loading (not failed) while a load is in flight', () => {
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          loadState: {
            status: 'loading',
            modelName: 'qwen3.5-2b',
            error: null,
            attemptedAt: '2026-10-18T21:14:09.000Z',
          },
        })
      )
    );
    expect(result.current.isModelLoading).toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('reports failure with the reason and stops loading when the active model load failed', () => {
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          loadState: {
            status: 'failed',
            modelName: 'qwen3.5-2b',
            error: "No LM Runtime found for model format 'gguf'!",
            attemptedAt: '2026-10-18T21:14:09.000Z',
          },
        })
      )
    );
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadError).toBe(
      "No LM Runtime found for model format 'gguf'!"
    );
    // Terminal, not in-progress: callers must render the error, not spin.
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelReady).toBe(false);
  });

  it('ignores a failure recorded for a different model', () => {
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          loadState: {
            status: 'failed',
            modelName: 'some-other-model',
            error: 'boom',
            attemptedAt: '2026-10-18T21:14:09.000Z',
          },
        })
      )
    );
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadError).toBeNull();
    expect(result.current.isModelLoading).toBe(true);
  });

  it('reports settled (not loading) when explicitly idle with nothing loaded', () => {
    // Post-unload state: the backend reports loaded=false and an idle
    // tracker. This must render the plain "not loaded" state — a
    // spinner here would spin forever with nothing in flight.
    const { result } = renderHook(() => useLlmModelState(makeStatus()));
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.loadFailed).toBe(false);
  });

  it('treats a missing loadState as no known failure (stale responses)', () => {
    const status = makeStatus();
    delete status.loadState;
    const { result } = renderHook(() => useLlmModelState(status));
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.isModelLoading).toBe(true);
  });

  it('reports settled-not-loaded (never a spinner, never ready) after an unload', () => {
    // Post-unload production shape: configured name stays, loaded is
    // false, tracker idle. Headers must render an explicit
    // "Not loaded" state from this — not the calm loaded display.
    const { result } = renderHook(() =>
      useLlmModelState(makeStatus({ actualLoadedModel: null }))
    );
    expect(result.current.hasActiveModel).toBe(true);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.modelMismatch).toBe(false);
    expect(result.current.isSettledNotLoaded).toBe(true);
  });

  it('reports unreachable when the server does not respond', () => {
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          status: 'unavailable',
          serverReachable: false,
          actualLoadedModel: null,
        })
      )
    );
    expect(result.current.isServerUnreachable).toBe(true);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isSettledNotLoaded).toBe(false);
  });

  it('assumes reachable when reachability fields are missing (stale responses)', () => {
    const status = makeStatus();
    delete status.serverReachable;
    delete status.status;
    const { result } = renderHook(() => useLlmModelState(status));
    expect(result.current.isServerUnreachable).toBe(false);
  });

  it('reports a mismatch when the server holds a different model', () => {
    const { result } = renderHook(() =>
      useLlmModelState(makeStatus({ actualLoadedModel: 'someone-elses-model' }))
    );
    expect(result.current.modelMismatch).toBe(true);
    expect(result.current.actualLoadedModel).toBe('someone-elses-model');
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isSettledNotLoaded).toBe(false);
  });

  it('does not report a mismatch while a load is in flight', () => {
    // During a load the server legitimately still holds the old model.
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          actualLoadedModel: 'old-model',
          loadState: {
            status: 'loading',
            modelName: 'qwen3.5-2b',
            error: null,
            attemptedAt: '2026-10-18T21:14:09.000Z',
          },
        })
      )
    );
    expect(result.current.isModelLoading).toBe(true);
    expect(result.current.modelMismatch).toBe(false);
  });

  it('does not report a mismatch when the configured model itself is loaded', () => {
    // An extra out-of-band resident must not demote the ready state.
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({ loaded: true, actualLoadedModel: 'extra-resident' })
      )
    );
    expect(result.current.isModelReady).toBe(true);
    expect(result.current.modelMismatch).toBe(false);
  });

  it('treats publisher-prefixed keys as the same model', () => {
    // The backend matches `publisher/key` against bare `key`; the
    // mismatch detector must not false-positive on the same pair.
    const { result } = renderHook(() =>
      useLlmModelState(
        makeStatus({
          activeModel: 'qwen/qwen3.5-2b',
          modelChecked: 'qwen/qwen3.5-2b',
          actualLoadedModel: 'qwen3.5-2b',
        })
      )
    );
    expect(result.current.modelMismatch).toBe(false);
    expect(result.current.isSettledNotLoaded).toBe(true);
  });
});
