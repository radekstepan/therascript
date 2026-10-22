// @vitest-environment node
// packages/db/src/seedSystemTemplates.test.ts
//
// Regression tests for Task 13: `seedSystemTemplates`
// (`sqliteService.ts`) must be insert-only so user customizations made
// via SystemPromptsPage survive API/worker restarts. Previously the
// seeder ran an UPDATE whenever `existing.text !== template.text`,
// clobbering user edits on every boot.
//
// These tests drive the real `better-sqlite3` engine against
// `initializeDatabase` on `:memory:` instances (same pattern as
// `migrations.test.ts`), simulating a restart by calling
// `initializeDatabase` a second time on the same DB.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import {
  initializeDatabase,
  SYSTEM_PROMPT_TEMPLATES,
  LEGACY_VERIFICATION_JUDGE_PROMPT_TEXTS,
} from './sqliteService.js';

function templateText(db: DB, title: string): string | undefined {
  const row = db
    .prepare('SELECT text FROM templates WHERE title = ?')
    .get(title) as { text: string } | undefined;
  return row?.text;
}

describe('seedSystemTemplates — insert-only seeding', () => {
  let db: DB;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('seeds all system templates on a fresh database', () => {
    initializeDatabase(db);

    for (const template of Object.values(SYSTEM_PROMPT_TEMPLATES)) {
      expect(templateText(db, template.title)).toBe(template.text);
    }
  });

  it('preserves user-edited system prompts across restarts', () => {
    initializeDatabase(db);

    // Simulate a user customization via SystemPromptsPage: edit one
    // system template row directly.
    const target = SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT;
    const customText = 'Custom user-edited system prompt. Be verbose.';
    db.prepare('UPDATE templates SET text = ? WHERE title = ?').run(
      customText,
      target.title
    );
    expect(templateText(db, target.title)).toBe(customText);

    // Simulate an API/worker restart: re-run initialization on the
    // same database file.
    initializeDatabase(db);

    // The user's edit must survive; the seeder must NOT reset it to
    // the SYSTEM_PROMPT_TEMPLATES default.
    expect(templateText(db, target.title)).toBe(customText);
  });

  it('re-seeds a system template that was deleted, without touching others', () => {
    initializeDatabase(db);

    const deleted = SYSTEM_PROMPT_TEMPLATES.STANDALONE_CHAT;
    const edited = SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT;
    const customText = 'User-edited session chat prompt.';
    db.prepare('UPDATE templates SET text = ? WHERE title = ?').run(
      customText,
      edited.title
    );
    db.prepare('DELETE FROM templates WHERE title = ?').run(deleted.title);
    expect(templateText(db, deleted.title)).toBeUndefined();

    // Restart: the deleted row is re-inserted with its default, the
    // edited row keeps the user's text.
    initializeDatabase(db);

    expect(templateText(db, deleted.title)).toBe(deleted.text);
    expect(templateText(db, edited.title)).toBe(customText);
  });

  it('upgrades a legacy system_verification_judge row to the fixed prompt', () => {
    initializeDatabase(db);

    const target = SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE;
    expect(LEGACY_VERIFICATION_JUDGE_PROMPT_TEXTS.length).toBeGreaterThan(0);
    for (const legacyText of LEGACY_VERIFICATION_JUDGE_PROMPT_TEXTS) {
      // Sanity: the legacy fixture must differ from the current default,
      // otherwise this test would pass vacuously.
      expect(legacyText).not.toBe(target.text);
      // Simulate an existing database seeded by an older build.
      db.prepare('UPDATE templates SET text = ? WHERE title = ?').run(
        legacyText,
        target.title
      );
      expect(templateText(db, target.title)).toBe(legacyText);

      // Simulate an API/worker restart: the fixed Judge prompt (no
      // timestampMs math, brief-thinking guidance) replaces the legacy row.
      initializeDatabase(db);

      expect(templateText(db, target.title)).toBe(target.text);
    }
  });

  it('preserves a user-customized verification judge prompt across restarts', () => {
    initializeDatabase(db);

    // A genuine user edit matches no legacy default, so the upgrade path
    // must leave it alone.
    const target = SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE;
    const customText = 'Custom judge prompt. Be strict and terse.';
    expect(LEGACY_VERIFICATION_JUDGE_PROMPT_TEXTS).not.toContain(customText);
    db.prepare('UPDATE templates SET text = ? WHERE title = ?').run(
      customText,
      target.title
    );

    initializeDatabase(db);

    expect(templateText(db, target.title)).toBe(customText);
  });

  it('is idempotent — re-running on an untouched DB changes nothing', () => {
    initializeDatabase(db);
    const before = db
      .prepare('SELECT title, text, createdAt FROM templates ORDER BY title')
      .all();

    initializeDatabase(db);

    const after = db
      .prepare('SELECT title, text, createdAt FROM templates ORDER BY title')
      .all();
    expect(after).toEqual(before);
  });
});
