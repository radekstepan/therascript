// @vitest-environment jsdom
// packages/ui/src/components/Verification/VerificationAnalyticsSection.test.tsx
//
// The accuracy visualizations stack vertically with the over-time chart
// first: chart card, then the per-LLM table (previously side-by-side
// with the table on the left).
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import type { VerificationGlobalStats } from '../../api/verification';
import { VerificationAnalyticsSection } from './VerificationAnalyticsSection';

const STATS: VerificationGlobalStats = {
  totalMessagesAudited: 2,
  overallAccuracyPercent: 90,
  totalClaims: 10,
  supportedClaims: 9,
  partialClaims: 0,
  contradictedClaims: 1,
  fabricatedClaims: 0,
  omissions: 0,
  unverifiedMessagesCount: 0,
  byModel: [],
  overTime: [],
  sessionsSummary: [],
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <VerificationAnalyticsSection stats={STATS} />
      </Theme>
    </QueryClientProvider>
  );
}

describe('VerificationAnalyticsSection stacking', () => {
  it('renders the over-time chart above the per-LLM table', () => {
    renderSection();
    const chartHeading = screen.getByRole('heading', {
      name: 'Accuracy & Hallucinations Over Time',
    });
    const tableHeading = screen.getByRole('heading', {
      name: 'Accuracy by Authoring LLM',
    });

    // Chart precedes the table in document order inside one stack.
    expect(
      chartHeading.compareDocumentPosition(tableHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const stack = screen.getByTestId('accuracy-stack');
    expect(stack.contains(chartHeading)).toBe(true);
    expect(stack.contains(tableHeading)).toBe(true);
  });
});
