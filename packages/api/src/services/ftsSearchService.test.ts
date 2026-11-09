// @vitest-environment node
// packages/api/src/services/ftsSearchService.test.ts
//
// Route-contract tests for the vault FTS search path: response shape,
// type filters, pagination, client filter, and merged 'all' ordering.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  initializeDatabase,
  attachUnlockedDb,
  closeDb,
  run,
  get,
  type SQLiteDatabase,
} from '@therascript/db';
import { searchAllFts } from './ftsSearchService.js';

function addSession(clientName: string): number {
  const info = run(
    `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status)
     VALUES ('a.mp3', ?, 'S', '2024-01-01', 'intake', 'cbt', 'completed')`,
    clientName
  );
  return info.lastInsertRowid as number;
}

function addParagraph(sessionId: number, index: number, text: string): void {
  run(
    `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text)
     VALUES (?, ?, ?, ?)`,
    sessionId,
    index,
    1000 * (index + 1),
    text
  );
}

function addChat(sessionId: number | null): number {
  return run(
    `INSERT INTO chats (sessionId, timestamp) VALUES (?, ?)`,
    sessionId,
    1
  ).lastInsertRowid as number;
}

function addMessage(chatId: number, sender: string, text: string): void {
  run(
    `INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, ?, ?, ?)`,
    chatId,
    sender,
    text,
    1
  );
}

beforeAll(() => {
  const connection = new Database(':memory:') as unknown as SQLiteDatabase;
  initializeDatabase(connection);
  attachUnlockedDb(connection);

  const alice = addSession('Alice');
  addParagraph(alice, 0, 'the patient reports severe anxiety at night');
  addParagraph(alice, 1, 'weekend plans look fine');
  const bob = addSession('Bob');
  addParagraph(bob, 0, 'bob mentions anxiety briefly');
  const chat = addChat(alice);
  addMessage(chat, 'ai', 'try grounding exercises for anxiety');
  const standalone = addChat(null);
  addMessage(standalone, 'user', 'shopping list, nothing clinical');
});

afterAll(() => {
  closeDb();
});

describe('searchAllFts', () => {
  it('maps transcript hits to the legacy response shape', () => {
    const response = searchAllFts({
      query: 'anxiety',
      limit: 20,
      from: 0,
      searchType: 'transcript',
    });
    expect(response.query).toBe('Search/filter applied');
    expect(response.total).toBe(2);
    const [first] = response.results;
    expect(first).toMatchObject({
      type: 'transcript',
      chatId: null,
      sender: null,
      tags: null,
    });
    expect(first!.id).toMatch(/^\d+_\d+$/);
    expect(first!.snippet).toContain('<mark>anxiety</mark>');
    expect(first!.highlights).toEqual({ text: [first!.snippet] });
    expect(typeof first!.score).toBe('number');
    // bm25 ranks the shorter Bob paragraph first; both clients are present.
    expect(response.results.map((row) => row.clientName).sort()).toEqual([
      'Alice',
      'Bob',
    ]);
  });

  it('maps chat hits with sender and parsed tags', () => {
    const response = searchAllFts({
      query: 'anxiety',
      limit: 20,
      from: 0,
      searchType: 'chat',
    });
    expect(response.total).toBe(1);
    expect(response.results[0]).toMatchObject({
      type: 'chat',
      sender: 'ai',
      clientName: 'Alice',
      tags: null,
    });
  });

  it('merges both indexes for searchType all with pagination', () => {
    const all = searchAllFts({ query: 'anxiety', limit: 20, from: 0 });
    expect(all.total).toBe(3);
    expect(all.results).toHaveLength(3);
    const page = searchAllFts({ query: 'anxiety', limit: 2, from: 1 });
    expect(page.total).toBe(3);
    expect(page.results).toHaveLength(2);
  });

  it('honors the clientName filter', () => {
    const response = searchAllFts({
      query: 'anxiety',
      limit: 20,
      from: 0,
      clientName: 'Bob',
    });
    expect(response.total).toBe(1);
    expect(response.results[0]!.type).toBe('transcript');
  });

  it('returns filter-only results without highlights', () => {
    const response = searchAllFts({
      query: '',
      limit: 20,
      from: 0,
      clientName: 'Alice',
      searchType: 'transcript',
    });
    expect(response.total).toBe(2);
    expect(response.results[0]!.score).toBeUndefined();
    expect(response.results[0]!.highlights).toBeUndefined();
  });

  it('never throws on hostile input', () => {
    for (const query of ['"', '*', 'OR', 'title:', 'NEAR(', 'a"b']) {
      expect(() => searchAllFts({ query, limit: 20, from: 0 })).not.toThrow();
    }
    expect(
      get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')
    ).toEqual({
      total: 2,
    });
  });
});
