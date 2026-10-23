// @vitest-environment jsdom
// packages/ui/src/components/Verification/StatementVerdictModal.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// verdict modal title must read "Fact Check" and no "Judge Verdict"
// string may remain user-visible in the verification flow.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import { StatementVerdictModal } from './StatementVerdictModal';
import type { VerifiedStatement } from '../../api/verification';

const { mockDismissStatement } = vi.hoisted(() => ({
  mockDismissStatement: vi.fn(),
}));

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    dismissStatementVerification: mockDismissStatement,
  };
});

beforeEach(() => {
  mockDismissStatement.mockReset();
});

// The modal dismisses findings through react-query, so every render
// needs a client (fresh per test to avoid cache leakage). The router
// wrapper serves the evidence paragraph jump links.
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

const STATEMENT: VerifiedStatement = {
  id: 11,
  message_verification_id: 5,
  message_id: 42,
  session_id: 7,
  statement_index: 0,
  kind: 'claim',
  exact_quote: 'The client takes sertraline daily.',
  normalized_claim: 'The client takes sertraline daily.',
  start_char: 0,
  end_char: 34,
  verdict: 'fabricated',
  severity: 'high',
  confidence: 0.92,
  reasoning: 'No mention of sertraline anywhere in the transcript.',
  transcript_evidence_json: null,
  created_at: Date.now(),
  review_status: 'unreviewed',
  confirmed_at: null,
  review_id: null,
  review_token: 'v1.modal-token',
};

function renderModal() {
  return renderWithClient(
    <Theme>
      <StatementVerdictModal
        open
        onOpenChange={() => {}}
        statements={[STATEMENT]}
        initialStatementId={STATEMENT.id}
        authoredModel="author-model"
        judgeModel="judge-model"
        verifiedAt={Date.now()}
      />
    </Theme>
  );
}

describe('StatementVerdictModal title', () => {
  it('reads "Fact Check" instead of "Judge Verdict"', async () => {
    renderModal();
    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(screen.queryByText('Judge Verdict')).toBeNull();
  });
});

describe('StatementVerdictModal empty evidence note', () => {
  // Mirrors the API shape for a judge verdict without quotes: the
  // repository persists NULL and the API returns evidence: [].
  const NO_EVIDENCE: VerifiedStatement = {
    ...STATEMENT,
    id: 13,
    verdict: 'supported',
    severity: 'none',
    reasoning: 'Confirmed by the session transcript.',
    transcript_evidence_json: null,
    evidence: [],
  };

  function renderStatement(statement: VerifiedStatement) {
    return renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[statement]}
          initialStatementId={statement.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );
  }

  it('renders the Fact Check empty-state note when a non-fabricated statement has no evidence', async () => {
    renderStatement(NO_EVIDENCE);
    expect(
      await screen.findByText(
        'The Fact Check did not attach transcript quotes for this statement.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Judge did not attach/)).toBeNull();
  });

  it('routes fabricated statements without evidence to the red no-evidence callout instead', async () => {
    renderStatement(STATEMENT);
    expect(await screen.findByText(/No matching evidence found/)).toBeTruthy();
    expect(screen.queryByText(/did not attach transcript quotes/)).toBeNull();
  });
});

describe('StatementVerdictModal top steppers', () => {
  const SECOND: VerifiedStatement = {
    ...STATEMENT,
    id: 12,
    statement_index: 1,
    exact_quote: 'The client attends weekly sessions.',
    normalized_claim: 'The client attends weekly sessions.',
    verdict: 'supported',
    severity: 'none',
  };

  it('renders no top prev/next steppers for multi-statement messages', async () => {
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[STATEMENT, SECOND]}
          initialStatementId={STATEMENT.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );

    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Previous statement' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next statement' })).toBeNull();
    // Close affordance and bottom Prev/Next navigation are retained.
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });
});

describe('StatementVerdictModal UNKNOWN speaker', () => {
  const UNKNOWN_SPEAKER: VerifiedStatement = {
    ...STATEMENT,
    id: 14,
    verdict: 'supported',
    severity: 'none',
    reasoning: 'Confirmed by the session transcript.',
    transcript_evidence_json: null,
    evidence: [
      {
        paragraphIndex: 3,
        timestampMs: 61_000,
        speaker: 'UNKNOWN',
        quote: 'The client mentioned sertraline.',
      },
    ],
  };

  it('hides the speaker badge when the speaker is UNKNOWN', async () => {
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[UNKNOWN_SPEAKER]}
          initialStatementId={UNKNOWN_SPEAKER.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );

    // The evidence card still renders (timestamp + quote) without the badge.
    expect(await screen.findByText('1:01')).toBeTruthy();
    expect(screen.getByText(/mentioned sertraline/)).toBeTruthy();
    expect(screen.queryByText('UNKNOWN')).toBeNull();
  });

  it('keeps the speaker badge for known speakers', async () => {
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[
            {
              ...UNKNOWN_SPEAKER,
              evidence: [
                {
                  paragraphIndex: 3,
                  timestampMs: 61_000,
                  speaker: 'Client',
                  quote: 'The client mentioned sertraline.',
                },
              ],
            },
          ]}
          initialStatementId={UNKNOWN_SPEAKER.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );

    expect(await screen.findByText('Client')).toBeTruthy();
  });
});

