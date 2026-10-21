// @vitest-environment jsdom
// packages/ui/src/components/Verification/CoverageTab.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import type { SessionVerificationSummary } from '../../api/verification';
import { CoverageTab } from './CoverageTab';

const SUMMARY: SessionVerificationSummary = {
  sessionId: 1,
  sessionName: 'Intake Session',
  clientName: 'Jane Doe',
  date: '2026-06-23T12:00:00.000Z',
  totalAiMessages: 6,
  verifiedAiMessages: 4,
  isFullyVerified: false,
  flaggedIssues: 1,
  averageAccuracy: 87.5,
};

function renderTab() {
  return render(
    <MemoryRouter>
      <Theme>
        <CoverageTab sessions={[SUMMARY]} onAuditSession={vi.fn()} />
      </Theme>
    </MemoryRouter>
  );
}

describe('CoverageTab jump-to-transcript', () => {
  it('renders the session name as a link to the session view', () => {
    renderTab();
    const link = screen.getByRole('link', {
      name: 'Open transcript for Intake Session',
    });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/sessions/1');
  });
});
