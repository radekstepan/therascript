// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.test.tsx
//
// The chat header shows a passive all-verified status icon (never an
// actionable "Fact Check Chat" button): visible only when every
// eligible AI note in the selected transcript chat has a `completed`
// verification, with chat-scoped stats on hover/focus.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import { ChatPanelHeader } from './ChatPanelHeader';
import type { ChatMessage, Session } from '../../../types';
import type { MessageVerification } from '../../../api/verification';

const { VERIFICATIONS, fetchChatVerificationsMock } = vi.hoisted(() => {
  const make = (
    messageId: number,
    chatId: number,
    overrides?: Partial<MessageVerification>
  ): MessageVerification => ({
    id: messageId * 10 + chatId,
    message_id: messageId,
    chat_id: chatId,
    session_id: 1,
    verification_job_id: 7,
    authored_model: 'llama',
    judge_model: 'judge-1',
    status: 'completed',
    total_claims: 2,
    supported_claims: 2,
    partial_claims: 0,
    contradicted_claims: 0,
    fabricated_claims: 0,
    omissions_count: 0,
    accuracy_score: 1,
    summary_assessment: null,
    prompt_tokens: null,
    completion_tokens: null,
    duration_ms: null,
    verified_at: 1,
    error_message: null,
    ...overrides,
  });
  return {
    VERIFICATIONS: { make },
    fetchChatVerificationsMock: vi.fn(),
  };
});

vi.mock('../../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../api/verification')>();
  return {
    ...original,
    fetchChatVerifications: fetchChatVerificationsMock,
  };
});

vi.mock('../../../api/chat', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/chat')>();
  return {
    ...original,
    // TanStack Query v5 forbids `undefined` query data, so fail the
    // context-usage fetch instead of resolving empty.
    fetchSessionContextUsage: vi
      .fn()
      .mockRejectedValue(new Error('no context usage in test')),
  };
});

const SESSION: Session = {
  id: 1,
  clientName: 'Client',
  sessionName: 'Session',
  date: '2024-01-01',
  sessionType: 'intake',
  therapy: 'cbt',
  numSpeakers: 2,
  fileName: 'audio.mp3',
  audioPath: null,
  status: 'completed',
  whisperJobId: null,
  chats: [],
};

const user = (id: number): ChatMessage => ({
  id,
  chatId: 5,
  sender: 'user',
  text: 'What did the patient say?',
  timestamp: id,
});

const ai = (
  id: number,
  text = 'The patient reports low mood.'
): ChatMessage => ({
  id,
  chatId: 5,
  sender: 'ai',
  text,
  timestamp: id,
  completionTokens: 10,
});

// Two eligible AI notes; the second has a flagged (fabricated) claim but
// a completed assessment still counts as checked.
const CHECKED_MESSAGES: ChatMessage[] = [user(1), ai(2), user(3), ai(4)];
const CHECKED_VERIFICATIONS: MessageVerification[] = [
  VERIFICATIONS.make(2, 5),
  VERIFICATIONS.make(4, 5, {
    total_claims: 4,
    supported_claims: 2,
    partial_claims: 1,
    fabricated_claims: 1,
    omissions_count: 1,
    accuracy_score: 0.5,
  }),
];

function renderHeader(
  messages: ChatMessage[],
  options?: { session?: Session | null; chatId?: number | null }
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  const session = options?.session === undefined ? SESSION : options.session;
  const chatId = options?.chatId === undefined ? 5 : options.chatId;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <ChatPanelHeader
          session={session}
          activeChatId={chatId}
          llmStatus={undefined}
          isLoadingLlmStatus={false}
          onOpenLlmModal={vi.fn()}
          messages={messages}
        />
      </Theme>
    </QueryClientProvider>
  );
  const rerenderMessages = (
    nextMessages: ChatMessage[],
    nextChatId: number | null = chatId
  ) => {
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ChatPanelHeader
            session={session}
            activeChatId={nextChatId}
            llmStatus={undefined}
            isLoadingLlmStatus={false}
            onOpenLlmModal={vi.fn()}
            messages={nextMessages}
          />
        </Theme>
      </QueryClientProvider>
    );
  };
  return { ...view, rerenderMessages };
}

const verifiedIcon = () =>
  screen.queryByRole('img', { name: 'All 2 chat notes fact-checked' });

beforeEach(() => {
  fetchChatVerificationsMock.mockReset();
  fetchChatVerificationsMock.mockResolvedValue(CHECKED_VERIFICATIONS);
});

