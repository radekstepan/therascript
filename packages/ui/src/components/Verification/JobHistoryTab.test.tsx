// @vitest-environment jsdom
// packages/ui/src/components/Verification/JobHistoryTab.test.tsx
//
// Regression test for the empty-rectangle cancel icons: every cancel
// affordance used Radix `StopIcon`, whose SVG path is a hollow
// even-odd square outline that reads as a tofu box at 15px. Cancel
// buttons must render the `Cross2Icon` X glyph instead (the pattern
// used by CreateAnalysisJobModal, EditEntityModal, etc.).
//
// The expected paths are read from the installed icon components
// themselves, so the test tracks @radix-ui/react-icons upgrades
// instead of hardcoding SVG strings.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { Cross2Icon, StopIcon } from '@radix-ui/react-icons';
import { JobHistoryTab } from './JobHistoryTab';
import type { VerificationJob } from '../../api/verification';

const { ACTIVE_JOB } = vi.hoisted(() => {
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
  return { ACTIVE_JOB: job };
});

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchVerificationJobs: vi.fn().mockResolvedValue([ACTIVE_JOB]),
    cancelVerificationJob: vi.fn(),
  };
});

function iconPathD(icon: React.ReactElement): string | null {
  const { container, unmount } = render(icon);
  const d = container.querySelector('svg path')?.getAttribute('d') ?? null;
  unmount();
  return d;
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <Theme>
          <JobHistoryTab />
        </Theme>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('JobHistoryTab cancel icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the X glyph (not the hollow StopIcon square) on the Cancel button', async () => {
    renderTab();
    const cancelButton = await screen.findByRole('button', {
      name: 'Cancel',
    });
    const renderedD = cancelButton.querySelector('svg path')?.getAttribute('d');

    expect(renderedD).toBeTruthy();
    // The cancel glyph must match Cross2Icon exactly.
    expect(renderedD).toBe(iconPathD(<Cross2Icon />));
    // ... and must not be the hollow-square StopIcon path that
    // rendered as an empty rectangle throughout the app.
    expect(renderedD).not.toBe(iconPathD(<StopIcon />));
  });
});
