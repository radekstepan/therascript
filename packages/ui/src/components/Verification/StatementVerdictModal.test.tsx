// @vitest-environment jsdom
// packages/ui/src/components/Verification/StatementVerdictModal.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// verdict modal title must read "Fact Check" and no "Judge Verdict"
// string may remain user-visible in the verification flow.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';
import { StatementVerdictModal } from './StatementVerdictModal';
import type { VerifiedStatement } from '../../api/verification';

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
  return render(
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
    return render(
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
    render(
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
