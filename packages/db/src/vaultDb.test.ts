// @vitest-environment node
// packages/db/src/vaultDb.test.ts
//
// Vault open/attach lifecycle against the real cipher-capable binding
// (better-sqlite3-multiple-ciphers): key validation, wrong-key failure,
// missing files, the copy+rekey migration primitive, and the
// locked/attached global state machine. Stock `better-sqlite3` (a
// devDependency) stands in for the plaintext engine to prove it fails
// closed on vault files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import PlaintextDatabase from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { configureDb } from './config.js';
import {
  openVaultDb,
  createVaultDb,
  copyPlaintextDbAndRekey,
  detectCipherSupport,
  attachUnlockedDb,
  isDbUnlocked,
  closeDb,
  run,
  db,
  type SqliteDatabaseConstructor,
} from './sqliteService.js';
import { VaultLockedError } from '@therascript/vault';

const PlaintextCtor = PlaintextDatabase as unknown as new (
  filename: string,
  options?: Record<string, unknown>
) => DB;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-db-test-'));
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cipher-capable binding', () => {
  it('detects keying support on the default binding', () => {
    expect(detectCipherSupport()).toBe(true);
    const probe = new Database(':memory:');
    try {
      expect(typeof probe.key).toBe('function');
      expect(typeof probe.rekey).toBe('function');
    } finally {
      probe.close();
    }
  });

  it('rejects the plaintext binding (fail closed without key support)', () => {
    expect(() =>
      openVaultDb(':memory:', randomBytes(32), {
        databaseConstructor:
          PlaintextCtor as unknown as SqliteDatabaseConstructor,
        fileMustExist: false,
      })
    ).toThrow('Cipher support is required');
  });
});

