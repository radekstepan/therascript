// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// inline highlight tooltips and the hallucination badge tooltip that
// open the verdict modal must point at the "Fact Check".
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';
import { ChatMessageBubble } from './ChatMessageBubble';
import type { ChatMessage } from '../../../types';
import type {
  MessageVerification,
  VerifiedStatement,
} from '../../../api/verification';

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
  return render(
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
    const { container } = render(
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