describe('ChatPanelHeader verified-status icon', () => {
  it('shows a passive icon when every eligible note is checked', async () => {
    renderHeader(CHECKED_MESSAGES);
    const icon = await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    // Passive indicator, not a button: a span trigger with no click action.
    expect(icon.tagName).toBe('SPAN');
    expect(icon.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByRole('button', { name: /fact check/i })).toBeNull();
    // Clicking must not start verification: no extra fetch, no mutation.
    const callsBefore = fetchChatVerificationsMock.mock.calls.length;
    fireEvent.click(icon);
    expect(fetchChatVerificationsMock.mock.calls.length).toBe(callsBefore);
  });

  // Radix Themes renders tooltip content twice in the DOM (visible
  // copy plus an accessibility copy), so tooltip assertions use the
  // *AllByText variants.
  const tooltipLine = (text: string) => {
    const matches = screen.getAllByText(text);
    expect(matches.length).toBeGreaterThan(0);
  };

  it('exposes chat-scoped stats on keyboard focus', async () => {
    renderHeader(CHECKED_MESSAGES);
    const icon = await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    fireEvent.focus(icon);
    // Totals: 2 + 4 claims; 2 + 2 supported; 1 partial; 1 fabricated; 1 omission.
    await screen.findAllByText('Checked 2 / 2 notes');
    tooltipLine('Failed: 0');
    tooltipLine(
      'Claims — supported: 4, partial: 1, contradicted: 0, fabricated: 1'
    );
    tooltipLine('Omissions: 1');
    // Pooled: (4 + 0.5 * 1) / (6 + 1) * 100 = 64.2857…%.
    tooltipLine('Accuracy: 64.3%');
  });

  it('exposes the same stats on hover', async () => {
    renderHeader(CHECKED_MESSAGES);
    const icon = await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    // Radix opens hover tooltips on pointermove (after its open delay).
    fireEvent.pointerMove(icon);
    await screen.findAllByText('Checked 2 / 2 notes', undefined, {
      timeout: 2500,
    });
    tooltipLine('Accuracy: 64.3%');
    // No pointerleave: Radix reads pointer coordinates on leave, which
    // jsdom cannot provide; unmount cleanup closes the tooltip.
  });

  it('labels unknown accuracy instead of showing zero', async () => {
    fetchChatVerificationsMock.mockResolvedValue([
      VERIFICATIONS.make(2, 5, {
        total_claims: 0,
        supported_claims: 0,
        omissions_count: 0,
        accuracy_score: 1,
      }),
    ]);
    renderHeader([user(1), ai(2, 'Hello! How can I help you today?')]);
    const icon = await screen.findByRole('img', {
      name: 'All 1 chat notes fact-checked',
    });
    fireEvent.focus(icon);
    await screen.findAllByText('Accuracy: unknown (no claims assessed)');
    expect(screen.queryByText('Accuracy: 0%')).toBeNull();
    expect(screen.queryByText('Accuracy: 0.0%')).toBeNull();
  });

  it('hides the icon when a note is unchecked', async () => {
    fetchChatVerificationsMock.mockResolvedValue([CHECKED_VERIFICATIONS[0]!]);
    renderHeader(CHECKED_MESSAGES);
    await waitFor(() => expect(fetchChatVerificationsMock).toHaveBeenCalled());
    await waitFor(() => expect(verifiedIcon()).toBeNull());
  });

  it('hides the icon when a note failed verification', async () => {
    fetchChatVerificationsMock.mockResolvedValue([
      CHECKED_VERIFICATIONS[0]!,
      VERIFICATIONS.make(4, 5, {
        status: 'failed',
        error_message: 'Judge returned invalid JSON',
      }),
    ]);
    renderHeader(CHECKED_MESSAGES);
    await waitFor(() => expect(fetchChatVerificationsMock).toHaveBeenCalled());
    await waitFor(() => expect(verifiedIcon()).toBeNull());
  });

  it('hides the icon for empty chats', async () => {
    renderHeader([]);
    await waitFor(() => expect(fetchChatVerificationsMock).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: /fact-checked/ })).toBeNull();
  });

  it('hides the icon when no AI note is eligible', async () => {
    renderHeader([
      {
        id: 1,
        chatId: 5,
        sender: 'ai',
        text: 'Session "Intake" has been transcribed and is ready for analysis.',
        timestamp: 1,
        completionTokens: null,
      },
      user(2),
    ]);
    await waitFor(() => expect(fetchChatVerificationsMock).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: /fact-checked/ })).toBeNull();
  });

  it('hides the icon immediately when a new unchecked note is added', async () => {
    const { rerenderMessages } = renderHeader(CHECKED_MESSAGES);
    await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    rerenderMessages([...CHECKED_MESSAGES, user(5), ai(6, 'A fresh note.')]);
    await waitFor(() => expect(verifiedIcon()).toBeNull());
  });

  it('hides the icon while a new note is still streaming', async () => {
    const { rerenderMessages } = renderHeader(CHECKED_MESSAGES);
    await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    // Optimistic pair appended on send: empty AI text, negative temp ids.
    rerenderMessages([
      ...CHECKED_MESSAGES,
      { ...user(7), id: -7 },
      { ...ai(8, ''), id: -8 },
    ]);
    await waitFor(() => expect(verifiedIcon()).toBeNull());
  });

  it('refreshes totals when switching chats', async () => {
    fetchChatVerificationsMock.mockImplementation(
      async (_sessionId: number, chatId: number) =>
        chatId === 5 ? CHECKED_VERIFICATIONS : [VERIFICATIONS.make(20, 6)]
    );
    const { rerenderMessages } = renderHeader(CHECKED_MESSAGES);
    await screen.findByRole('img', {
      name: 'All 2 chat notes fact-checked',
    });
    rerenderMessages(
      [
        { ...user(10), chatId: 6 },
        { ...ai(20), chatId: 6 },
      ],
      6
    );
    const icon = await screen.findByRole('img', {
      name: 'All 1 chat notes fact-checked',
    });
    fireEvent.focus(icon);
    await screen.findAllByText('Checked 1 / 1 notes');
    tooltipLine(
      'Claims — supported: 2, partial: 0, contradicted: 0, fabricated: 0'
    );
  });

  it('shows no transcript verification icon without a session chat', async () => {
    // Standalone chats never render this header; a null session/chat id
    // also disables the query so nothing renders.
    renderHeader(CHECKED_MESSAGES, { session: null, chatId: null });
    await waitFor(() =>
      expect(fetchChatVerificationsMock).not.toHaveBeenCalled()
    );
    expect(screen.queryByRole('img', { name: /fact-checked/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /fact check/i })).toBeNull();
  });
});
