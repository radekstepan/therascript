// @vitest-environment jsdom
// packages/ui/src/components/LandingPage/SessionListTable.test.tsx
//
// The session row icon reflects chat + fact-check state: no chats ->
// file icon, chats -> speech bubble, fact-checked chats -> the
// ShieldCheck glyph from the chat header's Fact Check action.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import type { Session } from '../../types';
import { SessionListTable } from './SessionListTable';

// TableVirtuoso renders nothing measurable in jsdom; inline the rows so
// the real cell logic is exercised.
vi.mock('react-virtuoso', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-virtuoso')>();
  return {
    ...original,
    TableVirtuoso: (props: {
      data: Session[];
      fixedHeaderContent: () => React.ReactNode;
      itemContent: (index: number, session: Session) => React.ReactNode;
    }) => (
      <table>
        <thead>{props.fixedHeaderContent()}</thead>
        <tbody>
          {props.data.map((session, index) => (
            <tr key={session.id}>{props.itemContent(index, session)}</tr>
          ))}
        </tbody>
      </table>
    ),
  };
});

function makeSession(partial: Partial<Session> & { id: number }): Session {
  return {
    clientName: 'Jane Doe',
    sessionName: `Session ${partial.id}`,
    date: '2026-06-23',
    sessionType: 'intake',
    therapy: 'cbt',
    numSpeakers: 2,
    fileName: `s${partial.id}.mp3`,
    audioPath: null,
    status: 'completed',
    whisperJobId: null,
    chats: [],
    ...partial,
  };
}

const SESSIONS: Session[] = [
  makeSession({ id: 1, chatCount: 2, factCheckedChatCount: 1 }),
  makeSession({ id: 2, chatCount: 3, factCheckedChatCount: 0 }),
  makeSession({ id: 3, chatCount: 0 }),
];

function renderTable() {
  return render(
    <MemoryRouter>
      <Theme>
        <SessionListTable
          sessions={SESSIONS}
          sortCriteria="date"
          sortDirection="desc"
          onSort={vi.fn()}
          onEditSession={vi.fn()}
          onDeleteSessionRequest={vi.fn()}
          selectedIds={new Set()}
          onSelectionChange={vi.fn()}
        />
      </Theme>
    </MemoryRouter>
  );
}

describe('SessionListTable fact-checked icon', () => {
  it('labels the fact-checked row icon with its verified count', () => {
    renderTable();
    expect(
      screen.getByRole('img', { name: '2 chats, 1 fact-checked' })
    ).toBeTruthy();
    // A plain chatted session keeps the chats-only label.
    expect(screen.getByRole('img', { name: '3 chats' })).toBeTruthy();
    // Sessions without chats render no chat icon at all.
    expect(screen.queryByRole('img', { name: '0 chats' })).toBeNull();
  });
});
