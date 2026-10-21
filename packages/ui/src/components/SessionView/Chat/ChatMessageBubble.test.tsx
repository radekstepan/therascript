// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// inline highlight tooltips and the severity link tooltip that
// open the verdict modal must point at the "Fact Check".
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import { ChatMessageBubble } from './ChatMessageBubble';
import type { ChatMessage } from '../../../types';
import type {
  MessageVerification,
  VerifiedStatement,
} from '../../../api/verification';

const { mockDeleteMessageVerification } = vi.hoisted(() => ({
  mockDeleteMessageVerification: vi.fn(),
}));

vi.mock('../../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../api/verification')>();
  return {
    ...original,
    deleteMessageVerification: mockDeleteMessageVerification,
  };
});

beforeEach(() => {
  mockDeleteMessageVerification.mockReset();
  mockDeleteMessageVerification.mockResolvedValue({ message: 'cleared' });
});

// The bubble clears failed verifications through react-query, so every
// render needs a client (fresh per test to avoid cache leakage).
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

const TEXT = 'The client takes sertraline daily.';

const STATEMENT: VerifiedStatement = {
  id: 11,
  message_verification_id: 5,
  message_id: 42,
  session_id: 7,
  statement_index: 0,
  kind: 'claim',
  exact_quote: TEXT,
  normalized_claim: 'The client takes sertraline daily.',
  start_char: 0,
  end_char: TEXT.length,
  verdict: 'fabricated',
  severity: 'high',
  confidence: 0.92,
  reasoning: 'No mention of sertraline anywhere in the transcript.',
  transcript_evidence_json: null,
  created_at: Date.now(),
};

const VERIFICATION: MessageVerification = {
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
  statements: [STATEMENT],
};

const MESSAGE: ChatMessage = {
  id: 42,
  chatId: 9,
  sender: 'ai',
  text: TEXT,
  timestamp: Date.now(),
};

function renderBubble() {
  return renderWithClient(
    <Theme>
      <ChatMessageBubble
        message={MESSAGE}
        isCurrentlyStreaming={false}
        isAiResponding={false}
        renderMd={false}
        onStarClick={() => {}}
        onCopyClick={() => {}}
        verification={VERIFICATION}
        onStatementClick={() => {}}
      />
    </Theme>
  );
}

describe('ChatMessageBubble verification entry points', () => {
  it('points inline highlights and badges at the Fact Check', () => {
    const { container } = renderBubble();

    const mark = container.querySelector('mark');
    expect(mark?.getAttribute('title')).toContain('Fact Check');

    const titles = Array.from(container.querySelectorAll('[title]')).map(
      (el) => el.getAttribute('title') ?? ''
    );
    expect(titles).toContain('Open the Fact Check');

    for (const title of titles) {
      expect(title).not.toContain('Judge');
    }
  });
});

describe('ChatMessageBubble verified toggle', () => {
  const SUPPORTED_QUOTE = 'The client takes sertraline daily.';
  const FABRICATED_QUOTE = 'The client owns three cats.';
  const MIXED_TEXT = `${SUPPORTED_QUOTE} ${FABRICATED_QUOTE}`;

  const SUPPORTED: VerifiedStatement = {
    ...STATEMENT,
    id: 21,
    statement_index: 0,
    exact_quote: SUPPORTED_QUOTE,
    normalized_claim: SUPPORTED_QUOTE,
    start_char: 0,
    end_char: SUPPORTED_QUOTE.length,
    verdict: 'supported',
    severity: 'none',
    confidence: 0.98,
    reasoning: 'Confirmed by the session transcript.',
  };

  const FABRICATED: VerifiedStatement = {
    ...STATEMENT,
    id: 22,
    statement_index: 1,
    exact_quote: FABRICATED_QUOTE,
    normalized_claim: FABRICATED_QUOTE,
    start_char: SUPPORTED_QUOTE.length + 1,
    end_char: MIXED_TEXT.length,
  };

  it('has no show/hide-verified toggle and always highlights supported claims', () => {
    const { container } = renderWithClient(
      <Theme>
        <ChatMessageBubble
          message={{ ...MESSAGE, text: MIXED_TEXT }}
          isCurrentlyStreaming={false}
          isAiResponding={false}
          renderMd={false}
          onStarClick={() => {}}
          onCopyClick={() => {}}
          verification={{
            ...VERIFICATION,
            total_claims: 2,
            supported_claims: 1,
            fabricated_claims: 1,
            statements: [SUPPORTED, FABRICATED],
          }}
          onStatementClick={() => {}}
        />
      </Theme>
    );

    expect(screen.queryByRole('button', { name: /verified/i })).toBeNull();
    const marks = Array.from(container.querySelectorAll('mark')).map(
      (mark) => mark.textContent
    );
    expect(marks).toContain(SUPPORTED_QUOTE);
    expect(marks).toContain(FABRICATED_QUOTE);
  });
});

