// packages/ui/src/utils/sortSessions.test.ts
//
// Unit tests for the shared session ordering used by SessionListTable
// and SessionView prev/next navigation.

import { describe, it, expect } from 'vitest';
import {
  sortSessions,
  getSessionNeighbors,
  resolveSessionOrder,
} from './sortSessions';
import type { Session } from '../types';

// List rows can carry nulls at runtime (the tables guard with `?? ''`),
// even though the metadata type declares required strings.
type SessionOverrides = Partial<
  Omit<Session, 'sessionName' | 'clientName' | 'sessionType' | 'therapy'>
> & {
  id: number;
  sessionName?: string | null;
  clientName?: string | null;
  sessionType?: string | null;
  therapy?: string | null;
};

function makeSession(overrides: SessionOverrides): Session {
  return {
    fileName: `file-${overrides.id}.mp3`,
    audioPath: null,
    status: 'completed',
    whisperJobId: null,
    date: '2026-01-01T00:00:00.000Z',
    chats: [],
    sessionName: '',
    clientName: '',
    sessionType: '',
    therapy: '',
    ...overrides,
  } as Session;
}

describe('sortSessions', () => {
  it('sorts by date newest-first by default (desc)', () => {
    const sessions = [
      makeSession({ id: 1, date: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 2, date: '2026-06-30T00:00:00.000Z' }),
      makeSession({ id: 3, date: '2026-03-15T00:00:00.000Z' }),
    ];
    const sorted = sortSessions(sessions, 'date', 'desc');
    expect(sorted.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('inverts date order for asc (oldest first)', () => {
    const sessions = [
      makeSession({ id: 1, date: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 2, date: '2026-06-30T00:00:00.000Z' }),
    ];
    const sorted = sortSessions(sessions, 'date', 'asc');
    expect(sorted.map((s) => s.id)).toEqual([1, 2]);
  });

  it('sorts by sessionName ascending, falling back to fileName', () => {
    const sessions = [
      makeSession({ id: 1, sessionName: 'Zebra' }),
      makeSession({ id: 2, sessionName: null, fileName: 'apple.mp3' }),
      makeSession({ id: 3, sessionName: 'Mango' }),
    ];
    const sorted = sortSessions(sessions, 'sessionName', 'asc');
    expect(sorted.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('reverses non-date criteria for desc', () => {
    const sessions = [
      makeSession({ id: 1, sessionName: 'Alpha' }),
      makeSession({ id: 2, sessionName: 'Beta' }),
    ];
    const sorted = sortSessions(sessions, 'sessionName', 'desc');
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it('does not mutate the input array', () => {
    const sessions = [
      makeSession({ id: 2, date: '2026-06-30T00:00:00.000Z' }),
      makeSession({ id: 1, date: '2026-01-01T00:00:00.000Z' }),
    ];
    sortSessions(sessions, 'date', 'desc');
    expect(sessions.map((s) => s.id)).toEqual([2, 1]);
  });
});

describe('getSessionNeighbors', () => {
  const ordered = [
    makeSession({ id: 1, sessionName: 'First' }),
    makeSession({ id: 2, sessionName: 'Second' }),
    makeSession({ id: 3, sessionName: null, fileName: 'third.mp3' }),
  ];

  it('returns both neighbors for a middle session', () => {
    expect(getSessionNeighbors(ordered, 2)).toEqual({
      prev: { id: 1, name: 'First' },
      next: { id: 3, name: 'third.mp3' },
    });
  });

  it('returns null prev at the start and null next at the end', () => {
    expect(getSessionNeighbors(ordered, 1).prev).toEqual({
      id: null,
      name: null,
    });
    expect(getSessionNeighbors(ordered, 1).next).toEqual({
      id: 2,
      name: 'Second',
    });
    expect(getSessionNeighbors(ordered, 3).next).toEqual({
      id: null,
      name: null,
    });
    expect(getSessionNeighbors(ordered, 3).prev).toEqual({
      id: 2,
      name: 'Second',
    });
  });

  it('returns no neighbors for an unknown or null id', () => {
    const none = {
      prev: { id: null, name: null },
      next: { id: null, name: null },
    };
    expect(getSessionNeighbors(ordered, 999)).toEqual(none);
    expect(getSessionNeighbors(ordered, null)).toEqual(none);
    expect(getSessionNeighbors([], 1)).toEqual(none);
  });
});

describe('resolveSessionOrder', () => {
  const all = [
    makeSession({ id: 1, date: '2026-01-01T00:00:00.000Z' }),
    makeSession({ id: 2, date: '2026-06-30T00:00:00.000Z' }),
    makeSession({ id: 3, date: '2026-03-15T00:00:00.000Z' }),
  ];

  it('prefers the table order from router state', () => {
    // Filtered table showing only sessions 3 and 1, in that row order.
    expect(resolveSessionOrder(all, 1, [3, 1], 'date', 'desc')).toEqual([
      all[2],
      all[0],
    ]);
  });

  it('drops deleted ids from the state order but keeps the rest', () => {
    expect(resolveSessionOrder(all, 1, [3, 999, 1], 'date', 'desc')).toEqual([
      all[2],
      all[0],
    ]);
  });

  it('falls back to the global sort without router state', () => {
    // date desc = newest first: 2, 3, 1.
    expect(
      resolveSessionOrder(all, 1, undefined, 'date', 'desc').map((s) => s.id)
    ).toEqual([2, 3, 1]);
  });

  it('falls back when the state order no longer contains the session', () => {
    expect(
      resolveSessionOrder(all, 1, [2, 3], 'date', 'desc').map((s) => s.id)
    ).toEqual([2, 3, 1]);
  });

  it('falls back on malformed router state', () => {
    for (const bad of ['nope', [1, 'two'], null, 42]) {
      expect(
        resolveSessionOrder(all, 1, bad, 'date', 'desc').map((s) => s.id)
      ).toEqual([2, 3, 1]);
    }
  });
});
