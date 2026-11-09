// @vitest-environment node
// packages/vault/src/ftsQuery.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { toFts5Query, escapeFts5Literal } from './ftsQuery.js';
import { VaultFormatError } from './errors.js';

function searchTitles(titles: string[], input: string): string[] {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE t USING fts5(title)');
    const insert = db.prepare('INSERT INTO t(title) VALUES (?)');
    for (const title of titles) insert.run(title);
    const match = toFts5Query(input);
    if (!match) return [];
    return db
      .prepare('SELECT title FROM t WHERE t MATCH ? ORDER BY rank')
      .all(match)
      .map((row) => (row as { title: string }).title);
  } finally {
    db.close();
  }
}

describe('toFts5Query', () => {
  it('ANDs bare words as quoted literals', () => {
    expect(toFts5Query('anxiety sleep')).toBe('"anxiety" AND "sleep"');
  });

  it('keeps quoted phrases as phrase matches', () => {
    expect(toFts5Query('"side effect" anxiety')).toBe(
      '"anxiety" AND "side effect"'
    );
  });

  it('returns null for empty or termless input', () => {
    expect(toFts5Query('')).toBeNull();
    expect(toFts5Query('   ')).toBeNull();
    expect(toFts5Query('*** (((')).toBeNull();
    expect(toFts5Query('""')).toBeNull();
  });

  it('neutralizes FTS5 operators and column filters', () => {
    expect(toFts5Query('OR')).toBe('"OR"');
    expect(toFts5Query('title:anxiety')).toBe('"title" AND "anxiety"');
    expect(toFts5Query('anx* NEAR(sleep panic)')).toBe(
      '"anx" AND "NEAR" AND "sleep" AND "panic"'
    );
  });

  it('handles quotes, unicode, and apostrophes', () => {
    expect(toFts5Query(`"don't"`)).toBe(`"don't"`);
    expect(toFts5Query('Schlafstörung')).toBe('"Schlafstörung"');
    expect(toFts5Query('睡眠')).toBe('"睡眠"');
    expect(escapeFts5Literal('a"b')).toBe('"a""b"');
  });

  it('bounds length and term count', () => {
    const many = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    const query = toFts5Query(many)!;
    expect(query.split(' AND ')).toHaveLength(32);
    expect(toFts5Query('a'.repeat(10000))).toBe(`"${'a'.repeat(500)}"`);
  });

  it('rejects non-string input', () => {
    expect(() => toFts5Query(null as unknown as string)).toThrow(
      VaultFormatError
    );
  });
});

describe('generated queries against real FTS5', () => {
  const titles = [
    'patient reports anxiety and poor sleep',
    'sleep hygiene discussed at length',
    'no symptoms of depression',
  ];

  it('finds AND matches', () => {
    expect(searchTitles(titles, 'anxiety sleep')).toEqual([
      'patient reports anxiety and poor sleep',
    ]);
    expect(searchTitles(titles, 'sleep')).toHaveLength(2);
  });

  it('never throws on hostile input', () => {
    const hostile = [
      '"',
      '"""',
      '*',
      '(',
      ')',
      'OR OR OR',
      'title:',
      '{title}:',
      'NEAR(',
      'a"b"c',
      '\0',
      '😀',
    ];
    for (const input of hostile) {
      expect(() => searchTitles(titles, input)).not.toThrow();
    }
  });

  it('treats operator-like input as literal text', () => {
    // "OR" alone must match the literal word OR, not everything.
    expect(searchTitles(['bread or butter', 'unrelated'], 'OR')).toEqual([
      'bread or butter',
    ]);
  });
});
