// @vitest-environment jsdom
// packages/ui/src/hooks/useVerificationStream.test.ts
//
// Regression coverage for the verification SSE hook's phase tracking and
// reconnect semantics:
//
//   - `phase` events update the live phase (message/attempt/elapsed) while
//     `processed_messages` stays flat during generation.
//   - The durable snapshot columns seed the phase after a reload (no SSE
//     events received yet).
//   - Retry-phase updates (attempt 2) replace the generating phase.
//   - A dropped socket without a terminal event raises `connectionLost`
//     (not a Judge `streamError`) and invalidates the dashboard queries
//     so the existing polling/refetch path reconciles the outcome.
//   - Terminal events clear the phase and fire `onTerminal` once.
//   - Dashboard queries invalidate only on `message_verified` (new
//     persisted data) — never on high-frequency `progress`/`phase`
//     telemetry ticks.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVerificationStream } from './useVerificationStream';
import type { VerificationJob } from '../api/verification';

const ACTIVE_JOB: VerificationJob = {
  id: 7,
  status: 'processing',
  scope: 'all_unverified',
  session_ids_json: null,
  chat_id: null,
  skip_verified: true,
  total_messages: 1,
  processed_messages: 0,
  succeeded_messages: 0,
  failed_messages: 0,
  skipped_messages: 0,
  current_phase: 'generating',
  current_message_id: 1914,
  current_attempt: 1,
  phase_updated_at: Date.now(),
  total_statements: 0,
  flagged_statements: 0,
  omissions_count: 0,
  created_at: Date.now() - 60_000,
  completed_at: null,
  error_message: null,
  model_name: 'e2e-judge-model',
  context_size: 32768,
  thinking_budget: null,
  temperature: 0.2,
  top_p: 0.9,
  repeat_penalty: 1.1,
  num_gpu_layers: null,
  llm_base_url: null,
};

interface FakeEventSourceInstance {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  readyState: number;
  close: () => void;
  emit: (data: unknown) => void;
  fail: () => void;
}

const esInstances: FakeEventSourceInstance[] = [];

class FakeEventSource implements FakeEventSourceInstance {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readyState = 1;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  constructor(public url: string) {
    esInstances.push(this);
  }
  close() {
    this.readyState = 2;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  fail() {
    this.readyState = 2;
    this.onerror?.({});
  }
}

vi.stubGlobal('EventSource', FakeEventSource);

const lastInstance = () => esInstances[esInstances.length - 1];

function renderStream(jobId: number | null, options?: { enabled?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const onTerminal = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useVerificationStream(jobId, { ...options, onTerminal }),
    { wrapper }
  );
  return { hook, queryClient, invalidateSpy, onTerminal };
}

beforeEach(() => {
  esInstances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('EventSource', FakeEventSource);
});

describe('useVerificationStream phases', () => {
  it('seeds the live phase from the snapshot columns before any SSE event', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });

    expect(hook.result.current.job?.id).toBe(7);
    // Reload case: the banner shows the durable phase immediately.
    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      messageId: 1914,
      attempt: 1,
    });
    expect(hook.result.current.job?.processed_messages).toBe(0);
  });

  it('propagates the message preview from snapshots and phase events', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({
        type: 'snapshot',
        job: { ...ACTIVE_JOB, current_message_preview: 'Snapshot preview' },
      });
    });
    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      messagePreview: 'Snapshot preview',
    });

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'generating',
        message: 'Generating assessment (1 of 1): "Live preview"…',
        processedMessages: 0,
        messageId: 1914,
        messageIndex: 1,
        attempt: 1,
        messagePreview: 'Live preview',
      });
    });
    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      messagePreview: 'Live preview',
    });
    // The local job snapshot mirrors the preview for reload consistency.
    expect(hook.result.current.job?.current_message_preview).toBe(
      'Live preview'
    );
  });

  it('updates the live phase on phase events without incrementing processed', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({
        type: 'snapshot',
        job: { ...ACTIVE_JOB, current_phase: null },
      });
    });
    expect(hook.result.current.phase).toBeNull();

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'generating',
        message: 'Generating assessment for message 1914 (attempt 1)…',
        totalMessages: 1,
        processedMessages: 0,
        succeededMessages: 0,
        failedMessages: 0,
        messageId: 1914,
        messageIndex: 1,
        attempt: 1,
        elapsedMs: 4200,
      });
    });

    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      messageId: 1914,
      messageIndex: 1,
      attempt: 1,
      elapsedMs: 4200,
    });
    // Processed stays flat: the phase indicator (not the counter) shows
    // activity during generation.
    expect(hook.result.current.job?.processed_messages).toBe(0);
    expect(hook.result.current.job?.current_phase).toBe('generating');
  });

  it('replaces the generating phase with the retrying phase on attempt 2', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'retrying',
        message: 'Retrying message #1914 (attempt 2)…',
        processedMessages: 0,
        messageId: 1914,
        messageIndex: 1,
        attempt: 2,
      });
    });

    expect(hook.result.current.phase).toMatchObject({
      phase: 'retrying',
      attempt: 2,
    });
    expect(hook.result.current.phase?.message).toContain('Retrying message');
  });

  it('merges outcome counts and clears the phase on terminal events', () => {
    const { hook, onTerminal } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    expect(hook.result.current.phase).not.toBeNull();

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'complete',
        status: 'completed',
        message: 'Completed with errors: 0 of 1 checked, 1 failed',
        totalMessages: 1,
        processedMessages: 1,
        succeededMessages: 0,
        failedMessages: 1,
        skippedMessages: 0,
      });
    });

    expect(hook.result.current.job?.status).toBe('completed');
    expect(hook.result.current.job?.failed_messages).toBe(1);
    expect(hook.result.current.job?.error_message).toContain(
      'Completed with errors'
    );
    expect(hook.result.current.phase).toBeNull();
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith('completed');
  });
});

