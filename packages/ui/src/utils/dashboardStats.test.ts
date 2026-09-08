// packages/ui/src/utils/dashboardStats.test.ts
import { describe, it, expect } from 'vitest';
import type { Session } from '../types';
import {
  computeDashboardStats,
  formatHoursLabel,
  formatSessionLengthLabel,
} from './dashboardStats';

const NOW = new Date('2026-09-08T12:00:00');

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
    duration: null,
    transcriptTokenCount: null,
    chats: [],
    ...partial,
  };
}

describe('computeDashboardStats', () => {
  it('returns zero state for no sessions', () => {
    const s = computeDashboardStats([], NOW);
    expect(s.totalSessions).toBe(0);
    expect(s.sessionsThisMonth).toBe(0);
    expect(s.sessionsByMonth).toHaveLength(12);
    expect(s.totalHoursLabel).toBe('0h');
    expect(s.activeClients).toBe(0);
    expect(s.avgSessionLabel).toBe('–');
    expect(s.avgTokens).toBeNull();
  });

  it('counts sessions this month and buckets trailing 12 months', () => {
    const sessions = [
      makeSession({ id: 1, date: '2026-09-02T10:00:00.000Z' }),
      makeSession({ id: 2, date: '2026-09-05T10:00:00.000Z' }),
      makeSession({ id: 3, date: '2026-08-15T10:00:00.000Z' }),
      // Invalid dates still count toward the total, not the buckets.
      makeSession({ id: 4, date: 'not-a-date' }),
    ];
    const s = computeDashboardStats(sessions, NOW);
    expect(s.totalSessions).toBe(4);
    expect(s.sessionsThisMonth).toBe(2);
    // Buckets are oldest → newest; last = Sep 2026, second-last = Aug 2026.
    expect(s.sessionsByMonth[11]).toBe(2);
    expect(s.sessionsByMonth[10]).toBe(1);
    expect(s.sessionsByMonth.slice(0, 10).every((v) => v === 0)).toBe(true);
  });

  it('sums hours and tracks transcription progress', () => {
    const sessions = [
      makeSession({ id: 1, duration: 3600, status: 'completed' }),
      makeSession({ id: 2, duration: 1800, status: 'completed' }),
      makeSession({ id: 3, status: 'transcribing' }),
      makeSession({ id: 4, status: 'queued' }),
    ];
    const s = computeDashboardStats(sessions, NOW);
    expect(s.totalSeconds).toBe(5400);
    expect(s.totalHoursLabel).toBe('1.5h');
    expect(s.completedCount).toBe(2);
    expect(s.transcribingCount).toBe(2);
  });

  it('counts distinct clients and newcomers this month', () => {
    const sessions = [
      makeSession({ id: 1, clientName: 'Alice', date: '2026-09-02T10:00:00Z' }),
      makeSession({ id: 2, clientName: 'Alice', date: '2026-08-01T10:00:00Z' }),
      makeSession({ id: 3, clientName: 'Bob', date: '2026-06-01T10:00:00Z' }),
    ];
    const s = computeDashboardStats(sessions, NOW);
    expect(s.activeClients).toBe(2);
    // Alice's first session was in August, Bob's in June — no newcomers.
    expect(s.newClientsThisMonth).toBe(0);

    const s2 = computeDashboardStats(
      [
        makeSession({
          id: 9,
          clientName: 'Cara',
          date: '2026-09-01T10:00:00Z',
        }),
      ],
      NOW
    );
    expect(s2.activeClients).toBe(1);
    expect(s2.newClientsThisMonth).toBe(1);
  });

  it('computes avg/median session length and avg tokens', () => {
    const sessions = [
      makeSession({ id: 1, duration: 3000, transcriptTokenCount: 6000 }),
      makeSession({ id: 2, duration: 3600, transcriptTokenCount: 8000 }),
      makeSession({ id: 3, duration: 3300, transcriptTokenCount: 7000 }),
    ];
    const s = computeDashboardStats(sessions, NOW);
    expect(s.avgSessionLabel).toBe('55m');
    expect(s.medianSessionLabel).toBe('55m');
    expect(s.avgTokens).toBe(7000);
  });
});

describe('labels', () => {
  it('formats hours compactly', () => {
    expect(formatHoursLabel(0)).toBe('0h');
    expect(formatHoursLabel(5400)).toBe('1.5h');
    expect(formatHoursLabel(214 * 3600)).toBe('214h');
  });

  it('formats session lengths compactly', () => {
    expect(formatSessionLengthLabel(3120)).toBe('52m');
    expect(formatSessionLengthLabel(4500)).toBe('1h 15m');
    expect(formatSessionLengthLabel(3600)).toBe('1h');
  });
});
