// @vitest-environment node
// packages/db/src/migrations.test.ts
//
// Integration tests for the SQLite migration chain. Drives the real
// `better-sqlite3` engine against `initializeDatabase` so we exercise
// the actual SQL `ALTER TABLE` statements in `runMigrations` rather
// than mocking the migrator away.
//
// Background: commit `5624bfe` (fix: schema version) bumped
// `LATEST_SCHEMA_VERSION` from 18 to 19 to match the v19 migration
// that landed in commit `31d8dc4` (feat: api token) and adds a
// `llm_api_token TEXT NULL` column to `app_settings`. The
// `appSettingsRepository` (`packages/data/src/repositories/appSettingsRepository.ts`)
// was extended at the same time to read + write the new column. The
// v18 → v19 transition is critical: a v18 DB that boots through the
// migrator must end up with the column, must NOT lose the existing
// row, and the new column must be nullable so old rows survive the
// upgrade untouched.
//
// These tests run the migrator on an in-memory `better-sqlite3`
// instance because:
//   - :memory: avoids touching the developer's real `therascript.db`
//     file under `packages/db/`.
//   - `:memory:` is fast enough that the full v1 → v19 chain runs in
//     well under a second on a developer machine.
//   - Each `describe` block seeds its own DB instance, so the
//     "fresh install" and "upgrade from v18" cases never share state.
//
// References:
//   - `packages/db/src/sqliteService.ts:741` (initializeDatabase)
//   - `packages/db/src/sqliteService.ts:647-669` (v19 migration block)
//   - `packages/data/src/repositories/appSettingsRepository.ts:21`
//     (the new `llm_api_token: null` default in getSettings)
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { initializeDatabase, LATEST_SCHEMA_VERSION } from './sqliteService.js';

// v18-shape schema: `app_settings` as it existed at the end of the
// v18 migration (`sqliteService.ts:622-645`) plus the `templates`
// table that `seedSystemTemplates` (`sqliteService.ts:149-173`)
// queries unconditionally after the migrator runs. The validator at
// `schemaValidation.ts:83-134` will warn about other missing tables
// (sessions, messages, ...) but those warnings are non-blocking and
// do not affect the migration under test.
const APP_SETTINGS_V18_DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    llm_base_url TEXT NULL,
    llm_model_name TEXT NULL,
    llm_context_size INTEGER NULL,
    llm_temperature REAL NOT NULL DEFAULT 0.7,
    llm_top_p REAL NOT NULL DEFAULT 0.9,
    llm_repeat_penalty REAL NOT NULL DEFAULT 1.1,
    llm_num_gpu_layers INTEGER NULL,
    llm_thinking_budget INTEGER NULL
  );
  INSERT OR IGNORE INTO app_settings (
    id, llm_model_name, llm_temperature, llm_top_p, llm_repeat_penalty
  ) VALUES (
    1, 'default', 0.7, 0.9, 1.1
  );
  CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`;

/**
 * Read the current `user_version` pragma. The migrator reads it the
 * same way (`sqliteService.ts:176-178`) and compares against
 * `LATEST_SCHEMA_VERSION`.
 */
function userVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Read the `llm_api_token` column metadata for the `app_settings`
 * table. Returns `null` if the column does not exist (i.e. the
 * pre-v19 shape).
 */
function apiTokenColumn(db: DB): {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
} | null {
  const cols = db.pragma('table_info(app_settings)', {
    simple: false,
  }) as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
  }>;
  return cols.find((c) => c.name === 'llm_api_token') ?? null;
}

describe('initializeDatabase — fresh install', () => {
  let db: DB;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('ends at LATEST_SCHEMA_VERSION on a brand-new database', () => {
    expect(userVersion(db)).toBe(0);

    initializeDatabase(db);

    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('creates app_settings with the v19 llm_api_token column nullable', () => {
    initializeDatabase(db);

    const col = apiTokenColumn(db);
    expect(col).not.toBeNull();
    expect(col?.type).toBe('TEXT');
    // `notnull: 0` means the column accepts NULL — the contract for
    // "no token configured" (see appSettingsRepository.getSettings
    // returning `llm_api_token: null` as the default).
    expect(col?.notnull).toBe(0);
  });

  it('seeds the app_settings row with llm_api_token = NULL', () => {
    initializeDatabase(db);

    const row = db
      .prepare('SELECT llm_api_token FROM app_settings WHERE id = 1')
      .get() as { llm_api_token: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row?.llm_api_token).toBeNull();
  });
});

describe('initializeDatabase — upgrade from v18 (additive migration)', () => {
  let db: DB;

  beforeEach(() => {
    // Simulate a v18 install: build the v18 shape of `app_settings`
    // (everything up to and including `llm_thinking_budget`, but
    // without `llm_api_token`) and stamp the version pragma. The
    // migrator must then run the v19 branch in
    // `sqliteService.ts:653-669`.
    db = new Database(':memory:');
    db.exec(APP_SETTINGS_V18_DDL);
    db.pragma('user_version = 18');
  });

  it('bumps user_version to LATEST_SCHEMA_VERSION', () => {
    expect(userVersion(db)).toBe(18);

    initializeDatabase(db);

    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('adds the llm_api_token column without losing the existing row', () => {
    // Sanity: the v18 row is present, with no llm_api_token column.
    const before = db
      .prepare(
        'SELECT llm_model_name, llm_temperature FROM app_settings WHERE id = 1'
      )
      .get() as { llm_model_name: string; llm_temperature: number };
    expect(before.llm_model_name).toBe('default');
    expect(before.llm_temperature).toBe(0.7);
    expect(apiTokenColumn(db)).toBeNull();

    initializeDatabase(db);

    // Column now exists, is nullable, and the row survived with
    // llm_api_token defaulting to NULL.
    const col = apiTokenColumn(db);
    expect(col).not.toBeNull();
    expect(col?.notnull).toBe(0);

    const after = db
      .prepare(
        'SELECT llm_model_name, llm_temperature, llm_api_token FROM app_settings WHERE id = 1'
      )
      .get() as {
      llm_model_name: string;
      llm_temperature: number;
      llm_api_token: string | null;
    };
    expect(after.llm_model_name).toBe('default');
    expect(after.llm_temperature).toBe(0.7);
    expect(after.llm_api_token).toBeNull();
  });

  it('is idempotent — running it twice does not error or duplicate the column', () => {
    initializeDatabase(db);
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    // The v19 branch in `sqliteService.ts:653-669` is guarded by
    // `if (currentVersion < 19)` AND the `appSettingsColumns.some(...)`
    // check, so a re-run must be a no-op. This is the regression
    // guard: a future change that drops either guard would crash
    // here with "duplicate column name: llm_api_token".
    expect(() => initializeDatabase(db)).not.toThrow();
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION);

    const cols = db.pragma('table_info(app_settings)', {
      simple: false,
    }) as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === 'llm_api_token')).toHaveLength(1);
  });
});
