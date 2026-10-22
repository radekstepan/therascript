// packages/api/src/api/verificationHandler.test.ts
//
// Task-4 coverage for the verification job lifecycle guards:
//
//   - createVerificationJobHandler refuses (409 Conflict) while another
//     verification job is pending/processing/canceling.
//   - Creating a job snapshots the Judge config into the job row but never
//     mutates the user's global chat model (no setActiveModelAndContextAndParams
//     / unloadModelAtUrl side effects) — the worker loads/unloads around the
//     job itself.
//   - resetVerificationsHandler consults hasActiveVerificationJobs() (not a
//     capped findAllVerificationJobs(50) scan) and refuses with 409 while a
//     job is active.
//
// Reference: packages/api/src/api/verificationHandler.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError } from '../errors.js';

const {
  mockVerificationRepo,
  mockSessionRepo,
  mockChatRepo,
  mockMessageRepo,
  mockAddVerificationJob,
  mockCancelVerificationJobFromQueue,
  mockGetConfiguredTopP,
  mockGetConfiguredRepeatPenalty,
  mockGetConfiguredNumGpuLayers,
  mockGetConfiguredThinkingBudget,
  mockGetActiveBaseUrl,
  mockGetActiveModel,
  mockGetConfiguredContextSize,
  mockSetActiveModelAndContextAndParams,
  mockUnloadModelAtUrl,
  mockSubscribeToVerificationStream,
  mockStreamUnsubscribe,
} = vi.hoisted(() => ({
  mockVerificationRepo: {
    hasActiveVerificationJobs: vi.fn(),
    createVerificationJob: vi.fn(),
    findAllVerificationJobs: vi.fn(),
    findVerificationJobById: vi.fn(),
    resetAllVerifications: vi.fn(),
  },
  mockSessionRepo: { findById: vi.fn() },
  mockChatRepo: { findChatById: vi.fn() },
  mockMessageRepo: { findMessageById: vi.fn() },
  mockAddVerificationJob: vi.fn(),
  mockCancelVerificationJobFromQueue: vi.fn(),
  mockGetConfiguredTopP: vi.fn(),
  mockGetConfiguredRepeatPenalty: vi.fn(),
  mockGetConfiguredNumGpuLayers: vi.fn(),
  mockGetConfiguredThinkingBudget: vi.fn(),
  mockGetActiveBaseUrl: vi.fn(),
  mockGetActiveModel: vi.fn(),
  mockGetConfiguredContextSize: vi.fn(),
  mockSetActiveModelAndContextAndParams: vi.fn(),
  mockUnloadModelAtUrl: vi.fn(),
  mockSubscribeToVerificationStream: vi.fn(),
  mockStreamUnsubscribe: vi.fn(),
}));

vi.mock('@therascript/data', () => ({
  verificationRepository: mockVerificationRepo,
  sessionRepository: mockSessionRepo,
  chatRepository: mockChatRepo,
  messageRepository: mockMessageRepo,
}));

vi.mock('../services/jobQueueService.js', () => ({
  addVerificationJob: (...args: unknown[]) => mockAddVerificationJob(...args),
  cancelVerificationJobFromQueue: (...args: unknown[]) =>
    mockCancelVerificationJobFromQueue(...args),
}));

vi.mock('../services/streamSubscriber.js', () => ({
  subscribeToVerificationStream: (...args: unknown[]) =>
    mockSubscribeToVerificationStream(...args),
}));

vi.mock('../services/activeModelService.js', () => ({
  getConfiguredTopP: (...args: unknown[]) => mockGetConfiguredTopP(...args),
  getConfiguredRepeatPenalty: (...args: unknown[]) =>
    mockGetConfiguredRepeatPenalty(...args),
  getConfiguredNumGpuLayers: (...args: unknown[]) =>
    mockGetConfiguredNumGpuLayers(...args),
  getConfiguredThinkingBudget: (...args: unknown[]) =>
    mockGetConfiguredThinkingBudget(...args),
  getActiveBaseUrl: (...args: unknown[]) => mockGetActiveBaseUrl(...args),
  getActiveModel: (...args: unknown[]) => mockGetActiveModel(...args),
  getConfiguredContextSize: (...args: unknown[]) =>
    mockGetConfiguredContextSize(...args),
  setActiveModelAndContextAndParams: (...args: unknown[]) =>
    mockSetActiveModelAndContextAndParams(...args),
}));

vi.mock('../services/llamaCppService.js', () => ({
  unloadModelAtUrl: (...args: unknown[]) => mockUnloadModelAtUrl(...args),
}));