describe('ChatMessageBubble note footer', () => {
  const S1 = 'The client takes sertraline daily.';
  const S2 = 'The client owns three cats.';
  const FOOTER_TEXT = `${S1} ${S2}`;

  const PARTIAL: VerifiedStatement = {
    ...STATEMENT,
    id: 31,
    statement_index: 0,
    exact_quote: S1,
    normalized_claim: S1,
    start_char: 0,
    end_char: S1.length,
    verdict: 'partially_supported',
    severity: 'medium',
    confidence: 0.61,
    reasoning: 'Only part of the claim is confirmed.',
  };
  const OMISSION: VerifiedStatement = {
    ...STATEMENT,
    id: 32,
    statement_index: 1,
    kind: 'omission',
    exact_quote: '',
    normalized_claim: 'Missed medication history.',
    start_char: null,
    end_char: null,
    verdict: 'omission',
    severity: 'medium',
    confidence: 0.7,
    reasoning: 'The note never answers the dosage question.',
  };
  const FABRICATED: VerifiedStatement = {
    ...STATEMENT,
    id: 33,
    statement_index: 2,
    exact_quote: S2,
    normalized_claim: S2,
    start_char: S1.length + 1,
    end_char: FOOTER_TEXT.length,
  };

  function renderFooteredBubble(
    verification: MessageVerification,
    onStatementClick: (
      messageId: number,
      statement: VerifiedStatement
    ) => void = () => {},
    message: ChatMessage = { ...MESSAGE, text: FOOTER_TEXT }
  ) {
    return renderWithClient(
      <Theme>
        <ChatMessageBubble
          message={message}
          isCurrentlyStreaming={false}
          isAiResponding={false}
          renderMd={false}
          onStarClick={() => {}}
          onCopyClick={() => {}}
          verification={verification}
          onStatementClick={onStatementClick}
        />
      </Theme>
    );
  }

  it('shows only the highest-severity label as a link into the Fact Check', () => {
    const onStatementClick = vi.fn();
    renderFooteredBubble(
      {
        ...VERIFICATION,
        total_claims: 4,
        partial_claims: 2,
        fabricated_claims: 1,
        omissions_count: 1,
        // Deliberately not first: the link must target by verdict severity.
        statements: [PARTIAL, OMISSION, FABRICATED],
      },
      onStatementClick
    );

    const row = screen.getByTestId('note-metrics-row');
    const links = within(row).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('1 Hallucination / Contradiction');

    // Lower-severity labels and the model-name chip are gone.
    expect(screen.queryByText(/Partially supported/)).toBeNull();
    expect(screen.queryByText(/Omission/)).toBeNull();
    expect(screen.queryByText('author-model')).toBeNull();
    expect(screen.queryByText('judge-model')).toBeNull();

    fireEvent.click(links[0]!);
    expect(onStatementClick).toHaveBeenCalledTimes(1);
    expect(onStatementClick).toHaveBeenCalledWith(MESSAGE.id, FABRICATED);
  });

  it.each([
    {
      name: 'partial outranks omission',
      counts: { partial_claims: 2, omissions_count: 1 },
      statements: [OMISSION, PARTIAL],
      label: '2 Partially supported',
      targetId: PARTIAL.id,
    },
    {
      name: 'omission-only',
      counts: { omissions_count: 3 },
      statements: [OMISSION],
      label: '3 Omissions detected',
      targetId: OMISSION.id,
    },
    {
      name: 'clean note stays a verified link',
      counts: { total_claims: 2, supported_claims: 2 },
      statements: [
        {
          ...PARTIAL,
          verdict: 'supported' as const,
          severity: 'none' as const,
        },
      ],
      label: '✓ Verified (2/2 claims)',
      targetId: PARTIAL.id,
    },
  ])('$name', ({ counts, statements, label, targetId }) => {
    const onStatementClick = vi.fn();
    renderFooteredBubble(
      {
        ...VERIFICATION,
        total_claims: 0,
        supported_claims: 0,
        partial_claims: 0,
        contradicted_claims: 0,
        fabricated_claims: 0,
        omissions_count: 0,
        ...counts,
        statements,
      },
      onStatementClick
    );

    const link = screen.getByRole('link', { name: label });
    fireEvent.click(link);
    expect(onStatementClick).toHaveBeenCalledTimes(1);
    const [, statement] = onStatementClick.mock.calls[0]!;
    expect(statement.id).toBe(targetId);
  });

  it('places the label right-aligned in the same row as the tokens display', () => {
    renderFooteredBubble(
      { ...VERIFICATION, statements: [STATEMENT] },
      () => {},
      { ...MESSAGE, completionTokens: 120, duration: 2000 }
    );

    const row = screen.getByTestId('note-metrics-row');
    expect(within(row).getByText('120 tokens (60.0 tokens/s)')).not.toBeNull();
    const link = within(row).getByRole('link', {
      name: '1 Hallucination / Contradiction',
    });
    expect(link.classList.contains('text-right')).toBe(true);
    // justify-between pushes the tokens left and the label right.
    expect(row.className).toContain('space-between');
  });

  it('cannot overflow past the note edge at narrow widths', () => {
    const { container } = renderWithClient(
      <Theme>
        <div style={{ width: 200 }}>
          <ChatMessageBubble
            message={{ ...MESSAGE, completionTokens: 120, duration: 2000 }}
            isCurrentlyStreaming={false}
            isAiResponding={false}
            renderMd={false}
            onStarClick={() => {}}
            onCopyClick={() => {}}
            verification={VERIFICATION}
            onStatementClick={() => {}}
          />
        </div>
      </Theme>
    );

    const row = screen.getByTestId('note-metrics-row');
    // The row shares the note bubble's max-width constraint...
    const constrained = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.classList.contains('max-w-[90%]')
    );
    expect(constrained.length).toBeGreaterThanOrEqual(2);
    for (const cls of ['max-w-[90%]', 'md:max-w-[85%]', 'lg:max-w-[75%]']) {
      expect(row.classList.contains(cls)).toBe(true);
      for (const el of constrained)
        expect(el.classList.contains(cls)).toBe(true);
    }
    // ...and both cells shrink with ellipsis instead of overflowing.
    const tokensCell = within(row).getByText(/tokens/).parentElement!;
    expect(tokensCell.className).toContain('min-w-0');
    const link = within(row).getByRole('link');
    expect(link.parentElement!.className).toContain('min-w-0');
    expect(link.classList.contains('truncate')).toBe(true);
    expect(link.textContent).toBe('1 Hallucination / Contradiction');
  });

  it('renders the severity as plain text without a modal entry point', () => {
    renderWithClient(
      <Theme>
        <ChatMessageBubble
          message={MESSAGE}
          isCurrentlyStreaming={false}
          isAiResponding={false}
          renderMd={false}
          onStarClick={() => {}}
          onCopyClick={() => {}}
          verification={VERIFICATION}
        />
      </Theme>
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('1 Hallucination / Contradiction')).not.toBeNull();
  });
});

