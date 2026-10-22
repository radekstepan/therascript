// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatMessages.test.tsx
//
// Regression test: SessionContent mounts ChatMessages twice (desktop
// side-by-side + mobile tabs, CSS-toggled). Both instances used to
// consume ?highlightMsg, and since Radix Dialogs portal to the body,
// two stacked Fact Check modals opened. Only the viewport-matching
// instance may consume the deep-link.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import type { ChatMessage } from '../../../types';
import type {
  MessageVerification,
  VerifiedStatement,
} from '../../../api/verification';
import { ChatMessages } from './ChatMessages';

const MESSAGES: ChatMessage[] = [
  {
    id: 11,
    chatId: 5,
    sender: 'user',
    text: 'What medication does the patient take?',
    timestamp: 1000,
  },
  {
    id: 12,
    chatId: 5,
    sender: 'ai',
    text: 'The patient takes aspirin daily.',
    timestamp: 2000,
    completionTokens: 10,
    duration: 100,
  },
];

const { VERIFICATION } = vi.hoisted(() => {
  const statement: VerifiedStatement = {
    id: 101,
    message_verification_id: 201,
    message_id: 12,
    session_id: 1,
    statement_index: 0,
    kind: 'claim',
    exact_quote: 'takes aspirin daily',
    normalized_claim: 'The patient takes aspirin daily.',
    start_char: 12,
    end_char: 31,
    verdict: 'fabricated',
    severity: 'high',
    confidence: 0.9,
    reasoning: 'No such medication in the transcript.',
    transcript_evidence_json: null,
    created_at: 3000,
  };
  const verification: MessageVerification = {
    id: 201,
    message_id: 12,
    chat_id: 5,
    session_id: 1,
    verification_job_id: 7,
    authored_model: 'llama',
    judge_model: 'judge-1',
    status: 'completed',
    total_claims: 1,
    supported_claims: 0,
    partial_claims: 0,
    contradicted_claims: 0,
    fabricated_claims: 1,
    omissions_count: 0,
    accuracy_score: 0,
    summary_assessment: 'One fabrication.',
    prompt_tokens: 10,
    completion_tokens: 5,
    duration_ms: 100,
    verified_at: 3000,
    error_message: null,
    statements: [statement],
  };
  return { VERIFICATION: verification };
});

vi.mock('../../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../api/verification')>();
  return {
    ...original,
    fetchChatVerifications: vi.fn().mockResolvedValue([VERIFICATION]),
  };
});

/** jsdom has no layout; emulate a desktop or mobile viewport. */
function mockViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Mirror SessionContent: a desktop and a mobile instance at once. */
function renderDualMount() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  const props = {
    messages: MESSAGES,
    activeChatId: 5,
    isStandalone: false,
    streamingMessageId: null,
    activeSessionId: 1,
    isAiResponding: false,
  };
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/1/chats/5?highlightMsg=12']}>
          <Theme>
            <ChatMessages {...props} layout="desktop" />
            <ChatMessages {...props} layout="mobile" />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('ChatMessages highlightMsg deep-link', () => {
  // Raw DOM query: stacked Radix dialogs aria-hide each other, so
  // role queries undercount the double-modal bug this guards against.
  const dialogCount = () => document.querySelectorAll('[role="dialog"]').length;

  it('opens exactly one verdict modal on a desktop viewport', async () => {
    mockViewport(true);
    renderDualMount();
    await waitFor(() => expect(dialogCount()).toBeGreaterThan(0));
    expect(dialogCount()).toBe(1);
  });

  it('opens exactly one verdict modal on a mobile viewport', async () => {
    mockViewport(false);
    renderDualMount();
    await waitFor(() => expect(dialogCount()).toBeGreaterThan(0));
    expect(dialogCount()).toBe(1);
  });
});