const {
  createVerificationJobHandler,
  createVerificationJobRecord,
  resetVerificationsHandler,
  streamVerificationJobHandler,
} = await import('./verificationHandler.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetConfiguredTopP.mockReturnValue(0.9);
  mockGetConfiguredRepeatPenalty.mockReturnValue(1.1);
  mockGetConfiguredNumGpuLayers.mockReturnValue(null);
  mockGetConfiguredThinkingBudget.mockReturnValue(1024);
  mockGetActiveBaseUrl.mockReturnValue('http://localhost:1234/v1');
  mockGetActiveModel.mockReturnValue('chat-model');
  mockGetConfiguredContextSize.mockReturnValue(8192);
});

describe('createVerificationJobHandler concurrent-job guard', () => {
  it('returns 409 Conflict without creating a job when one is already active', async () => {
    mockVerificationRepo.hasActiveVerificationJobs.mockReturnValue(true);
    const set: { status?: number | string } = {};

    const failure = await createVerificationJobHandler({
      body: { scope: 'all_unverified' },
      set,
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).status).toBe(409);
    expect((failure as ConflictError).message).toMatch(
      /already in progress.*wait for it to finish or cancel it/i
    );
    expect(
      mockVerificationRepo.hasActiveVerificationJobs
    ).toHaveBeenCalledTimes(1);
    expect(mockVerificationRepo.createVerificationJob).not.toHaveBeenCalled();
    expect(mockAddVerificationJob).not.toHaveBeenCalled();
  });

  it('does not mutate global active chat model settings on success', async () => {
    mockVerificationRepo.hasActiveVerificationJobs.mockReturnValue(false);
    mockVerificationRepo.createVerificationJob.mockReturnValue({ id: 9 });
    mockAddVerificationJob.mockResolvedValue({});
    const set: { status?: number | string } = {};

    const result = await createVerificationJobHandler({
      body: { scope: 'all_unverified' },
      set,
    });

    expect(result).toEqual({ jobId: 9 });
    expect(set.status).toBe(202);
    // The Judge config is snapshotted into the job row (deterministic 0.3
    // default) ...
    expect(mockVerificationRepo.createVerificationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'all_unverified',
        modelName: 'chat-model',
        temperature: 0.3,
      })
    );
    expect(mockAddVerificationJob).toHaveBeenCalledWith({ jobId: 9 });
    // ... but the user's global chat model is left untouched: no model
    // switch and no unload that could rip a model out from under an
    // active chat stream.
    expect(mockSetActiveModelAndContextAndParams).not.toHaveBeenCalled();
    expect(mockUnloadModelAtUrl).not.toHaveBeenCalled();
  });

  it('still rejects invalid scopes with 400 before checking for active jobs', async () => {
    const set: { status?: number | string } = {};

    const failure = await createVerificationJobRecord({
      scope: 'bogus-scope' as never,
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect((failure as { status?: number }).status).toBe(400);
    expect(
      mockVerificationRepo.hasActiveVerificationJobs
    ).not.toHaveBeenCalled();
  });
});

describe('resetVerificationsHandler active-job guard', () => {
  it('uses hasActiveVerificationJobs() and returns 409 when a job is active', () => {
    mockVerificationRepo.hasActiveVerificationJobs.mockReturnValue(true);
    const set: { status?: number | string } = {};

    let failure: unknown = null;
    try {
      resetVerificationsHandler({ params: {}, set });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).status).toBe(409);
    expect((failure as ConflictError).message).toMatch(
      /while a verification job is in progress/i
    );
    expect(mockVerificationRepo.hasActiveVerificationJobs).toHaveBeenCalled();
    // The capped 50-row scan must not be used (it misses jobs past the
    // limit and wastes query overhead).
    expect(mockVerificationRepo.findAllVerificationJobs).not.toHaveBeenCalled();
    expect(mockVerificationRepo.resetAllVerifications).not.toHaveBeenCalled();
  });

  it('resets and reports the deleted count when no job is active', () => {
    mockVerificationRepo.hasActiveVerificationJobs.mockReturnValue(false);
    mockVerificationRepo.resetAllVerifications.mockReturnValue({
      deletedVerifications: 3,
      deletedStatements: 12,
      deletedJobs: 1,
    });
    const set: { status?: number | string } = {};

    const result = resetVerificationsHandler({ params: {}, set });

    expect(set.status).toBe(200);
    expect(result).toEqual({
      message: 'All verifications cleared (3 message(s)).',
      deletedVerifications: 3,
    });
  });
});

