// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx
//
// Regression test for the "Judge Verdict" -> "Fact Check" rename: the
// inline highlight tooltips and the hallucination badge tooltip that
// open the verdict modal must point at the "Fact Check".
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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
