// @vitest-environment jsdom
// packages/ui/src/components/Jobs/JobsQueueModal.test.tsx
//
// Regression test: the Active Jobs Queue modal must list in-progress
// verification (fact-check) jobs. The sidebar badge counts them via
// GET /api/jobs/active-count (verification-aware), but the modal only
// queried analysis jobs, transcribing sessions, and client-side LLM
// jobs — so during a fact check the badge showed 1 while the modal
// showed "No active jobs in the queue."
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { JobsQueueModal } from './JobsQueueModal';
import type { VerificationJob } from '../../api/verification';

const { PROCESSING_JOB } = vi.hoisted(() => {
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
  return { PROCESSING_JOB: job };
});

vi.mock('../../api/analysis', () => ({
  fetchAnalysisJobs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/session', () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchVerificationJobs: vi.fn().mockResolvedValue([PROCESSING_JOB]),
    cancelVerificationJob: vi
      .fn()
      .mockResolvedValue({ message: 'Cancellation request accepted.' }),
  };
});

function renderModal() {
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
            <JobsQueueModal isOpen={true} onOpenChange={() => {}} />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('JobsQueueModal verification jobs', () => {
  it('lists an in-progress fact-check job instead of showing empty', async () => {
    renderModal();

    await screen.findByText(/Verification Jobs \(1\)/);

    expect(screen.queryByText('No active jobs in the queue.')).toBeNull();
    expect(screen.getByText(/Audit #7/)).not.toBeNull();
    expect(screen.getByText('processing')).not.toBeNull();
  });

  it('shows flagged counts and cancels without following the card link', async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByText(/Verification Jobs \(1\)/);
    expect(screen.getByText(/Processed: 4 \/ 10 messages/)).not.toBeNull();
    expect(screen.getByText(/1 flagged/)).not.toBeNull();

    const { cancelVerificationJob } = await import('../../api/verification');
    await user.click(screen.getByRole('button', { name: /Cancel/ }));

    expect(vi.mocked(cancelVerificationJob)).toHaveBeenCalledWith(7);
  });

  it('hides the verification section when no verification job is active', async () => {
    const { fetchVerificationJobs } = await import('../../api/verification');
    vi.mocked(fetchVerificationJobs).mockResolvedValueOnce([
      { ...PROCESSING_JOB, status: 'completed', completed_at: Date.now() },
    ]);

    renderModal();

    await screen.findByText('No active jobs in the queue.');
    expect(screen.queryByText(/Verification Jobs/)).toBeNull();
  });
});
