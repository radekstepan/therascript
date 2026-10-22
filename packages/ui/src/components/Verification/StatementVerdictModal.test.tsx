// @vitest-environment jsdom
// packages/ui/src/components/Verification/StatementVerdictModal.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// verdict modal title must read "Fact Check" and no "Judge Verdict"
// string may remain user-visible in the verification flow.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import { StatementVerdictModal } from './StatementVerdictModal';
import type { VerifiedStatement } from '../../api/verification';

const { mockDeleteMessageVerification } = vi.hoisted(() => ({
  mockDeleteMessageVerification: vi.fn(),
}));

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    deleteMessageVerification: mockDeleteMessageVerification,
  };
});

beforeEach(() => {
  mockDeleteMessageVerification.mockReset();
  mockDeleteMessageVerification.mockResolvedValue({ message: 'cleared' });
});

// The modal clears verifications through react-query, so every render
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

describe('StatementVerdictModal clear verification', () => {
  it('invokes deleteMessageVerification and closes when Clear Response Fact Check is clicked', async () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={onOpenChange}
          statements={[STATEMENT]}
          initialStatementId={STATEMENT.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
          messageId={STATEMENT.message_id}
        />
      </Theme>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear Response Fact Check' })
    );

    await waitFor(() => {
      expect(mockDeleteMessageVerification).toHaveBeenCalledTimes(1);
    });
    expect(mockDeleteMessageVerification).toHaveBeenCalledWith(
      STATEMENT.message_id
    );
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('renders no Clear Response Fact Check button without a message id', async () => {
    renderModal();

    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Clear Response Fact Check' })
    ).toBeNull();
  });

  it('tooltips the whole-response scope and recheck behavior', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithClient(
      <Theme>
        <StatementVerdictModal
          open
          onOpenChange={onOpenChange}
          statements={[STATEMENT, { ...STATEMENT, id: 12, statement_index: 1 }]}
          initialStatementId={STATEMENT.id}
          authoredModel="author-model"
          judgeModel="judge-model"
          verifiedAt={Date.now()}
          messageId={STATEMENT.message_id}
        />
      </Theme>
    );

    await user.hover(
      await screen.findByRole('button', {
        name: 'Clear Response Fact Check',
      })
    );
    const tooltip = await screen.findByRole('tooltip', undefined, {
      timeout: 3000,
    });
    expect(tooltip.textContent).toContain('all 2 fact-check statements');
    expect(tooltip.textContent).toContain('not just the one shown');
    expect(tooltip.textContent).toContain('unverified pool');
    expect(tooltip.textContent).toContain('re-checked on the next audit');
  });
});
