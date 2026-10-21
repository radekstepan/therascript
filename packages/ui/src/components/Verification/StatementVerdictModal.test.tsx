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
// needs a client (fresh per test to avoid cache leakage).
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
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

describe('StatementVerdictModal clear verification', () => {
  it('invokes deleteMessageVerification and closes when Clear Verification is clicked', async () => {
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
      await screen.findByRole('button', { name: 'Clear Verification' })
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

  it('renders no Clear Verification button without a message id', async () => {
    renderModal();

    expect(await screen.findByText('Fact Check')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Clear Verification' })
    ).toBeNull();
  });
});