describe('ChatMessageBubble failed verification', () => {
  const FAILED: MessageVerification = {
    ...VERIFICATION,
    status: 'failed',
    total_claims: 0,
    supported_claims: 0,
    fabricated_claims: 0,
    statements: [],
    error_message: 'Judge LLM timed out after 3 attempts',
  };

  function renderFailedBubble(verification: MessageVerification = FAILED) {
    return renderWithClient(
      <Theme>
        <ChatMessageBubble
          message={MESSAGE}
          isCurrentlyStreaming={false}
          isAiResponding={false}
          renderMd={false}
          onStarClick={() => {}}
          onCopyClick={() => {}}
          verification={verification}
          onStatementClick={() => {}}
        />
      </Theme>
    );
  }

  it('renders the Fact-check failed badge with the error tooltip', () => {
    const { container } = renderFailedBubble();

    const badge = screen.getByText('Fact-check failed');
    expect(badge.getAttribute('title')).toBe(
      'Judge LLM timed out after 3 attempts'
    );
    // Failed messages have no verdicts: no highlights, no severity link.
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).not.toBeNull();
  });

  it('falls back to a generic tooltip when error_message is null', () => {
    renderFailedBubble({ ...FAILED, error_message: null });

    expect(screen.getByText('Fact-check failed').getAttribute('title')).toBe(
      'Verification failed for this message'
    );
  });

  it('calls deleteMessageVerification when Clear is clicked', async () => {
    renderFailedBubble();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(mockDeleteMessageVerification).toHaveBeenCalledTimes(1);
    });
    expect(mockDeleteMessageVerification).toHaveBeenCalledWith(MESSAGE.id);
  });
});
