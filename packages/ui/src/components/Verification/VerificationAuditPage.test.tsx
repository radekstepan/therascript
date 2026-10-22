// @vitest-environment jsdom
// packages/ui/src/components/Verification/VerificationAuditPage.test.tsx
//
// Regression test: the "Audit #N in progress" banner must not render
// the Live / Connecting connectivity pill. The banner previously
// showed a green Wifi "Live" badge (or a gray WifiOff "Connecting…"
// badge) next to the heading; connection state is internal detail
// and the pill added noise to the progress card.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { VerificationAuditPage } from './VerificationAuditPage';
import { createVerificationJob, fetchLlmStatus } from '../../api/api';
import { fetchVerificationJobs } from '../../api/verification';
import type {
  SessionVerificationSummary,
  VerificationGlobalStats,
  VerificationJob,
} from '../../api/verification';
import type { LlmStatus } from '../../types';

const { ACTIVE_JOB, STATS } = vi.hoisted(() => {
  const sessions: SessionVerificationSummary[] = [
    {
      sessionId: 11,
      sessionName: 'Intake Session',
      clientName: 'Jane Doe',
      date: '2026-06-23T12:00:00.000Z',
      totalAiMessages: 5,
      verifiedAiMessages: 2,
      failedAiMessages: 3,
      isFullyVerified: false,
      flaggedIssues: 1,
      averageAccuracy: 80,
    },
    {
      sessionId: 12,
      sessionName: 'Follow-up Session',
      clientName: 'Jane Doe',
      date: '2026-06-30T12:00:00.000Z',
      totalAiMessages: 4,
      verifiedAiMessages: 4,
      isFullyVerified: true,
      flaggedIssues: 0,
      averageAccuracy: 95,
    },
  ];
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
    sessionsSummary: sessions,
  };
  return { ACTIVE_JOB: job, STATS: stats };
});

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
  };
});

// The audit dialog's model picker is stubbed out (mirrors
// StartVerificationModal.test.tsx); these tests only assert the dialog
// opens with its skip-verified switch, never model discovery.
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

const LLM_STATUS: LlmStatus = {
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
};