describe('streamVerificationJobHandler terminal-event delivery', () => {
  type StreamCallback = (event: Record<string, unknown>) => void;

  const RUNNING_JOB = { id: 7, status: 'processing' };

  /** Read every SSE `data:` frame from a single response through EOF. */
  const readSseEvents = async (
    res: Response
  ): Promise<Record<string, unknown>[]> => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: Record<string, unknown>[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            events.push(JSON.parse(trimmed.slice('data:'.length).trim()));
          }
        }
      }
    }
    return events;
  };

  /** Subscribe to a running job and return the captured Redis callback. */
  const subscribeToRunningJob = (): {
    res: Response;
    emit: StreamCallback;
  } => {
    mockVerificationRepo.findVerificationJobById.mockReturnValue(RUNNING_JOB);
    mockSubscribeToVerificationStream.mockReturnValue(mockStreamUnsubscribe);
    const res = streamVerificationJobHandler({
      params: { jobId: 7 },
      set: {},
    });
    expect(res.status).toBe(200);
    const emit = mockSubscribeToVerificationStream.mock.calls[0][1];
    return { res, emit };
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([
    {
      name: 'completed',
      terminal: {
        jobId: 7,
        timestamp: 1,
        type: 'complete',
        status: 'completed',
      },
    },
    {
      name: 'failed',
      terminal: {
        jobId: 7,
        timestamp: 2,
        type: 'error',
        status: 'failed',
        message: 'judge exploded',
      },
    },
    {
      name: 'canceled',
      terminal: {
        jobId: 7,
        timestamp: 3,
        type: 'status',
        status: 'canceled',
        message: 'canceled by user',
      },
    },
  ])(
    'delivers the $name terminal event exactly once with queued progress retained',
    async ({ terminal }) => {
      const { res, emit } = subscribeToRunningJob();
      const progress1 = {
        jobId: 7,
        timestamp: 10,
        type: 'progress',
        processedMessages: 1,
        totalMessages: 3,
      };
      const progress2 = {
        jobId: 7,
        timestamp: 11,
        type: 'message_verified',
        messageId: 42,
      };

      // Queue progress and then the terminal event back-to-back on the
      // same tick, as a burst of Redis messages would arrive.
      emit(progress1);
      emit(progress2);
      emit(terminal);

      // A single stream read through EOF must observe everything —
      // no reconnect for a terminal snapshot.
      const events = await readSseEvents(res);

      expect(events).toEqual([
        { type: 'snapshot', job: RUNNING_JOB },
        progress1,
        progress2,
        terminal,
      ]);
      expect(events.filter((e) => e.type === terminal.type)).toHaveLength(1);
      expect(mockStreamUnsubscribe).toHaveBeenCalledTimes(1);
    }
  );

  it('closes idempotently when terminal events repeat', async () => {
    const { res, emit } = subscribeToRunningJob();
    const terminal = {
      jobId: 7,
      timestamp: 1,
      type: 'complete',
      status: 'completed',
    };

    emit(terminal);
    // A duplicate terminal delivery (or a status echo after complete)
    // must not throw, re-enqueue, or re-unsubscribe.
    emit({ ...terminal, timestamp: 2 });
    emit({ jobId: 7, timestamp: 3, type: 'status', status: 'completed' });

    const events = await readSseEvents(res);

    expect(events).toEqual([{ type: 'snapshot', job: RUNNING_JOB }, terminal]);
    expect(mockStreamUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the stream open for non-terminal events and unsubscribes on disconnect', async () => {
    const { res, emit } = subscribeToRunningJob();
    const progress = {
      jobId: 7,
      timestamp: 10,
      type: 'progress',
      processedMessages: 1,
      totalMessages: 3,
    };
    emit(progress);

    // Give deferred enqueues a chance to run: the stream must still
    // be open (no close, no unsubscribe) for non-terminal events.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockStreamUnsubscribe).not.toHaveBeenCalled();

    // Client disconnect cancels the stream and releases the subscription.
    await res.body!.cancel();
    expect(mockStreamUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sends the snapshot and closes for an already-terminal job', async () => {
    const job = { id: 9, status: 'completed' };
    mockVerificationRepo.findVerificationJobById.mockReturnValue(job);

    const res = streamVerificationJobHandler({
      params: { jobId: 9 },
      set: {},
    });

    expect(await readSseEvents(res)).toEqual([{ type: 'snapshot', job }]);
    expect(mockSubscribeToVerificationStream).not.toHaveBeenCalled();
  });

  it('returns 404 without subscribing when the job does not exist', () => {
    mockVerificationRepo.findVerificationJobById.mockReturnValue(null);
    const set: { status?: number | string } = {};

    const res = streamVerificationJobHandler({
      params: { jobId: 123 },
      set,
    });

    expect(res.status).toBe(404);
    expect(set.status).toBe(404);
    expect(mockSubscribeToVerificationStream).not.toHaveBeenCalled();
  });
});
