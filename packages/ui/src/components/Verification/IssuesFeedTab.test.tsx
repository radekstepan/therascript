// @vitest-environment jsdom
// packages/ui/src/components/Verification/IssuesFeedTab.test.tsx
//
// The session name in each issue card renders as a transcript link
// (accent color + hover underline, like the coverage table) and
// navigating through it must not also trigger the card's own
// navigate-to-chat handler.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import type {
  FlaggedStatementItem,
  FlaggedStatementsResult,
} from '../../api/verification';
import { fetchFlaggedStatements } from '../../api/verification';
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
    review_status: 'unreviewed',
    confirmed_at: null,
    review_id: null,
    review_token: 'v1.feed-token',
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

function renderTab(clients: string[] = ['Jane Doe']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/verification']}>
          <Theme>
            <IssuesFeedTab models={['llama']} clients={clients} />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    ),
    queryClient,
  };
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

describe('IssuesFeedTab client filter', () => {
  beforeEach(() => {
    vi.mocked(fetchFlaggedStatements).mockClear();
    // Radix Select reaches for these on open; jsdom lacks them.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it('refetches with the selected client', async () => {
    const user = userEvent.setup();
    renderTab(['Jane Doe', 'John Smith']);
    await screen.findByText('The patient takes aspirin daily.');

    await user.click(
      screen.getByRole('combobox', { name: 'Filter by client' })
    );
    await user.click(screen.getByRole('option', { name: 'John Smith' }));

    await waitFor(() => {
      expect(vi.mocked(fetchFlaggedStatements)).toHaveBeenCalledWith(
        expect.objectContaining({ clientName: 'John Smith' })
      );
    });
  });
});

describe('IssuesFeedTab refreshing indicator', () => {
  it('keeps the indicator mounted and toggles opacity (no layout shift)', async () => {
    const { queryClient } = renderTab();
    await screen.findByText('The patient takes aspirin daily.');

    // Idle: the indicator stays in the layout, transparent.
    const indicator = screen.getByText(/refreshing/);
    expect(indicator.style.opacity).toBe('0');

    // A background refetch fades the SAME node in (no remount flicker).
    let resolveRefetch!: (value: FlaggedStatementsResult) => void;
    vi.mocked(fetchFlaggedStatements).mockImplementationOnce(
      () =>
        new Promise<FlaggedStatementsResult>((resolve) => {
          resolveRefetch = resolve;
        })
    );
    // Fire-and-forget: awaiting would deadlock on the deferred fetch below.
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ['verificationStatements'],
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/refreshing/).style.opacity).toBe('1');
    });
    expect(screen.getByText(/refreshing/)).toBe(indicator);

    resolveRefetch({ items: [ITEM], total: 1, limit: 25, offset: 0 });
    await waitFor(() => {
      expect(screen.getByText(/refreshing/).style.opacity).toBe('0');
    });
  });
});

describe('IssuesFeedTab pagination clamp', () => {
  beforeEach(() => {
    vi.mocked(fetchFlaggedStatements).mockReset();
  });

  it('returns to the last non-empty page when dismissals shrink the feed', async () => {
    const fetchMock = vi.mocked(fetchFlaggedStatements);
    fetchMock.mockImplementation(async (params) => ({
      items: [ITEM],
      total: 26,
      limit: 25,
      offset: params?.offset ?? 0,
    }));
    const { queryClient } = renderTab();
    expect(await screen.findByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeTruthy();

    // Dismissing the last issue on page 2 elsewhere shrinks the feed.
    fetchMock.mockImplementation(async (params) => ({
      items: [ITEM],
      total: 1,
      limit: 25,
      offset: params?.offset ?? 0,
    }));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ['verificationStatements'],
      });
    });

    // Clamped back to page 1 (single-page feed hides pagination)
    // instead of stranding the user on an empty page 2.
    await waitFor(() => {
      expect(screen.queryByText('Page 2 of 2')).toBeNull();
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0 })
    );
    expect(
      await screen.findByRole('link', { name: /View Fabricated issue in chat/ })
    ).toBeTruthy();
  });
});
