// @vitest-environment jsdom
// packages/ui/src/components/Verification/CoverageTab.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  predominantModel: 'qwen2.5-7b-instruct',
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

describe('CoverageTab accuracy display', () => {
  it('renders percent-scale accuracy with an explanatory tooltip', () => {
    renderTab();
    const badge = screen.getByText('87.5%');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toMatch(
      /Mean fact accuracy across 4 verified AI responses/
    );
  });
});

describe('CoverageTab chat LLM column', () => {
  it('renders the predominant chat model for the session', () => {
    renderTab();
    expect(
      screen.getByRole('columnheader', { name: 'Chat LLM' })
    ).toBeTruthy();
    expect(screen.getByText('qwen2.5-7b-instruct')).toBeTruthy();
  });

  it('renders a dash when no model was recorded', () => {
    render(
      <MemoryRouter>
        <Theme>
          <CoverageTab
            sessions={[{ ...SUMMARY, predominantModel: null }]}
            onAuditSession={vi.fn()}
          />
        </Theme>
      </MemoryRouter>
    );
    const header = screen.getByRole('columnheader', { name: 'Chat LLM' });
    expect(header).toBeTruthy();
    const row = screen.getByRole('row', { name: /Intake Session/ });
    expect(row.textContent).toContain('—');
  });
});

describe('CoverageTab failed verifications', () => {
  const FAILED_SUMMARY: SessionVerificationSummary = {
    ...SUMMARY,
    verifiedAiMessages: 4,
    failedAiMessages: 2,
  };

  function renderFailedTab(onVerifySession: (sessionId: number) => void) {
    return render(
      <MemoryRouter>
        <Theme>
          <CoverageTab
            sessions={[FAILED_SUMMARY]}
            onAuditSession={vi.fn()}
            onVerifySession={onVerifySession}
          />
        </Theme>
      </MemoryRouter>
    );
  }

  it('shows an X failed badge next to the coverage count', () => {
    renderFailedTab(vi.fn());
    expect(screen.getByText('2 failed')).toBeTruthy();
    expect(screen.getByText(/4 \/ 6/)).toBeTruthy();
  });

  it('renders the coverage count and failed badge on a single-line row', () => {
    renderFailedTab(vi.fn());
    const count = screen.getByText(/4 \/ 6/) as HTMLElement;
    const badge = screen.getByText('2 failed') as HTMLElement;
    const container = count.parentElement as HTMLElement | null;
    expect(container).toBeTruthy();
    // Both counts share one flex container (single row cell).
    expect(badge.parentElement).toBe(container);
    // Single-line row markers: Radix row direction class + nowrap styling.
    expect(container!.className).toMatch(/rt-r-fd-row/);
    expect(container!.style.whiteSpace).toBe('nowrap');
    // Neither child wraps internally when table width is tight.
    expect(count.style.whiteSpace).toBe('nowrap');
    expect(count.style.flexShrink).toBe('0');
    expect(badge.style.whiteSpace).toBe('nowrap');
    expect(badge.style.flexShrink).toBe('0');
    // Failed badge keeps its tooltip.
    expect(badge.getAttribute('title')).toMatch(/failed verification/);
  });

  it('calls onVerifySession when Retry Failed is clicked', () => {
    const onVerifySession = vi.fn();
    renderFailedTab(onVerifySession);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Failed' }));

    expect(onVerifySession).toHaveBeenCalledTimes(1);
    expect(onVerifySession).toHaveBeenCalledWith(FAILED_SUMMARY.sessionId);
  });

  it('retry tooltip explains the audit dialog flow', () => {
    renderFailedTab(vi.fn());

    expect(
      screen.getByRole('button', { name: 'Retry Failed' }).getAttribute('title')
    ).toContain('opens the audit dialog');
  });

  it('renders no failed badge or retry button when nothing failed', () => {
    render(
      <MemoryRouter>
        <Theme>
          <CoverageTab
            sessions={[SUMMARY]}
            onAuditSession={vi.fn()}
            onVerifySession={vi.fn()}
          />
        </Theme>
      </MemoryRouter>
    );

    expect(screen.queryByText(/failed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry Failed' })).toBeNull();
  });
});