describe('openVaultDb handshake', () => {
  it('opens with the correct key and applies vault pragmas', () => {
    const key = randomBytes(32);
    const file = path.join(tmpDir, 'vault.db');
    createVaultDb(file, key).close();
    const connection = openVaultDb(file, key);
    try {
      expect(connection.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(connection.pragma('temp_store', { simple: true })).toBe(2); // MEMORY
      expect(
        (
          connection.pragma('journal_mode', { simple: true }) as string
        ).toLowerCase()
      ).toBe('wal');
    } finally {
      connection.close();
    }
  });

  it('rejects invalid keys before touching the filesystem', () => {
    const missing = path.join(tmpDir, 'nope.db');
    expect(() => openVaultDb(missing, randomBytes(16))).toThrow(
      'Invalid database key'
    );
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('fails visibly when the vault file is missing', () => {
    expect(() =>
      openVaultDb(path.join(tmpDir, 'missing.db'), randomBytes(32))
    ).toThrow(/unable to open database file/);
  });

  it('fails closed on a wrong key and leaves the vault openable', () => {
    const right = randomBytes(32);
    const file = path.join(tmpDir, 'vault.db');
    createVaultDb(file, right).close();
    const wrong = randomBytes(32);
    expect(() => openVaultDb(file, wrong)).toThrow('file is not a database');
    // The failed open closed its connection: the correct key still works.
    const connection = openVaultDb(file, right);
    connection.close();
  });

  it('keeps vault bytes unreadable to the plaintext engine', () => {
    const key = randomBytes(32);
    const file = path.join(tmpDir, 'vault.db');
    const marker = `secret-marker-${randomBytes(4).toString('hex')}`;
    const writer = createVaultDb(file, key);
    try {
      writer.exec('CREATE TABLE t (x TEXT)');
      writer.prepare('INSERT INTO t VALUES (?)').run(marker);
    } finally {
      writer.close();
    }
    const reader = new PlaintextDatabase(file);
    try {
      expect(() => reader.prepare('SELECT * FROM t').get()).toThrow(
        'file is not a database'
      );
    } finally {
      reader.close();
    }
    expect(fs.readFileSync(file).includes(Buffer.from(marker))).toBe(false);
  });

  it('createVaultDb initializes the schema on a new file', () => {
    const file = path.join(tmpDir, 'fresh.db');
    const connection = createVaultDb(file, randomBytes(32));
    try {
      const version = connection.pragma('user_version', {
        simple: true,
      }) as number;
      expect(version).toBeGreaterThan(0);
      const sessions = connection
        .prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'")
        .get();
      expect(sessions).toBeDefined();
    } finally {
      connection.close();
    }
  });
});

describe('copyPlaintextDbAndRekey', () => {
  it('migrates schema version, rows, and FTS content into a keyed copy', () => {
    const legacy = path.join(tmpDir, 'legacy.db');
    const source = new Database(legacy);
    try {
      source.pragma('user_version = 17');
      source.exec(
        'CREATE TABLE t (x TEXT); CREATE VIRTUAL TABLE ft USING fts5(x);'
      );
      source.prepare('INSERT INTO t VALUES (?)').run('hello');
      source.prepare('INSERT INTO ft VALUES (?)').run('hello');
    } finally {
      source.close();
    }
    const staged = path.join(tmpDir, 'staged.db');
    const key = randomBytes(32);
    copyPlaintextDbAndRekey(staged, legacy, key);
    // Source untouched and still plaintext-readable.
    const legacyReader = new PlaintextDatabase(legacy);
    try {
      expect(legacyReader.prepare('SELECT x FROM t').get()).toEqual({
        x: 'hello',
      });
    } finally {
      legacyReader.close();
    }
    // Staged copy opens only with the key, content intact.
    const connection = openVaultDb(staged, key);
    try {
      expect(connection.pragma('user_version', { simple: true })).toBe(17);
      expect(connection.prepare('SELECT x FROM t').get()).toEqual({
        x: 'hello',
      });
      expect(
        connection
          .prepare("SELECT count(*) AS c FROM ft WHERE ft MATCH 'hello'")
          .get()
      ).toEqual({ c: 1 });
    } finally {
      connection.close();
    }
    const reader = new PlaintextDatabase(staged);
    try {
      expect(() => reader.prepare('SELECT * FROM t').get()).toThrow(
        'file is not a database'
      );
    } finally {
      reader.close();
    }
  });

  it('validates the key before copying anything', () => {
    const legacy = path.join(tmpDir, 'legacy.db');
    new Database(legacy).close();
    const staged = path.join(tmpDir, 'staged.db');
    expect(() =>
      copyPlaintextDbAndRekey(staged, legacy, randomBytes(16))
    ).toThrow('Invalid database key');
    expect(fs.existsSync(staged)).toBe(false);
  });
});

describe('global attach lifecycle', () => {
  it('throws VaultLockedError before attach in vault mode', () => {
    configureDb({ dbPath: path.join(tmpDir, 'vault.db'), isDev: false });
    expect(isDbUnlocked()).toBe(false);
    expect(() => run('SELECT 1')).toThrow(VaultLockedError);
    expect(() => db.prepare('SELECT 1')).toThrow(VaultLockedError);
  });

  it('serves queries after attach and locks again after close', () => {
    configureDb({ dbPath: path.join(tmpDir, 'vault.db'), isDev: false });
    const connection = new Database(':memory:');
    attachUnlockedDb(connection);
    expect(isDbUnlocked()).toBe(true);
    expect(run('SELECT 1 AS ok')).toBeDefined();
    expect(() => attachUnlockedDb(new Database(':memory:'))).toThrow(
      'Database is already attached'
    );
    closeDb();
    expect(isDbUnlocked()).toBe(false);
    expect(() => run('SELECT 1')).toThrow(VaultLockedError);
  });

  it('preserves legacy lazy-open in legacy-plaintext mode', () => {
    configureDb({
      dbPath: path.join(tmpDir, 'legacy.db'),
      isDev: false,
      mode: 'legacy-plaintext',
    });
    expect(run('SELECT 1 AS ok')).toBeDefined();
    expect(isDbUnlocked()).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'legacy.db'))).toBe(true);
  });

  it('clears prepared statements across close/attach cycles', () => {
    configureDb({ dbPath: path.join(tmpDir, 'vault.db'), isDev: false });
    attachUnlockedDb(new Database(':memory:'));
    expect(run('SELECT 1')).toBeDefined();
    closeDb();
    // A stale cached statement bound to the closed connection would throw
    // "The database connection is not open" here.
    attachUnlockedDb(new Database(':memory:'));
    expect(run('SELECT 1')).toBeDefined();
  });
});
