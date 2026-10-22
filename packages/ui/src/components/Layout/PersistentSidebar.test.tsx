// @vitest-environment jsdom
// packages/ui/src/components/Layout/PersistentSidebar.test.tsx
//
// Regression test: the sidebar "Active Jobs" count badge must use the
// app's standard subtly-rounded rectangle (theme default radius), not a
// full-radius oval/pill. Radix Badge renders its `radius` prop as a
// `data-radius` attribute; badges elsewhere in the app (Fact Check,
// Analysis) omit `radius` and inherit the theme default, so this badge
// must not set `data-radius="full"`.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { PersistentSidebar } from './PersistentSidebar';

vi.mock('../../api/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/api')>();
  return {
    ...original,
    fetchActiveJobCount: vi.fn().mockResolvedValue({
      total: 3,
      transcription: 1,
      analysis: 1,
      verification: 1,
    }),
    fetchGpuStats: vi.fn().mockResolvedValue(null),
    fetchLlmStatus: vi.fn().mockResolvedValue({ loadedModels: [] }),
  };
});

vi.mock('../../api/session', () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/chat', () => ({
  fetchStandaloneChats: vi.fn().mockResolvedValue([]),
}));

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Theme>
            <PersistentSidebar />
          </Theme>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('PersistentSidebar active-jobs badge', () => {
  it('renders the count badge as a subtly-rounded rectangle, not a full-radius oval', async () => {
    renderSidebar();

    const badge = await screen.findByText('3');

    expect(badge).not.toBeNull();
    expect(badge.getAttribute('data-radius')).not.toBe('full');
  });
});
