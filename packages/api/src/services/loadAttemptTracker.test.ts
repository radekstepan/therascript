// @vitest-environment node
// packages/api/src/services/loadAttemptTracker.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markLoadStarted,
  markLoadSucceeded,
  markLoadFailed,
  getLastLoadAttempt,
  __resetForTests,
} from './loadAttemptTracker.js';

describe('loadAttemptTracker', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('starts idle with no model, error, or timestamp', () => {
    expect(getLastLoadAttempt()).toEqual({
      status: 'idle',
      modelName: null,
      error: null,
      attemptedAt: null,
    });
  });

  it('records an in-progress attempt on start', () => {
    markLoadStarted('qwen3.5-2b');
    const state = getLastLoadAttempt();
    expect(state.status).toBe('loading');
    expect(state.modelName).toBe('qwen3.5-2b');
    expect(state.error).toBeNull();
    expect(state.attemptedAt).toEqual(expect.any(String));
  });

  it('resets to idle on success', () => {
    markLoadStarted('qwen3.5-2b');
    markLoadSucceeded();
    expect(getLastLoadAttempt()).toEqual({
      status: 'idle',
      modelName: null,
      error: null,
      attemptedAt: null,
    });
  });

  it('records the failure reason on failure', () => {
    markLoadStarted('qwen3.5-2b');
    markLoadFailed('qwen3.5-2b', 'No LM Runtime found!');
    const state = getLastLoadAttempt();
    expect(state.status).toBe('failed');
    expect(state.modelName).toBe('qwen3.5-2b');
    expect(state.error).toBe('No LM Runtime found!');
    expect(state.attemptedAt).toEqual(expect.any(String));
  });

  it('overwrites a stale failure when a new attempt starts', () => {
    markLoadStarted('model-a');
    markLoadFailed('model-a', 'boom');
    markLoadStarted('model-b');
    const state = getLastLoadAttempt();
    expect(state.status).toBe('loading');
    expect(state.modelName).toBe('model-b');
    expect(state.error).toBeNull();
  });

  it('returns a copy so callers cannot mutate stored state', () => {
    markLoadStarted('qwen3.5-2b');
    const snapshot = getLastLoadAttempt();
    snapshot.status = 'failed';
    snapshot.error = 'tampered';
    expect(getLastLoadAttempt().status).toBe('loading');
    expect(getLastLoadAttempt().error).toBeNull();
  });
});
