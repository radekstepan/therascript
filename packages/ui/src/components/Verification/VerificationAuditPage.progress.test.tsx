// @vitest-environment jsdom
// packages/ui/src/components/Verification/VerificationAuditPage.progress.test.tsx
//
// Task 9 regression coverage for the audit live banner and terminal result:
//
//   - A slow successful run shows the active phase (from SSE or the durable
//     snapshot) before its processed count increments.
//   - The banner reports checked/failed outcome counts, never equating
//     failed attempts with successful checks.
//   - A failed or mixed-outcome last run shows a persistent terminal result
//     with a View details action (derived from the jobs query: reload-safe).
//   - Connection trouble renders distinctly from a Judge failure.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { VerificationAuditPage } from './VerificationAuditPage';
import type {
  VerificationGlobalStats,
  VerificationJob,
  VerificationLivePhase,
} from '../../api/verification';

const { ACTIVE_JOB, MIXED_JOB, FAILED_JOB, STATS } = vi.hoisted(() => {
  const base = {
    scope: 'all_unverified',
    session_ids_json: null,
    chat_id: null,
    skip_verified: true,
    total_statements: 20,
    flagged_statements: 1,
    omissions_count: 0,
    created_at: Date.now() - 60_000,
    model_name: 'e2e-judge-model',
    context_size: 32768,
    thinking_budget: null,
    temperature: 0.2,
    top_p: 0.9,
    repeat_penalty: 1.1,
    num_gpu_layers: null,
    llm_base_url: null,
  } as const;
  const active: VerificationJob = {
    ...base,
    id: 7,
    status: 'processing',
    total_messages: 1,
    processed_messages: 0,
    succeeded_messages: 0,
    failed_messages: 0,
    skipped_messages: 0,
    current_phase: 'generating',
    current_message_id: 1914,
    current_attempt: 1,
    phase_updated_at: Date.now(),
    completed_at: null,
    error_message: null,
  };
  const mixed: VerificationJob = {
    ...base,
    id: 8,
    status: 'completed',
    total_messages: 3,
    processed_messages: 3,
    succeeded_messages: 2,
    failed_messages: 1,
    skipped_messages: 0,
    current_phase: null,
    current_message_id: null,
    current_attempt: null,
    phase_updated_at: null,
    completed_at: Date.now(),
    error_message:
      'Completed with errors: 2 of 3 checked, 1 failed (job 8, judge "e2e-judge-model"). First failure [malformed_json]: unparseable.',
  };
  const failed: VerificationJob = {
    ...base,
    id: 9,
    status: 'failed',
    total_messages: 1,
    processed_messages: 1,
    succeeded_messages: 0,
    failed_messages: 1,
    skipped_messages: 0,
    current_phase: null,
    current_message_id: null,
    current_attempt: null,
    phase_updated_at: null,
    completed_at: Date.now(),
    error_message:
      'All 1 attempted assessment failed (job 9, judge "e2e-judge-model"). First failure [empty_output]: no output.',
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
    unverifiedMessagesCount: 0,
    failedMessagesCount: 1,
    byModel: [],
    overTime: [],
    sessionsSummary: [],
  };
  return {
    ACTIVE_JOB: active,
    MIXED_JOB: mixed,
    FAILED_JOB: failed,
    STATS: stats,
  };
});

// Mutable hook result so each test drives the phase/connection state.
const hookState: {
  job: VerificationJob | null;
  phase: VerificationLivePhase | null;
  streamError: string | null;
  connectionLost: boolean;
} = { job: null, phase: null, streamError: null, connectionLost: false };

vi.mock('../../hooks/useVerificationStream', () => ({
  useVerificationStream: () => ({
    job: hookState.job,
    lastEvent: null,
    phase: hookState.phase,
    isConnected: true,
    streamError: hookState.streamError,
    connectionLost: hookState.connectionLost,
  }),
}));

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchVerificationJobs: vi.fn().mockResolvedValue([ACTIVE_JOB]),
    fetchVerificationStats: vi.fn().mockResolvedValue(STATS),
    fetchFlaggedStatements: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    cancelVerificationJob: vi.fn(),
    resetVerifications: vi.fn(),
    createVerificationJob: vi.fn(),
    fetchVerificationJobFailures: vi
      .fn()
      .mockResolvedValue({ jobId: 8, failures: [] }),
  };
});

