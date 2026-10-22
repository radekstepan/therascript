// @vitest-environment jsdom
// packages/ui/src/components/Verification/VerificationAuditPage.modelDiscovery.test.tsx
//
// Task 6 regression: viewing or running a verification audit must never
// start LLM model-list discovery from hidden controls. The audit page
// mounts the Start dialog closed; its Judge-model picker lives inside
// Radix Dialog content (unmounted while closed) with its
// `availableLlmModels` query gated on `enabled={isOpen}`. Polling the
// jobs/stats endpoints, receiving SSE progress updates, switching the
// Issues/Coverage/History tabs, or refocusing the window must not fetch
// `/api/llm/available-models` while the dialog is closed — and closing
// the dialog must stop any further discovery. Only opening the dialog
// (mount) or changing its endpoint (queryKey) fetches, plus the picker's
// explicit error-Retry.
//
// The QueryClient here deliberately opts INTO `refetchOnWindowFocus`
// (the opposite of the app's global default) so the window-focus step
// genuinely exercises TanStack's focus-refetch path: the test asserts
// the audit's own jobs/stats queries DO refire on focus (necessary
// requests keep working) while the model-list count stays put. Focus
// is simulated with `visibilitychange`, which is the only event
// TanStack v5's focus manager subscribes to — a bare `focus` event
// would be vacuous.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { VerificationAuditPage } from './VerificationAuditPage';
import { fetchAvailableModels, fetchLlmStatus } from '../../api/api';
import {
  fetchVerificationJobs,
  fetchVerificationStats,
} from '../../api/verification';
import type {
  VerificationGlobalStats,
  VerificationJob,
} from '../../api/verification';

const { ACTIVE_JOB, STATS } = vi.hoisted(() => {
  const job: VerificationJob = {
    id: 7,
    status: 'processing',
    scope: 'all_unverified',
    session_ids_json: null,
    chat_id: null,
    skip_verified: true,
    total_messages: 10,
    processed_messages: 4,
    total_statements: 20,
    flagged_statements: 1,
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
  const stats: VerificationGlobalStats = {
    totalMessagesAudited: 4,
    overallAccuracyPercent: 87.5,
    totalClaims: 8,
    supportedClaims: 7,
    partialClaims: 0,
    contradictedClaims: 1,
    fabricatedClaims: 0,
    omissions: 0,
    unverifiedMessagesCount: 2,
    failedMessagesCount: 3,
    byModel: [],
    overTime: [],
    sessionsSummary: [],
  };
  return { ACTIVE_JOB: job, STATS: stats };
});

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchVerificationJobs: vi.fn().mockResolvedValue([]),
    fetchVerificationStats: vi.fn().mockResolvedValue(STATS),
    fetchFlaggedStatements: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    cancelVerificationJob: vi.fn(),
    resetVerifications: vi.fn(),
    createVerificationJob: vi.fn(),
  };
});

// NOTE: the real LlmEndpointModelPicker is used here (not mocked away
// as in VerificationAuditPage.test.tsx) so model discovery is genuinely
// exercised through the Start dialog.
vi.mock('../../api/api', () => ({
  createVerificationJob: vi.fn(),
  fetchLlmStatus: vi.fn().mockResolvedValue({
    activeModel: 'judge-model',
    modelChecked: 'judge-model',
    loaded: true,
    details: null,
    configuredContextSize: 32768,
    configuredTopP: 0.9,
    configuredRepeatPenalty: 1.1,
    configuredNumGpuLayers: null,
    configuredThinkingBudget: 1024,
    activeBaseUrl: 'http://localhost:1234',
    defaultBaseUrl: 'http://localhost:1234',
    isRemoteBaseUrl: false,
    hasRemoteApiToken: false,
  }),
  setLlmApiToken: vi.fn().mockResolvedValue({ message: 'ok' }),
  fetchAvailableModels: vi.fn().mockResolvedValue({ models: [] }),
  fetchGpuStats: vi.fn().mockResolvedValue({
    available: false,
    gpus: [],
    systemMemory: { totalMb: 0, usedMb: 0, freeMb: 0, percentUsed: 0 },
    summary: {
      gpuCount: 0,
      totalMemoryMb: 0,
      totalMemoryUsedMb: 0,
      isUnifiedMemory: false,
    },
  }),
  estimateModelVram: vi.fn().mockResolvedValue({
    model: 'mock',
    context_size: null,
    estimated_vram_bytes: null,
    estimated_ram_bytes: null,
    vram_per_token_bytes: null,
  }),
  unloadLlmModel: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

// Controllable EventSource fake for the real useVerificationStream hook.
const esInstances: Array<{
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  emit: (data: unknown) => void;
}> = [];
class FakeEventSource {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
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
}
vi.stubGlobal('EventSource', FakeEventSource);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Hostile focus default (opposite of the app): opted-in queries
      // MUST refire on `visibilitychange`, so the audit queries prove
      // the focus path works while model discovery must stay silent.
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: true },
    },
  });
  return {
    queryClient,
    ...render(
      <JotaiProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Theme>
              <VerificationAuditPage />
            </Theme>
          </MemoryRouter>
        </QueryClientProvider>
      </JotaiProvider>
    ),
  };
}

const modelCalls = () => vi.mocked(fetchAvailableModels).mock.calls.length;
const jobsCalls = () => vi.mocked(fetchVerificationJobs).mock.calls.length;
const statsCalls = () => vi.mocked(fetchVerificationStats).mock.calls.length;

/**
 * Simulate the window losing and regaining focus. TanStack v5 only
 * listens for `visibilitychange` (on `window`) and consults
 * `document.visibilityState`, so both are driven explicitly and the
 * override is restored afterwards.
 */