describe('StatementVerdictModal paragraph jump link', () => {
  const WITH_PARAGRAPH: VerifiedStatement = {
    ...STATEMENT,
    id: 15,
    verdict: 'supported',
    severity: 'none',
    reasoning: 'Confirmed by the session transcript.',
    transcript_evidence_json: null,
    evidence: [
      {
        paragraphIndex: 14,
        timestampMs: 125_000,
        speaker: 'Client',
        quote: 'The client takes sertraline daily.',
      },
    ],
  };

  function renderStatement(statement: VerifiedStatement) {
    return renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[statement]}
          initialStatementId={statement.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );
  }

  it('links the ¶ evidence reference to that transcript paragraph', async () => {
    renderStatement(WITH_PARAGRAPH);
    const link = await screen.findByRole('link', {
      name: 'Jump to transcript paragraph 14',
    });
    expect(link.textContent).toBe('¶14');
    expect(link.getAttribute('href')).toContain('#paragraph-14');
    expect(link.getAttribute('title')).toContain(
      'Jump to this paragraph in the session transcript'
    );
  });

  it('renders no jump link when the evidence has no paragraph index', async () => {
    renderStatement({
      ...WITH_PARAGRAPH,
      evidence: [
        {
          paragraphIndex: null,
          timestampMs: 125_000,
          speaker: 'Client',
          quote: 'The client takes sertraline daily.',
        },
      ],
    });
    // The evidence card rendered (timestamp), but offers no jump link.
    expect(await screen.findByText('2:05')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /Jump to transcript paragraph/ })
    ).toBeNull();
  });
});

describe('StatementVerdictModal clear action removed', () => {
  it('renders no Clear Response Fact Check button', async () => {
    renderModal();

    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Clear Response Fact Check' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });
});

describe('StatementVerdictModal footer alignment', () => {
  const SECOND: VerifiedStatement = {
    ...STATEMENT,
    id: 12,
    statement_index: 1,
    exact_quote: 'The client attends weekly sessions.',
    normalized_claim: 'The client attends weekly sessions.',
    verdict: 'supported',
    severity: 'none',
  };

  it('right-aligns the Prev/Next navigation (no left-side actions)', async () => {
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={() => {}}
          statements={[STATEMENT, SECOND]}
          initialStatementId={STATEMENT.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
        />
      </Theme>
    );

    const next = await screen.findByRole('button', { name: 'Next' });
    const prev = screen.getByRole('button', { name: 'Prev' });
    // Both steppers share one row container pinned to the right edge;
    // the response-scoped Clear action (the old left column) is gone.
    const row = next.closest('div');
    expect(row).not.toBeNull();
    expect(row!.contains(prev)).toBe(true);
    expect(row!.className).toMatch(/jc-end|justify-end|justify-content/);
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });
});

describe('StatementVerdictModal left-dock and drag', () => {
  // jsdom has no PointerEvent constructor, so testing-library's
  // fireEvent.pointerDown drops clientX/clientY. Dispatch plain
  // bubbling events with coordinates assigned: React's onPointerDown
  // listens to the native event type regardless of constructor.
  function dispatchPointer(
    target: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    clientX: number,
    clientY: number
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX, clientY, button: 0, pointerId: 1 });
    target.dispatchEvent(event);
  }

  it('docks left of center so the transcript stays visible', async () => {
    renderModal();

    const modal = await screen.findByTestId('fact-check-modal');
    // Fixed left dock (not centered): the right half of a side-by-side
    // session view stays uncovered for the transcript.
    expect(modal.style.position).toBe('fixed');
    expect(modal.style.left).toBe('24px');
    expect(modal.style.top).toBe('50%');
  });

  it('moves the modal when the header handle is dragged', async () => {
    renderModal();

    const modal = await screen.findByTestId('fact-check-modal');
    const handle = screen.getByTestId('fact-check-drag-handle');
    expect(handle.style.cursor).toBe('move');

    dispatchPointer(handle, 'pointerdown', 100, 100);
    dispatchPointer(handle, 'pointermove', 160, 140);
    dispatchPointer(handle, 'pointerup', 160, 140);

    await waitFor(() => {
      expect(modal.style.transform).toContain('translate(60px, 40px)');
    });
  });

  it('does not start a drag from the header Close button', async () => {
    renderModal();

    const modal = await screen.findByTestId('fact-check-modal');
    const before = modal.style.transform;
    const close = screen.getByRole('button', { name: 'Close' });
    dispatchPointer(close, 'pointerdown', 100, 100);
    dispatchPointer(close, 'pointermove', 300, 300);
    dispatchPointer(close, 'pointerup', 300, 300);

    expect(modal.style.transform).toBe(before);
  });
});