vi.mock('../Shared/LlmEndpointModelPicker', () => ({
  LlmEndpointModelPicker: () => <div data-testid="llm-endpoint-model-picker" />,
}));

vi.mock('../../api/api', () => ({
  createVerificationJob: vi.fn(),
  fetchLlmStatus: vi.fn(),
  setLlmApiToken: vi.fn().mockResolvedValue({ message: 'ok' }),
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Theme>
            <VerificationAuditPage />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('VerificationAuditPage live phase display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.job = ACTIVE_JOB;
    hookState.phase = null;
    hookState.streamError = null;
    hookState.connectionLost = false;
  });

  it('shows the active SSE phase while processed stays 0 / 1', async () => {
    hookState.phase = {
      phase: 'generating',
      message: 'Generating assessment for message 1914 (attempt 1)…',
      messageId: 1914,
      chatId: 5,
      sessionId: 2,
      messageIndex: 1,
      attempt: 1,
      elapsedMs: 4200,
      messagePreview: null,
      tokensPerSecond: null,
      generatedTokens: null,
      updatedAt: Date.now(),
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    // The counter is numerically correct (0 finished attempts)…
    expect(screen.getByText(/Processed 0 \/ 1 messages/)).not.toBeNull();
    // …and the separate phase indicator shows the live activity.
    expect(screen.getByTestId('audit-live-phase').textContent).toContain(
      'Generating assessment for message 1914 (attempt 1)'
    );
  });

  it('falls back to the durable snapshot phase after a reload (no SSE yet)', async () => {
    // No live SSE phase (page just reloaded): the snapshot columns on the
    // job row still identify the in-flight message by its raw id.
    hookState.phase = null;
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByTestId('audit-live-phase').textContent).toContain(
      'Working on message #1914'
    );
  });

  it('prefers the snapshot message preview over the raw id after a reload', async () => {
    hookState.phase = null;
    hookState.job = {
      ...ACTIVE_JOB,
      current_message_preview: 'SOAP Note S – Subjective The client…',
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    const text = screen.getByTestId('audit-live-phase').textContent ?? '';
    expect(text).toContain('Working on "SOAP Note S – Subjective The client…"');
    expect(text).not.toContain('1914');
  });

  it('shows the preview (or id fallback) for a retrying snapshot phase', async () => {
    hookState.phase = null;
    hookState.job = {
      ...ACTIVE_JOB,
      current_phase: 'retrying',
      current_attempt: 2,
      current_message_preview: 'The client takes Sertraline',
    };
    const { unmount } = renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByTestId('audit-live-phase').textContent).toContain(
      'Retrying "The client takes Sertraline" (attempt 2)'
    );
    unmount();

    hookState.job = {
      ...ACTIVE_JOB,
      current_phase: 'retrying',
      current_attempt: 2,
      current_message_preview: null,
    };
    renderPage();
    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByTestId('audit-live-phase').textContent).toContain(
      'Retrying message #1914 (attempt 2)'
    );
  });

  it('reports checked/failed outcome counts distinctly in the banner', async () => {
    hookState.job = {
      ...ACTIVE_JOB,
      total_messages: 3,
      processed_messages: 2,
      succeeded_messages: 1,
      failed_messages: 1,
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByText('1 checked')).not.toBeNull();
    expect(screen.getByText('1 failed')).not.toBeNull();
  });

  it('renders a single spinner in the live banner while the phase is displayed', async () => {
    hookState.phase = {
      phase: 'generating',
      message: 'Generating assessment for message 1914 (attempt 1)…',
      messageId: 1914,
      chatId: 5,
      sessionId: 2,
      messageIndex: 1,
      attempt: 1,
      elapsedMs: 4200,
      messagePreview: null,
      tokensPerSecond: null,
      generatedTokens: null,
      updatedAt: Date.now(),
    };
    const { container } = renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByTestId('audit-live-phase')).not.toBeNull();
    // Header spinner kept; the duplicate phase-row spinner was removed.
    expect(container.querySelectorAll('.rt-Spinner')).toHaveLength(1);
  });

  it('shows the live token speed while the Judge is generating', async () => {
    hookState.phase = {
      phase: 'generating',
      message: 'Generating assessment for message 1914 (attempt 1)…',
      messageId: 1914,
      chatId: 5,
      sessionId: 2,
      messageIndex: 1,
      attempt: 1,
      elapsedMs: 4200,
      messagePreview: null,
      tokensPerSecond: 12.34,
      generatedTokens: 120,
      updatedAt: Date.now(),
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    const tps = screen.getByTestId('audit-live-tps');
    expect(tps.textContent).toBe('~12.3 tokens/s');
    expect(tps.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('hides the token speed indicator once generation ends', async () => {
    hookState.phase = {
      phase: 'finishing',
      message: 'Finishing audit…',
      messageId: null,
      chatId: null,
      sessionId: null,
      messageIndex: null,
      attempt: null,
      elapsedMs: 9000,
      messagePreview: null,
      tokensPerSecond: null,
      generatedTokens: null,
      updatedAt: Date.now(),
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByTestId('audit-live-phase')).not.toBeNull();
    expect(screen.queryByTestId('audit-live-tps')).toBeNull();
  });

  it('hides the token speed indicator for a zero speed value', async () => {
    hookState.phase = {
      phase: 'generating',
      message: 'Generating assessment for message 1914 (attempt 1)…',
      messageId: 1914,
      chatId: 5,
      sessionId: 2,
      messageIndex: 1,
      attempt: 1,
      elapsedMs: 100,
      messagePreview: null,
      tokensPerSecond: 0,
      generatedTokens: 0,
      updatedAt: Date.now(),
    };
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.queryByTestId('audit-live-tps')).toBeNull();
  });

  it('distinguishes connection trouble from a Judge failure', async () => {
    hookState.connectionLost = true;
    renderPage();

    await screen.findByRole('heading', { name: /Audit #7 in progress/ });
    expect(screen.getByText(/Live updates interrupted/)).not.toBeNull();
    expect(screen.queryByText(/Stream notice/)).toBeNull();
  });
});

describe('VerificationAuditPage terminal result', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    hookState.job = null;
    hookState.phase = null;
    hookState.streamError = null;
    hookState.connectionLost = false;
    const { fetchVerificationJobs } = await import('../../api/verification');
    vi.mocked(fetchVerificationJobs).mockReset();
  });

  it('shows a persistent mixed-outcome result with counts and View details', async () => {
    const { fetchVerificationJobs } = await import('../../api/verification');
    vi.mocked(fetchVerificationJobs).mockResolvedValue([MIXED_JOB]);

    renderPage();

    await screen.findByRole('heading', {
      name: 'Audit #8 completed with errors',
    });
    expect(
      screen.getByText(/2 of 3 checked, 1 failed — successful assessments/)
    ).not.toBeNull();
    // No unqualified success anywhere near the result.
    expect(screen.queryByText('Audit #8 completed')).toBeNull();
    expect(screen.getByRole('button', { name: 'View details' })).not.toBeNull();
  });

  it('shows a persistent failed result for an all-failed run', async () => {
    const { fetchVerificationJobs } = await import('../../api/verification');
    vi.mocked(fetchVerificationJobs).mockResolvedValue([FAILED_JOB]);

    renderPage();

    await screen.findByRole('heading', { name: 'Audit #9 failed' });
    expect(
      screen.getByText(/All 1 attempted assessment failed — no new verdicts/)
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'View details' })).not.toBeNull();
  });
});
