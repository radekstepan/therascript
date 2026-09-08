// @vitest-environment jsdom
// packages/ui/src/components/LandingPage/DashboardStats.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';
import type { Session } from '../../types';
import { DashboardStats } from './DashboardStats';

function makeSession(partial: Partial<Session> & { id: number }): Session {
  return {
    clientName: '',
    sessionName: `Session ${partial.id}`,
    date: '2026-09-01T10:00:00.000Z',
    sessionType: '',
    therapy: '',
    numSpeakers: 2,
    fileName: `s${partial.id}.mp3`,
    audioPath: null,
    status: 'completed',
    whisperJobId: null,
    duration: 3600,
    transcriptTokenCount: 7000,
    chats: [],
    ...partial,
  };
}

describe('DashboardStats', () => {
  it('renders the four stat cards with real totals', () => {
    const sessions = [
      makeSession({ id: 1, clientName: 'Alice' }),
      makeSession({ id: 2, clientName: 'Bob' }),
    ];
    render(
      <Theme>
        <DashboardStats sessions={sessions} />
      </Theme>
    );
    for (const label of [
      'Sessions',
      'Hours transcribed',
      'Active clients',
      'Avg. session',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Real totals: 2 sessions, 2h, 2 clients, 60m avg.
    expect(screen.getByText('2h')).toBeTruthy();
  });

  it('renders empty state without crashing', () => {
    render(
      <Theme>
        <DashboardStats sessions={[]} />
      </Theme>
    );
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('No durations yet')).toBeTruthy();
  });
});