describe('StatementVerdictModal dismissal', () => {
  const SUPPORTED: VerifiedStatement = {
    ...STATEMENT,
    id: 12,
    statement_index: 1,
    exact_quote: 'The client attends weekly sessions.',
    normalized_claim: 'The client attends weekly sessions.',
    verdict: 'supported',
    severity: 'none',
  };
  const CONFIRMED: VerifiedStatement = {
    ...STATEMENT,
    id: 13,
    statement_index: 2,
    review_status: 'confirmed',
    confirmed_at: 5000,
    review_id: 3,
  };

  function renderDismissable(
    statements: VerifiedStatement[],
    initialStatementId: number
  ) {
    const queryClient = new QueryClient({
      defaultOptions: {
        // Keep a normal cache lifetime: dismissal tests seed
        // chatVerifications entries with no active observer.
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const renderResult = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <StatementVerdictModal
              open
              onOpenChange={() => {}}
              statements={statements}
              initialStatementId={initialStatementId}
              authoredModel="author-model"
              judgeModel="judge-model"
              verifiedAt={Date.now()}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
    return { ...renderResult, queryClient };
  }

  it('shows Dismiss only for unresolved eligible findings', async () => {
    const { unmount } = renderDismissable([STATEMENT], STATEMENT.id);
    expect(
      await screen.findByRole('button', {
        name: 'Dismiss',
      })
    ).toBeTruthy();
    unmount();

    // Supported claims need no action: no Dismiss button.
    renderDismissable([SUPPORTED], SUPPORTED.id);
    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('shows "Confirmed by you" with original Judge details for confirmed rows', async () => {
    renderDismissable([CONFIRMED], CONFIRMED.id);
    expect(await screen.findByText(/Confirmed by you/)).toBeTruthy();
    // Original Judge verdict is preserved, not rewritten.
    expect(screen.getByText('FABRICATED')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('dismisses with id+token, updates cache, and stays on the statement', async () => {
    const user = userEvent.setup();
    const confirmedRow: VerifiedStatement = {
      ...STATEMENT,
      review_status: 'confirmed',
      confirmed_at: 6000,
      review_id: 4,
    };
    const returnedVerification = {
      id: 5,
      message_id: 42,
      chat_id: 9,
      session_id: 7,
      verification_job_id: 3,
      authored_model: 'author-model',
      judge_model: 'judge-model',
      status: 'completed',
      total_claims: 1,
      supported_claims: 1,
      partial_claims: 0,
      contradicted_claims: 0,
      fabricated_claims: 0,
      omissions_count: 0,
      accuracy_score: 1,
      summary_assessment: null,
      prompt_tokens: null,
      completion_tokens: null,
      duration_ms: null,
      verified_at: Date.now(),
      error_message: null,
      statements: [confirmedRow],
    };
    // Deferred dismiss so the pending state is observable.
    let resolveDismiss!: (value: unknown) => void;
    mockDismissStatement.mockImplementation(
      () => new Promise((resolve) => (resolveDismiss = resolve))
    );
    const { queryClient, rerender } = renderDismissable(
      [STATEMENT, SUPPORTED],
      STATEMENT.id
    );
    queryClient.setQueryData(
      ['chatVerifications', 9, 7],
      [{ ...returnedVerification, statements: [STATEMENT, SUPPORTED] }]
    );

    const dismissButton = await screen.findByRole('button', {
      name: 'Dismiss',
    });
    await user.click(dismissButton);
    expect(mockDismissStatement).toHaveBeenCalledWith(11, 'v1.modal-token');

    // Pending: Dismissing…, navigation disabled, evidence visible.
    expect(
      await screen.findByRole('button', { name: 'Dismissing…' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prev' })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty(
      'disabled',
      true
    );
    expect(
      screen.getByText('No mention of sertraline anywhere in the transcript.')
    ).toBeTruthy();

    resolveDismiss({
      statement: confirmedRow,
      verification: returnedVerification,
    });
    // Cache update lands immediately from the returned assessment.
    await waitFor(() => {
      const cached = queryClient.getQueryData([
        'chatVerifications',
        9,
        7,
      ]) as Array<{ fabricated_claims: number }>;
      expect(cached[0]!.fabricated_claims).toBe(0);
    });
    // Parent rerenders the modal with the fresh statements; the modal stays
    // on the reviewed statement (ID-tracked) showing the confirmed badge.
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <StatementVerdictModal
              open
              onOpenChange={() => {}}
              statements={[confirmedRow, SUPPORTED]}
              initialStatementId={STATEMENT.id}
              authoredModel="author-model"
              judgeModel="judge-model"
              verifiedAt={Date.now()}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText(/Confirmed by you/)).toBeTruthy();
    expect(screen.getByText('FABRICATED')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    // Navigation through all statements is preserved.
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('restores controls with an inline error when dismissal fails', async () => {
    const user = userEvent.setup();
    // Production-faithful: thrown ApiErrors surface as a plain-text body.
    mockDismissStatement.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { data: 'stale confirmation token' },
      })
    );
    renderDismissable([STATEMENT, SUPPORTED], STATEMENT.id);
    const dismissButton = await screen.findByRole('button', {
      name: 'Dismiss',
    });
    await user.click(dismissButton);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/stale confirmation token/);
    // Controls restored, modal still open on the same statement.
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty(
      'disabled',
      false
    );
    expect(screen.getByText('Fact Check')).toBeTruthy();
  });

  it('tracks selection by ID when a refetch reorders statements', async () => {
    const FIRST = { ...STATEMENT, statement_index: 0 };
    const SECOND = { ...SUPPORTED, statement_index: 1 };
    const { rerender } = renderDismissable([FIRST, SECOND], FIRST.id);
    expect(
      await screen.findByText('The client takes sertraline daily.')
    ).toBeTruthy();

    // Refetch returns the same rows reordered: selection follows the ID.
    rerender(
      <MemoryRouter>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: {
                queries: { retry: false, gcTime: 0 },
                mutations: { retry: false },
              },
            })
          }
        >
          <Theme>
            <StatementVerdictModal
              open
              onOpenChange={() => {}}
              statements={[SECOND, FIRST]}
              initialStatementId={FIRST.id}
              authoredModel="author-model"
              judgeModel="judge-model"
              verifiedAt={Date.now()}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
    // Still on FIRST (its quote), not retargeted to the new index 0.
    expect(
      await screen.findByText('The client takes sertraline daily.')
    ).toBeTruthy();
    expect(screen.getByText(/Statement 1 of 2/)).toBeTruthy();
  });
});

describe('StatementVerdictModal dismissal refresh', () => {
  function renderRefreshable() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const renderResult = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <StatementVerdictModal
              open
              onOpenChange={() => {}}
              statements={[STATEMENT]}
              initialStatementId={STATEMENT.id}
              authoredModel="author-model"
              judgeModel="judge-model"
              verifiedAt={Date.now()}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
    return { ...renderResult, queryClient };
  }

  it('applies the assessment carried on a 409 and shows the explanation', async () => {
    const user = userEvent.setup();
    const refreshed = {
      ...STATEMENT,
      id: 99,
      review_token: 'v1.fresh-token',
    };
    const refreshedVerification = {
      id: 5,
      message_id: 42,
      chat_id: 9,
      session_id: 7,
      verification_job_id: 3,
      authored_model: 'author-model',
      judge_model: 'judge-model',
      status: 'completed',
      total_claims: 1,
      supported_claims: 0,
      partial_claims: 0,
      contradicted_claims: 0,
      fabricated_claims: 1,
      omissions_count: 0,
      accuracy_score: 0,
      summary_assessment: null,
      prompt_tokens: null,
      completion_tokens: null,
      duration_ms: null,
      verified_at: Date.now(),
      error_message: null,
      statements: [refreshed],
    };
    mockDismissStatement.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: {
          data: {
            message: 'stale confirmation token',
            details: { verification: refreshedVerification },
          },
        },
      })
    );
    const { queryClient, rerender } = renderRefreshable();
    queryClient.setQueryData(
      ['chatVerifications', 9, 7],
      [{ ...refreshedVerification, statements: [STATEMENT] }]
    );
    const dismissButton = await screen.findByRole('button', {
      name: 'Dismiss',
    });
    await user.click(dismissButton);

    // Explanation surfaces inline; the carried assessment lands in cache.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/stale confirmation token/);
    await waitFor(() => {
      const cached = queryClient.getQueryData([
        'chatVerifications',
        9,
        7,
      ]) as Array<{ statements: Array<{ id: number }> }>;
      expect(cached[0]!.statements[0]!.id).toBe(99);
    });

    // Parent rerenders with refreshed rows: new token, still actionable.
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <StatementVerdictModal
              open
              onOpenChange={() => {}}
              statements={[refreshed]}
              initialStatementId={STATEMENT.id}
              authoredModel="author-model"
              judgeModel="judge-model"
              verifiedAt={Date.now()}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('button', {
        name: 'Dismiss',
      })
    ).toBeTruthy();
  });
});