async function fireWindowBlurAndRefocus() {
  const doc = document as Document & {
    visibilityState: DocumentVisibilityState;
  };
  const hadOwn = Object.prototype.hasOwnProperty.call(doc, 'visibilityState');
  try {
    Object.defineProperty(doc, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(doc, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
  } finally {
    if (!hadOwn) {
      delete (doc as unknown as Record<string, unknown>).visibilityState;
    }
  }
  await flushAsyncQueries();
}

/**
 * Flush TanStack v5 observer notifications. The notify manager batches
 * through `setTimeout(0)`, so under fake timers every promise-driven
 * query update needs an explicit advance before React sees it. Run
 * twice: the first advance fires notifies scheduled so far, the second
 * catches updates chained off those notifies. Fake-timers only.
 */
async function flushAsyncQueries() {
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

/** Advance the clock past poll intervals, then flush notifications. */
async function advancePolling(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsyncQueries();
}

async function emitSseProgress() {
  await act(async () => {
    for (const es of esInstances) {
      es.onopen?.({});
      es.emit({ type: 'progress', processedMessages: 5 });
      es.emit({ type: 'message_verified', processedMessages: 6 });
    }
  });
  await flushAsyncQueries();
}

describe('VerificationAuditPage model discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esInstances.length = 0;
  });

  it('fetches model lists only while the audit dialog is open', async () => {
    const { queryClient } = renderPage();
    await screen.findByRole('heading', { name: 'Fact Check' });

    // Dialog closed, no audit yet: no discovery at all.
    expect(modelCalls()).toBe(0);

    // Opening the dialog fetches models as expected (local endpoint
    // from the mocked llmStatus).
    fireEvent.click(
      screen.getByRole('button', { name: 'Run Verification Audit' })
    );
    await screen.findByText('Judge LLM Configuration');
    await waitFor(() => expect(modelCalls()).toBeGreaterThan(0), {
      timeout: 5000,
    });
    // The dialog's own status request is necessary and must work.
    expect(vi.mocked(fetchLlmStatus).mock.calls.length).toBeGreaterThan(0);
    const openCount = modelCalls();

    // Fake timers from here on: every later step is timer-driven
    // polling or promise-driven refetches whose notifications need
    // explicit advances (see flushAsyncQueries). No findBy/waitFor
    // below this point — only act-flushed sync assertions.
    vi.useFakeTimers();
    try {
      // An audit starts running behind the open dialog. Flipping the
      // mock alone changes nothing (no poll is scheduled while the
      // jobs list is empty), so the jobs query is invalidated exactly
      // like the dialog's own onJobCreated submit path does.
      vi.mocked(fetchVerificationJobs).mockResolvedValue([ACTIVE_JOB]);
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: ['verificationJobs'],
        });
      });
      await flushAsyncQueries();
      expect(queryClient.getQueryData(['verificationJobs'])).toEqual([
        ACTIVE_JOB,
      ]);
      // The open dialog marks the background aria-hidden (invisible
      // to role queries), so the live banner behind it is found by
      // text instead.
      expect(screen.getByText(/Audit #7 in progress/)).not.toBeNull();
      // The live banner's SSE stream connected (proves the progress
      // stimulus below is genuinely exercised).
      expect(esInstances.length).toBeGreaterThan(0);

      // Jobs (3s) and stats (10s) polling.
      const jobsBeforePoll = jobsCalls();
      await advancePolling(15000);
      expect(jobsCalls()).toBeGreaterThan(jobsBeforePoll);

      // SSE progress updates.
      await emitSseProgress();

      // Radix tab switches.
      fireEvent.click(screen.getAllByText('Job history')[0]);
      fireEvent.click(screen.getAllByText('Issues feed')[0]);

      // Window blur + refocus.
      const jobsBeforeFocus = jobsCalls();
      await fireWindowBlurAndRefocus();

      // Polling, SSE, tabs, and focus behind the open dialog start no
      // new discovery…
      expect(modelCalls()).toBe(openCount);
      // …while the audit's own jobs query provably refired on focus.
      expect(jobsCalls()).toBeGreaterThan(jobsBeforeFocus);

      // Closing the dialog stops discovery; the audit keeps running.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await flushAsyncQueries();
      expect(screen.queryByText('Judge LLM Configuration')).toBeNull();
      const closedCount = modelCalls();
      expect(closedCount).toBe(openCount);

      // More polling, SSE, tab switches, and focus with the dialog
      // closed: still zero new model-list requests.
      await advancePolling(30000);
      await emitSseProgress();
      fireEvent.click(screen.getAllByText('Transcripts coverage')[0]);
      await fireWindowBlurAndRefocus();
      await flushAsyncQueries();

      expect(modelCalls()).toBe(closedCount);
      // Necessary audit progress requests kept working throughout.
      expect(jobsCalls()).toBeGreaterThan(jobsBeforeFocus);
      expect(statsCalls()).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fetches model lists when the dialog is never opened', async () => {
    vi.mocked(fetchVerificationJobs).mockResolvedValue([ACTIVE_JOB]);
    renderPage();
    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(modelCalls()).toBe(0);
    expect(esInstances.length).toBeGreaterThan(0);

    vi.useFakeTimers();
    try {
      await advancePolling(30000);
      await emitSseProgress();
      fireEvent.click(screen.getAllByText('Job history')[0]);
      fireEvent.click(screen.getAllByText('Issues feed')[0]);
      await fireWindowBlurAndRefocus();
      await flushAsyncQueries();

      expect(modelCalls()).toBe(0);
      // …while polling kept the audit queries live.
      expect(jobsCalls()).toBeGreaterThan(1);
      expect(statsCalls()).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
