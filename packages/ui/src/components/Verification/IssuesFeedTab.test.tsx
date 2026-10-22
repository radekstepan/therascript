// @vitest-environment jsdom
// packages/ui/src/components/Verification/IssuesFeedTab.test.tsx
//
// The session name in each issue card renders as a transcript link
// (accent color + hover underline, like the coverage table) and
// navigating through it must not also trigger the card's own
// navigate-to-chat handler.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import type { FlaggedStatementItem } from '../../api/verification';
import { IssuesFeedTab } from './IssuesFeedTab';

const { ITEM } = vi.hoisted(() => {
  const item: FlaggedStatementItem = {
    id: 301,
    message_verification_id: 201,
    message_id: 12,
    session_id: 9,
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
    sessionName: 'Intake Session',
    clientName: 'Jane Doe',
    chatId: 5,
    authoredModel: 'llama',
    judgeModel: 'judge-1',
    verifiedAt: 3000,
  };
  return { ITEM: item };
});

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('../../api/verification', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../api/verification')>();
  return {
    ...original,
    fetchFlaggedStatements: vi
      .fn()
      .mockResolvedValue({ items: [ITEM], total: 1, limit: 25, offset: 0 }),
  };
});

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/verification']}>
        <Theme>
          <IssuesFeedTab models={['llama']} />
        </Theme>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IssuesFeedTab session link', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
  });

  it('renders the session name as a transcript link', async () => {
    renderTab();
    const link = await screen.findByRole('link', {
      name: 'Open transcript for Intake Session',
    });
    expect(link.getAttribute('href')).toBe('/sessions/9');
  });

  it('keeps the session link off the card navigation', async () => {
    renderTab();
    const link = await screen.findByRole('link', {
      name: 'Open transcript for Intake Session',
    });
    fireEvent.click(link);
    // The Link navigates through the router on its own; the card's
    // chat deep-link (stopPropagation) must stay silent.
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates to the chat when the card body is clicked', async () => {
    renderTab();
    const card = await screen.findByRole('link', {
      name: /View Fabricated issue in chat/,
    });
    fireEvent.click(card);
    expect(navigateSpy).toHaveBeenCalledWith(
      '/sessions/9/chats/5?highlightMsg=12'
    );
  });
});