// Report a connected stream so the old green "Live" badge (the
// isConnected branch) would render pre-fix and fail this test.
vi.mock('../../hooks/useVerificationStream', () => ({
  useVerificationStream: () => ({
    job: ACTIVE_JOB,
    lastEvent: null,
    isConnected: true,
    streamError: null,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
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

describe('VerificationAuditPage header layout', () => {
  it('keeps the title and actions on one row with the subtitle below', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Fact Check' });

    const row = screen.getByTestId('fact-check-header-row');
    const heading = screen.getByRole('heading', { name: 'Fact Check' });
    const runButton = screen.getByRole('button', {
      name: 'Run Verification Audit',
    });
    const subtitle = screen.getByText(/Audit AI responses against session/);

    expect(row.contains(heading)).toBe(true);
    expect(row.contains(runButton)).toBe(true);
    expect(row.contains(subtitle)).toBe(false);
  });
});

describe('VerificationAuditPage live banner', () => {
  it('shows the in-progress banner without the Live connectivity pill', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /Audit #7 in progress/ });

    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Connecting/)).toBeNull();

    // The banner itself stays intact: progress text + cancel action.
    expect(screen.getByText(/Processed 4 \/ 10 messages/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel Job' })).not.toBeNull();
  });

  it('names the judge in the heading instead of a badge', async () => {
    renderPage();
    const heading = await screen.findByRole('heading', {
      name: /Audit #7 in progress/,
    });

    expect(heading.textContent).toContain('Judge e2e-judge-model');
    expect(screen.queryByText('Judge: e2e-judge-model')).toBeNull();
  });
});

describe('VerificationAuditPage fact-check header labels row', () => {
  it('renders failure and coverage badges below the title/actions row', async () => {
    renderPage();
    // Await the stats-dependent labels row: the heading alone renders
    // before the stats query resolves.
    await screen.findByTestId('fact-check-header-labels');

    const row = screen.getByTestId('fact-check-header-row');
    const labels = screen.getByTestId('fact-check-header-labels');
    const failedBadge = screen.getByTitle(
      '3 messages failed verification with LLM errors'
    );
    const unverifiedBadge = screen.getByText(
      '2 unverified messages across 1 transcript'
    );

    expect(labels.contains(failedBadge)).toBe(true);
    expect(labels.contains(unverifiedBadge)).toBe(true);
    expect(row.contains(failedBadge)).toBe(false);
    expect(row.contains(unverifiedBadge)).toBe(false);

    // The labels row follows the title row in DOM order.
    expect(
      // eslint-disable-next-line no-bitwise
      row.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Title row keeps the title plus the retained actions.
    const heading = screen.getByRole('heading', { name: 'Fact Check' });
    expect(row.contains(heading)).toBe(true);
    expect(
      row.contains(
        screen.getByRole('button', { name: 'Run Verification Audit' })
      )
    ).toBe(true);
    expect(
      row.contains(within(row).getByRole('button', { name: 'Reset' }))
    ).toBe(true);
  });

  it('keeps the actions group right-aligned with no badges interleaved', async () => {
    renderPage();
    await screen.findByTestId('fact-check-header-labels');

    const actions = screen.getByTestId('fact-check-header-actions');
    // Radix `justify="end"` maps to the rt-r-jc-end utility class.
    expect(actions.className).toContain('rt-r-jc-end');
    expect(
      within(actions).getByRole('button', { name: 'Run Verification Audit' })
    ).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Reset' })).toBeTruthy();

    // No informational badge copy lives inside the actions group.
    expect(actions.textContent).not.toContain('verifications failed');
    expect(actions.textContent).not.toContain('unverified messages');
    expect(actions.textContent).not.toContain('Everything verified');

    // The labels row wraps so badges flow below the actions on narrow
    // viewports instead of interleaving with the buttons.
    expect(screen.getByTestId('fact-check-header-labels').className).toContain(
      'rt-r-fw-wrap'
    );
  });

  it('has no Retry Failed header control or orphaned retry copy', async () => {
    renderPage();
    // Wait for stats so the absence assertion is meaningful: pre-fix,
    // the header retry rendered once failures loaded.
    await screen.findByTestId('fact-check-header-labels');

    const row = screen.getByTestId('fact-check-header-row');
    expect(
      within(row).queryByRole('button', { name: 'Retry Failed' })
    ).toBeNull();
    // Header retry tooltip and loading copy are gone with the button.
    expect(
      screen.queryByTitle(
        'Re-audit failed messages (skips already-verified ones)'
      )
    ).toBeNull();
    expect(screen.queryByText('Retrying…')).toBeNull();
  });
});

describe('VerificationAuditPage coverage actions', () => {
  async function renderIdleAndOpenCoverageTab() {
    // No active job so the per-session actions stay enabled.
    vi.mocked(fetchVerificationJobs).mockResolvedValueOnce([]);
    vi.mocked(fetchLlmStatus).mockResolvedValue(LLM_STATUS);
    vi.mocked(createVerificationJob).mockClear();
    renderPage();
    // Radix Themes renders trigger children twice (visible label plus a
    // CSS-hidden sizing copy), so in jsdom the accessible name doubles
    // up; a substring match works in both jsdom and real browsers.
    const tab = await screen.findByRole('tab', {
      name: /Transcripts coverage/,
    });
    // Radix tabs use automatic (focus) activation; a synthetic click
    // alone does not move focus in jsdom, so focus first.
    tab.focus();
    fireEvent.click(tab);
  }

  it('opens the audit dialog from the per-session Retry Failed button without a one-click mutation', async () => {
    await renderIdleAndOpenCoverageTab();

    const retry = await screen.findByRole('button', { name: 'Retry Failed' });
    expect(retry.getAttribute('title')).toContain('opens the audit dialog');
    fireEvent.click(retry);

    // The retained flow: dialog pre-scoped to the session with the
    // skip-already-verified switch available.
    await screen.findByRole('dialog', { name: 'Run Verification Audit' });
    expect(
      screen.getByText(
        'Skip transcripts & messages that have already been verified'
      )
    ).toBeTruthy();
    await screen.findByText('Transcripts (1 selected)');
    expect(vi.mocked(createVerificationJob)).not.toHaveBeenCalled();
  });

  it('keeps the per-session Audit action opening the audit dialog', async () => {
    await renderIdleAndOpenCoverageTab();

    const audit = await screen.findByRole('button', { name: 'Audit session' });
    fireEvent.click(audit);

    await screen.findByRole('dialog', { name: 'Run Verification Audit' });
    expect(
      screen.getByText(
        'Skip transcripts & messages that have already been verified'
      )
    ).toBeTruthy();
    await screen.findByText('Transcripts (1 selected)');
  });
});
