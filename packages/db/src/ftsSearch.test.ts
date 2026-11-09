// @vitest-environment node
// packages/db/src/ftsSearch.test.ts
//
// FTS5 search indexes: V25 migration, content-sync triggers,
// snippet/rank output, filters, pagination, rebuild, and the v24→v25
// upgrade backfill. Drives the real better-sqlite3 engine.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initializeDatabase,
  searchTranscriptsFts,
  searchMessagesFts,
  rebuildTranscriptSearch,
  rebuildMessageSearch,
  rebuildAllSearchIndexes,
  LATEST_SCHEMA_VERSION,
} from './sqliteService.js';

function seedSession(
  db: DB,
  overrides: { clientName?: string; sessionName?: string } = {}
): number {
  const info = db
    .prepare(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status)
       VALUES ('a.mp3', ?, ?, '2024-01-01', 'intake', 'cbt', 'completed')`
    )
    .run(overrides.clientName ?? 'Alice', overrides.sessionName ?? 'S1');
  return info.lastInsertRowid as number;
}

function seedParagraph(
  db: DB,
  sessionId: number,
  index: number,
  text: string,
  timestampMs = 1000
): void {
  db.prepare(
    `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text)
     VALUES (?, ?, ?, ?)`
  ).run(sessionId, index, timestampMs, text);
}

function seedChat(db: DB, sessionId: number | null): number {
  const info = db
    .prepare(`INSERT INTO chats (sessionId, timestamp) VALUES (?, ?)`)
    .run(sessionId, Date.now());
  return info.lastInsertRowid as number;
}

function seedMessage(
  db: DB,
  chatId: number,
  sender: string,
  text: string
): number {
  const info = db
    .prepare(
      `INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, ?, ?, ?)`
    )
    .run(chatId, sender, text, Date.now());
  return info.lastInsertRowid as number;
}

function tableNames(db: DB): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function triggerNames(db: DB): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

describe('V25 FTS migration', () => {
  let db: DB;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
  });

  it('ends at latest version with search tables and triggers', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(25);
    expect(db.pragma('user_version', { simple: true }) as number).toBe(25);
    expect(tableNames(db)).toContain('transcript_search');
    expect(tableNames(db)).toContain('message_search');
    for (const name of [
      'transcript_search_ai',
      'transcript_search_ad',
      'transcript_search_au',
      'message_search_ai',
      'message_search_ad',
      'message_search_au',
    ]) {
      expect(triggerNames(db)).toContain(name);
    }
  });

  it('is idempotent', () => {
    expect(() => initializeDatabase(db)).not.toThrow();
    expect(
      triggerNames(db).filter((t) => t === 'transcript_search_ai')
    ).toHaveLength(1);
  });

  it('backfills pre-existing rows when upgrading from v24', () => {
    // Simulate a v24 database: full schema minus the FTS layer.
    const legacy = new Database(':memory:');
    initializeDatabase(legacy);
    legacy.exec(`
      DROP TABLE transcript_search;
      DROP TABLE message_search;
      DROP TRIGGER transcript_search_ai;
      DROP TRIGGER transcript_search_ad;
      DROP TRIGGER transcript_search_au;
      DROP TRIGGER message_search_ai;
      DROP TRIGGER message_search_ad;
      DROP TRIGGER message_search_au;
    `);
    legacy.pragma('user_version = 24');
    const sessionId = seedSession(legacy);
    seedParagraph(legacy, sessionId, 0, 'legacy anxiety discussion');
    const chatId = seedChat(legacy, sessionId);
    seedMessage(legacy, chatId, 'ai', 'legacy coping strategies');

    initializeDatabase(legacy);

    expect(legacy.pragma('user_version', { simple: true }) as number).toBe(25);
    expect(searchTranscriptsFts(legacy, { query: 'anxiety' }).total).toBe(1);
    expect(searchMessagesFts(legacy, { query: 'coping' }).total).toBe(1);
    legacy.close();
  });
});

describe('transcript FTS search', () => {
  let db: DB;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
  });

  it('finds matches with mark highlights and bm25 rank', () => {
    const sessionId = seedSession(db);
    seedParagraph(
      db,
      sessionId,
      0,
      'the patient reports severe anxiety at night',
      1000
    );
    seedParagraph(db, sessionId, 1, 'we discussed weekend plans', 2000);

    const { rows, total } = searchTranscriptsFts(db, { query: 'anxiety' });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId,
      paragraphIndex: 0,
      timestampMs: 1000,
    });
    expect(rows[0]!.excerpt).toContain('<mark>anxiety</mark>');
    expect(typeof rows[0]!.rank).toBe('number');
  });

  it('stems query and content terms (porter)', () => {
    const sessionId = seedSession(db);
    seedParagraph(db, sessionId, 0, 'the patient could not sleep', 1000);
    expect(searchTranscriptsFts(db, { query: 'sleeping' }).total).toBe(1);
  });

  it('supports pagination and session/client filters', () => {
    const alice = seedSession(db, { clientName: 'Alice' });
    const bob = seedSession(db, { clientName: 'Bob' });
    for (let i = 0; i < 5; i += 1) {
      seedParagraph(db, alice, i, `alice anxiety episode ${i}`, 1000 + i);
    }
    seedParagraph(db, bob, 0, 'bob anxiety episode', 1000);

    expect(
      searchTranscriptsFts(db, { query: 'anxiety', clientName: 'Bob' }).total
    ).toBe(1);
    expect(
      searchTranscriptsFts(db, { query: 'anxiety', sessionIds: [bob] }).total
    ).toBe(1);
    const page1 = searchTranscriptsFts(db, {
      query: 'anxiety',
      limit: 2,
      offset: 0,
    });
    const page2 = searchTranscriptsFts(db, {
      query: 'anxiety',
      limit: 2,
      offset: 2,
    });
    expect(page1.total).toBe(6);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page1.rows[0]!.paragraphIndex).not.toBe(
      page2.rows[0]!.paragraphIndex
    );
  });

  it('falls back to recency order for filter-only queries', () => {
    const sessionId = seedSession(db);
    seedParagraph(db, sessionId, 0, 'first paragraph', 1000);
    seedParagraph(db, sessionId, 1, 'second paragraph', 2000);

    const { rows, total } = searchTranscriptsFts(db, {
      query: '',
      clientName: 'Alice',
    });
    expect(total).toBe(2);
    expect(rows[0]!.timestampMs).toBe(2000);
    expect(rows[0]!.rank).toBeNull();
    expect(rows[0]!.excerpt).not.toContain('<mark>');
  });

  it('returns empty for empty queries without filters', () => {
    const sessionId = seedSession(db);
    seedParagraph(db, sessionId, 0, 'some text', 1000);
    expect(searchTranscriptsFts(db, { query: '' })).toEqual({
      rows: [],
      total: 0,
    });
    expect(searchTranscriptsFts(db, { query: '***' })).toEqual({
      rows: [],
      total: 0,
    });
  });

  it('tracks updates and deletes in the same transaction', () => {
    const sessionId = seedSession(db);
    seedParagraph(db, sessionId, 0, 'original anxiety text', 1000);
    expect(searchTranscriptsFts(db, { query: 'anxiety' }).total).toBe(1);

    db.prepare(
      `UPDATE transcript_paragraphs SET text = ? WHERE sessionId = ? AND paragraphIndex = 0`
    ).run('rewritten calm text', sessionId);
    expect(searchTranscriptsFts(db, { query: 'anxiety' }).total).toBe(0);
    expect(searchTranscriptsFts(db, { query: 'calm' }).total).toBe(1);

    db.prepare(
      `DELETE FROM transcript_paragraphs WHERE sessionId = ? AND paragraphIndex = 0`
    ).run(sessionId);
    expect(searchTranscriptsFts(db, { query: 'calm' }).total).toBe(0);
  });

  it('rebuild restores a drifted index', () => {
    const sessionId = seedSession(db);
    seedParagraph(db, sessionId, 0, 'anxiety content', 1000);
    db.exec('DELETE FROM transcript_search');
    expect(searchTranscriptsFts(db, { query: 'anxiety' }).total).toBe(0);
    rebuildTranscriptSearch(db);
    expect(searchTranscriptsFts(db, { query: 'anxiety' }).total).toBe(1);
  });
});

describe('message FTS search', () => {
  let db: DB;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
  });

  it('finds session and standalone messages with metadata', () => {
    const sessionId = seedSession(db, { clientName: 'Alice' });
    const chatId = seedChat(db, sessionId);
    seedMessage(db, chatId, 'ai', 'try grounding for anxiety');
    const standaloneId = seedChat(db, null);
    seedMessage(db, standaloneId, 'user', 'anxiety coping list');

    const { rows, total } = searchMessagesFts(db, { query: 'anxiety' });
    expect(total).toBe(2);
    const sessionHit = rows.find((row) => row.chatId === chatId)!;
    expect(sessionHit).toMatchObject({
      sessionId,
      sender: 'ai',
      clientName: 'Alice',
    });
    expect(sessionHit.excerpt).toContain('<mark>anxiety</mark>');
    const standaloneHit = rows.find((row) => row.chatId === standaloneId)!;
    expect(standaloneHit.sessionId).toBeNull();
    expect(standaloneHit.clientName).toBeNull();
  });

  it('filters by client and tracks deletes', () => {
    const sessionId = seedSession(db, { clientName: 'Alice' });
    const chatId = seedChat(db, sessionId);
    const messageId = seedMessage(db, chatId, 'ai', 'anxiety note');
    expect(
      searchMessagesFts(db, { query: 'anxiety', clientName: 'Nobody' }).total
    ).toBe(0);
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    expect(searchMessagesFts(db, { query: 'anxiety' }).total).toBe(0);
  });

  it('rebuild restores a drifted index', () => {
    const chatId = seedChat(db, null);
    seedMessage(db, chatId, 'user', 'anxiety list');
    db.exec('DELETE FROM message_search');
    expect(searchMessagesFts(db, { query: 'anxiety' }).total).toBe(0);
    rebuildMessageSearch(db);
    expect(searchMessagesFts(db, { query: 'anxiety' }).total).toBe(1);
    expect(() => rebuildAllSearchIndexes(db)).not.toThrow();
  });
});

describe('file database concurrency (API + worker shape)', () => {
  it('supports WAL with two connections reading/writing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fts-wal-test-'));
    try {
      const file = path.join(dir, 'wal.db');
      const writer = new Database(file);
      initializeDatabase(writer);
      expect(writer.pragma('journal_mode', { simple: true }) as string).toBe(
        'wal'
      );

      const sessionId = seedSession(writer);
      seedParagraph(writer, sessionId, 0, 'concurrent anxiety note', 1000);

      const reader = new Database(file, { readonly: true });
      try {
        expect(searchTranscriptsFts(reader, { query: 'anxiety' }).total).toBe(
          1
        );
      } finally {
        reader.close();
      }
      writer.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
