// @vitest-environment jsdom
// packages/ui/src/components/Verification/JobHistoryTab.details.test.tsx
//
// Task 9 regression coverage for failure-aware job history:
//
//   - Mixed runs (completed + failed_messages > 0) render "Completed with
//     errors", never unqualified success.
//   - Terminal rows show the checked/failed outcome split.
//   - Failed and mixed runs offer "View", opening per-message
//     reasons with links to the affected session/chat/note.
//   - Clean completed runs show no View action.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { JobHistoryTab } from './JobHistoryTab';
import type {
  FailedVerificationItem,
  VerificationJob,
} from '../../api/verification';

const { MIXED_JOB, FAILED_JOB, CLEAN_JOB, FAILURES } = vi.hoisted(() => {
  const base = {
    scope: 'all_unverified',
    session_ids_json: null,
    chat_id: null,
    skip_verified: true,
    total_statements: 20,
    flagged_statements: 1,
    omissions_count: 0,
    created_at: Date.now() - 60_000,
    completed_at: Date.now(),
    model_name: 'e2e-judge-model',
    context_size: 32768,
    thinking_budget: null,
    temperature: 0.2,
    top_p: 0.9,
    repeat_penalty: 1.1,
    num_gpu_layers: null,
    llm_base_url: null,
  } as const;
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
    error_message: 'Completed with errors: 2 of 3 checked, 1 failed',
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
    error_message: 'All 1 attempted assessment failed',
  };
  const clean: VerificationJob = {
    ...base,
    id: 10,
    status: 'completed',
    total_messages: 2,
    processed_messages: 2,
    succeeded_messages: 2,
    failed_messages: 0,
    skipped_messages: 0,
    current_phase: null,
    current_message_id: null,
    current_attempt: null,
    phase_updated_at: null,
    error_message: null,
  };
  const failures: FailedVerificationItem[] = [
    {
      messageId: 1914,
      chatId: 5,
      sessionId: 2,
      sessionName: 'Intake Session',
      clientName: 'Jane Doe',
      verificationJobId: 8,
      authoredModel: 'author-model',
      judgeModel: 'e2e-judge-model',
      errorCode: 'malformed_json',
      errorMessage:
        '[malformed_json] Judge returned invalid JSON for message 1914 (job 8): unparseable output. Retries exhausted.',
      promptTokens: 200,
      completionTokens: 50,
      durationMs: 1500,
      verifiedAt: Date.now(),
    },
  ];
  return {
    MIXED_JOB: mixed,
    FAILED_JOB: failed,
    CLEAN_JOB: clean,
    FAILURES: failures,
  };
});

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchVerificationJobs: vi
      .fn()
      .mockResolvedValue([MIXED_JOB, FAILED_JOB, CLEAN_JOB]),
    fetchVerificationJobFailures: vi.fn().mockResolvedValue({
      jobId: 8,
      failures: FAILURES,
    }),
    cancelVerificationJob: vi.fn(),
  };
});

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Theme>
            <JobHistoryTab />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('JobHistoryTab failure outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels mixed runs "Completed with errors" with the outcome split', async () => {
    renderTab();

    const badge = await screen.findByText('Completed with errors');
    expect(badge).not.toBeNull();
    expect(await screen.findByText('2 checked · 1 failed')).not.toBeNull();
    expect(await screen.findByText('failed')).not.toBeNull();
    // The clean run keeps its plain completed badge.
    expect(screen.getAllByText('completed')).toHaveLength(1);
  });

  it('offers View only for failed or mixed runs', async () => {
    renderTab();

    const buttons = await screen.findAllByRole('button', {
      name: 'View',
    });
    expect(buttons).toHaveLength(2);
  });

  it('opens per-message reasons with session/chat/note links', async () => {
    renderTab();

    const buttons = await screen.findAllByRole('button', {
      name: 'View',
    });
    fireEvent.click(buttons[0]);

    await screen.findByRole('dialog', {
      name: 'Audit #8 — failure details',
    });
    expect(await screen.findByText('Invalid Judge JSON')).not.toBeNull();
    expect(screen.getByText(/Retries exhausted/)).not.toBeNull();
    // Affected-note link follows the issues-feed convention.
    const noteLink = screen.getByRole('link', {
      name: 'Open note 1914 in Intake Session',
    });
    expect(noteLink.getAttribute('href')).toBe(
      '/sessions/2/chats/5?highlightMsg=1914'
    );
    const sessionLink = screen.getByRole('link', {
      name: 'Open transcript for Intake Session',
    });
    expect(sessionLink.getAttribute('href')).toBe('/sessions/2');
  });
});
