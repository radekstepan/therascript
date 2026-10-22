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
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { VerificationAuditPage } from './VerificationAuditPage';
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
    fetchVerificationJobs: vi.fn().mockResolvedValue([ACTIVE_JOB]),
    fetchVerificationStats: vi.fn().mockResolvedValue(STATS),
    fetchFlaggedStatements: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    cancelVerificationJob: vi.fn(),
    resetVerifications: vi.fn(),
  };
});

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
    await screen.findByRole('heading', { name: 'Audit #7 in progress' });

    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Connecting/)).toBeNull();

    // The banner itself stays intact: progress text + cancel action.
    expect(screen.getByText(/Processed 4 \/ 10 messages/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel Job' })).not.toBeNull();
  });
});
