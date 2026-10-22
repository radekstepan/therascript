// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.test.tsx
//
// The chat header's Fact Check action is an icon-only button (accent
// soft variant, like the Configure button beside it) that triggers the
// audit directly — no label text, no modal.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import { ChatPanelHeader } from './ChatPanelHeader';

function renderHeader(factCheck: {
  onFactCheck: () => void;
  isChecking: boolean;
  processedMessages: number | null;
  totalMessages: number | null;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <ChatPanelHeader
          session={null}
          activeChatId={null}
          llmStatus={undefined}
          isLoadingLlmStatus={false}
          onOpenLlmModal={vi.fn()}
          factCheck={factCheck}
        />
      </Theme>
    </QueryClientProvider>
  );
}

describe('ChatPanelHeader fact check action', () => {
  it('renders an icon-only button that audits on click', () => {
    const onFactCheck = vi.fn();
    renderHeader({
      onFactCheck,
      isChecking: false,
      processedMessages: null,
      totalMessages: null,
    });

    const button = screen.getByRole('button', { name: 'Fact Check Chat' });
    // Icon only: no visible label text inside the button.
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();

    fireEvent.click(button);
    expect(onFactCheck).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a check runs', () => {
    renderHeader({
      onFactCheck: vi.fn(),
      isChecking: true,
      processedMessages: 2,
      totalMessages: 5,
    });

    const button = screen.getByRole('button', { name: 'Fact Check Chat' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toBe('');
  });
});