describe('useVerificationStream token speed', () => {
  it('tracks live tokens/s from generating ticks and clears it on non-generating phases', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    expect(hook.result.current.phase).toMatchObject({
      tokensPerSecond: null,
      generatedTokens: null,
    });

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'generating',
        message: 'Generating assessment for message 1914 (attempt 1)…',
        messageId: 1914,
        messageIndex: 1,
        attempt: 1,
        tokensPerSecond: 42.5,
        generatedTokens: 85,
      });
    });
    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      tokensPerSecond: 42.5,
      generatedTokens: 85,
    });

    // A non-generating transition without speed values clears the stale
    // indicator while keeping the new phase detail.
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'finishing',
        message: 'Finishing audit…',
      });
    });
    expect(hook.result.current.phase).toMatchObject({
      phase: 'finishing',
      tokensPerSecond: null,
      generatedTokens: null,
    });
  });

  it('clears lingering speed on message_verified without dropping the phase', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'generating',
        message: 'Generating assessment for message 1914 (attempt 1)…',
        messageId: 1914,
        messageIndex: 1,
        attempt: 1,
        tokensPerSecond: 38.2,
        generatedTokens: 60,
      });
    });
    expect(hook.result.current.phase?.tokensPerSecond).toBe(38.2);

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'message_verified',
        messageId: 1914,
        tokensPerSecond: null,
        generatedTokens: null,
      });
    });
    expect(hook.result.current.phase).toMatchObject({
      phase: 'generating',
      tokensPerSecond: null,
      generatedTokens: null,
    });
  });
});

describe('useVerificationStream dashboard invalidation', () => {
  it('invalidates only when a message verifies — not on progress/phase ticks', () => {
    const { invalidateSpy } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    invalidateSpy.mockClear();

    // Token-speed telemetry ticks (~3/sec during generation) and
    // progress counters merge into local banner state; they persist
    // nothing, so they must not refetch the dashboard queries (that
    // storm made the Issues Feed "refreshing…" indicator strobe).
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'phase',
        phase: 'generating',
        message: 'Generating assessment (attempt 1)…',
        messageId: 1914,
        messageIndex: 1,
        attempt: 1,
        tokensPerSecond: 38.2,
        generatedTokens: 60,
      });
    });
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'progress',
        totalMessages: 1,
        processedMessages: 0,
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // A verified message persists new statements: now refetch.
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'message_verified',
        messageId: 1914,
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['verificationStatements'],
    });
  });
});

describe('useVerificationStream reconnect semantics', () => {
  it('flags connection trouble (not a Judge failure) and refetches when the socket drops', () => {
    const { hook, invalidateSpy } = renderStream(7);
    act(() => {
      lastInstance().onopen?.({});
    });
    expect(hook.result.current.isConnected).toBe(true);
    invalidateSpy.mockClear();

    // The socket dies mid-run with no terminal event (missed terminal):
    // connectionLost rises, streamError stays null, and the dashboard
    // queries invalidate so polling reconciles the outcome.
    act(() => {
      lastInstance().fail();
    });

    expect(hook.result.current.connectionLost).toBe(true);
    expect(hook.result.current.streamError).toBeNull();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('clears the connection flag when live events resume', () => {
    const { hook } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    act(() => {
      lastInstance().fail();
    });
    expect(hook.result.current.connectionLost).toBe(true);

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'progress',
        totalMessages: 1,
        processedMessages: 0,
      });
    });
    expect(hook.result.current.connectionLost).toBe(false);
  });

  it('keeps Judge failures in streamError without raising connectionLost', () => {
    const { hook, onTerminal } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });

    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'error',
        status: 'failed',
        message: 'All 1 attempted assessment failed (job 7).',
        failedMessages: 1,
      });
    });

    expect(hook.result.current.streamError).toContain(
      'All 1 attempted assessment failed'
    );
    expect(hook.result.current.connectionLost).toBe(false);
    expect(onTerminal).toHaveBeenCalledWith('failed');
  });

  it('does not raise a connection alarm for post-terminal socket errors', () => {
    const { hook, invalidateSpy } = renderStream(7);
    act(() => {
      lastInstance().emit({ type: 'snapshot', job: ACTIVE_JOB });
    });
    act(() => {
      lastInstance().emit({
        jobId: 7,
        timestamp: Date.now(),
        type: 'complete',
        status: 'completed',
        totalMessages: 1,
        processedMessages: 1,
      });
    });
    invalidateSpy.mockClear();

    // The closing socket fires onerror after the terminal event.
    act(() => {
      lastInstance().fail();
    });

    expect(hook.result.current.connectionLost).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
