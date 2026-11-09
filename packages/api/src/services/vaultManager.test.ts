// @vitest-environment node
// packages/api/src/services/vaultManager.test.ts
//
// Vault lifecycle proof: enable/setup/unlock/lock/
// change-password/restore with a fake worker launcher and plaintext
// stand-ins for the cipher calls — everything else (generations,
// key wrapping, migrations, FTS, worker supervision protocol) is real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initializeDatabase,
  attachUnlockedDb,
  closeDb,
  isDbUnlocked,
  run,
  get,
  type SQLiteDatabase,
} from '@therascript/db';
import {
  VaultLockedError,
  VaultAuthError,
  VaultFormatError,
  VaultStateError,
  VaultBusyError,
  TEST_KDF_PARAMS,
  decryptRecording,
  createStagedGeneration,
  writeKeysEnvelope,
  readKeysEnvelope,
  readCurrentGenerationId,
  sealGeneration,
  type VaultKeys,
} from '@therascript/vault';
import {
  VaultManager,
  type VaultDbOps,
  type WorkerHandle,
  type WorkerLauncher,
  type StagedGenerationRef,
} from './vaultManager.js';

class FakeWorkerLauncher implements WorkerLauncher {
  starts: StagedGenerationRef[] = [];
  live = 0;
  failNextStart = false;
  delayMs = 0;

  async startWorker(
    _keys: VaultKeys,
    generation: StagedGenerationRef
  ): Promise<WorkerHandle> {
    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error('worker failed to start');
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.starts.push(generation);
    this.live += 1;
    return {
      pid: 4242,
      kill: async () => {
        this.live = Math.max(0, this.live - 1);
      },
      waitForExit: async () => {},
    };
  }
}

/** Plaintext stand-in for the cipher calls (real encryption is covered in @therascript/db). */
const fakeDbOps: VaultDbOps = {
  openVaultDb: (filename, _key, options) =>
    new Database(filename, {
      fileMustExist: options?.fileMustExist ?? true,
    }) as unknown as SQLiteDatabase,
  createVaultDb: (filename, _key) => {
    const connection = new Database(filename) as unknown as SQLiteDatabase;
    initializeDatabase(connection);
    return connection;
  },
  openLegacyDatabase: (filename) =>
    new Database(filename) as unknown as SQLiteDatabase,
  attachUnlockedDb: (connection) =>
    attachUnlockedDb(connection as unknown as SQLiteDatabase),
  closeDb: () => closeDb(),
  isDbUnlocked: () => isDbUnlocked(),
  initializeDatabase: (connection) =>
    initializeDatabase(connection as unknown as SQLiteDatabase),
};

/** Byte copy standing in for copy+rekey (plaintext twin: no encryption). */
async function fakeExportDatabase(
  stagedDbPath: string,
  legacyDbPath: string,
  _key: Buffer
): Promise<void> {
  await fs.copyFile(legacyDbPath, stagedDbPath);
}

let root: string;
let vaultRoot: string;
let legacyDbPath: string;
let legacyUploadsDir: string;
let launcher: FakeWorkerLauncher;
let manager: VaultManager;

function makeManager(
  overrides: Partial<ConstructorParameters<typeof VaultManager>[0]> = {}
) {
  return new VaultManager({
    vaultRoot,
    legacyDbPath,
    legacyUploadsDir,
    workerLauncher: launcher,
    dbOps: fakeDbOps,
    kdfParams: TEST_KDF_PARAMS,
    cipherProbe: () => true,
    ...overrides,
  });
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-manager-test-'));
  vaultRoot = path.join(root, 'vault');
  legacyDbPath = path.join(root, 'legacy.sqlite');
  legacyUploadsDir = path.join(root, 'uploads');
  launcher = new FakeWorkerLauncher();
  manager = makeManager();
});

afterEach(async () => {
  await manager.shutdown().catch(() => {});
  closeDb();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('enable', () => {
  it('boots into locked vault mode on cipher-capable bindings', async () => {
    await expect(manager.enable()).resolves.toBe('vault');
    expect(manager.isProtectionActive()).toBe(true);
    expect(manager.getStatus()).toBe('locked');
    expect(manager.getPublicStatus(null)).toEqual({
      status: 'locked',
      hasVault: false,
      authenticated: false,
      legacyFallback: false,
    });
    await expect(manager.enable()).resolves.toBe('vault');
  });

  it('falls back to legacy boot without cipher and without a vault', async () => {
    const legacy = makeManager({ cipherProbe: () => false });
    await expect(legacy.enable()).resolves.toBe('legacy-fallback');
    expect(legacy.isProtectionActive()).toBe(false);
    expect(legacy.getPublicStatus(null)).toMatchObject({
      status: 'unlocked',
      authenticated: true,
      legacyFallback: true,
    });
    await expect(legacy.setup('password123')).rejects.toBeInstanceOf(
      VaultStateError
    );
  });

  it('fails closed when a vault exists but cipher support is missing', async () => {
    await manager.enable();
    await manager.setup('password123');
    await manager.lock();
    const reboot = makeManager({ cipherProbe: () => false });
    await expect(reboot.enable()).rejects.toThrow(/cipher support is missing/);
  });
});

describe('setup / lock / unlock', () => {
  it('creates a fresh vault, attaches it, and starts the worker', async () => {
    await manager.enable();
    const { token } = await manager.setup('password123');
    expect(manager.getStatus()).toBe('unlocked');
    expect(manager.isSessionValid(token)).toBe(true);
    expect(manager.getSessionCount()).toBe(1);
    expect(launcher.starts).toHaveLength(1);
    expect(launcher.live).toBe(1);

    const activeId = await readCurrentGenerationId(vaultRoot);
    expect(activeId).toBe(launcher.starts[0]!.id);
    const keysPath = path.join(
      vaultRoot,
      'generations',
      activeId!,
      'keys.json'
    );
    expect((await fs.stat(keysPath)).mode & 0o777).toBe(0o600);
    await expect(readKeysEnvelope(keysPath)).resolves.toBeDefined();

    // The live database is migrated and queryable through the global db.
    expect(isDbUnlocked()).toBe(true);
    const probe = new Database(
      path.join(vaultRoot, 'generations', activeId!, 'vault.db'),
      { readonly: true }
    );
    try {
      expect(probe.pragma('user_version', { simple: true }) as number).toBe(25);
    } finally {
      probe.close();
    }
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy)
       VALUES ('a.mp3', 'c', 's', '2024-01-01', 'intake', 'cbt')`
    );
    expect(
      get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')
    ).toEqual({
      total: 1,
    });
  });

  it('rejects short passwords and duplicate setup', async () => {
    await manager.enable();
    await expect(manager.setup('short')).rejects.toBeInstanceOf(
      VaultFormatError
    );
    await manager.setup('password123');
    await expect(manager.setup('password123')).rejects.toBeInstanceOf(
      VaultStateError
    );
  });

  it('locks: revokes sessions, stops the worker, closes and clears keys', async () => {
    await manager.enable();
    const { token } = await manager.setup('password123');
    await manager.lock();
    expect(manager.getStatus()).toBe('locked');
    expect(manager.isSessionValid(token)).toBe(false);
    expect(manager.getSessionCount()).toBe(0);
    expect(launcher.live).toBe(0);
    expect(isDbUnlocked()).toBe(false);
    expect(() => manager.getDatabaseKey()).toThrow(VaultLockedError);
    expect(() => manager.getRecordingsKey()).toThrow(VaultLockedError);
    await expect(manager.lock()).resolves.toBeUndefined();
  });

  it('rejects a wrong unlock password without side effects', async () => {
    await manager.enable();
    await manager.setup('password123');
    await manager.lock();
    const startsBefore = launcher.starts.length;
    await expect(manager.unlock('wrongpassword')).rejects.toBeInstanceOf(
      VaultAuthError
    );
    expect(manager.getStatus()).toBe('locked');
    expect(launcher.starts.length).toBe(startsBefore);
    expect(isDbUnlocked()).toBe(false);
  });

  it('unlocks with the right password and issues a fresh session', async () => {
    await manager.enable();
    const first = await manager.setup('password123');
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy)
       VALUES ('a.mp3', 'c', 's', '2024-01-01', 'intake', 'cbt')`
    );
    await manager.lock();
    const second = await manager.unlock('password123');
    expect(manager.getStatus()).toBe('unlocked');
    expect(second.token).not.toBe(first.token);
    expect(manager.isSessionValid(first.token)).toBe(false);
    expect(manager.isSessionValid(second.token)).toBe(true);
    expect(
      get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')
    ).toEqual({
      total: 1,
    });
  });

  it('revokes browser sessions on shutdown so a restart requires the password', async () => {
    await manager.enable();
    const { token } = await manager.setup('password123');
    expect(manager.isSessionValid(token)).toBe(true);

    await manager.shutdown();
    expect(manager.getStatus()).toBe('locked');
    expect(manager.getSessionCount()).toBe(0);
    expect(manager.isSessionValid(token)).toBe(false);
    expect(manager.getPublicStatus(token)).toMatchObject({
      status: 'locked',
      authenticated: false,
    });
  });

  it('fails the unlock closed when the worker does not start', async () => {
    await manager.enable();
    await manager.setup('password123');
    await manager.lock();
    launcher.failNextStart = true;
    await expect(manager.unlock('password123')).rejects.toThrow(
      'worker failed to start'
    );
    expect(manager.getStatus()).toBe('locked');
    expect(isDbUnlocked()).toBe(false);
    expect(() => manager.getDatabaseKey()).toThrow(VaultLockedError);
  });

  it('serializes concurrent transitions with VaultBusyError', async () => {
    await manager.enable();
    await manager.setup('password123');
    await manager.lock();
    launcher.delayMs = 150;
    const first = manager.unlock('password123');
    await expect(manager.unlock('password123')).rejects.toBeInstanceOf(
      VaultBusyError
    );
    await expect(first).resolves.toBeDefined();
    expect(manager.getStatus()).toBe('unlocked');
  });
});

describe('second browser', () => {
  it('hides the open database from sessions it did not issue', async () => {
    await manager.enable();
    await manager.setup('password123');
    expect(manager.getPublicStatus('bogus')).toEqual({
      status: 'locked',
      hasVault: true,
      authenticated: false,
      legacyFallback: false,
    });
    // ...but the correct password mints an independent session, no restart.
    const startsBefore = launcher.starts.length;
    const second = await manager.unlock('password123');
    expect(launcher.starts.length).toBe(startsBefore);
    expect(manager.getPublicStatus(second.token)).toMatchObject({
      status: 'unlocked',
      authenticated: true,
    });
    await expect(manager.unlock('wrongpassword')).rejects.toBeInstanceOf(
      VaultAuthError
    );
  });
});

describe('changePassword', () => {
  it('rewraps keys: old password dies, data survives', async () => {
    await manager.enable();
    await manager.setup('oldpassword');
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy)
       VALUES ('a.mp3', 'c', 's', '2024-01-01', 'intake', 'cbt')`
    );
    await manager.changePassword('oldpassword', 'newpassword');
    await manager.lock();
    await expect(manager.unlock('oldpassword')).rejects.toBeInstanceOf(
      VaultAuthError
    );
    await manager.unlock('newpassword');
    expect(
      get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')
    ).toEqual({
      total: 1,
    });
  });

  it('refuses wrong old passwords and short new passwords', async () => {
    await manager.enable();
    await manager.setup('oldpassword');
    await expect(
      manager.changePassword('nope-nope-nope', 'newpassword')
    ).rejects.toBeInstanceOf(VaultAuthError);
    await expect(
      manager.changePassword('oldpassword', 'short')
    ).rejects.toBeInstanceOf(VaultFormatError);
  });
});

describe('legacy migration during setup', () => {
  function seedLegacyInstall(): { audioBytes: Buffer } {
    const legacy = new Database(legacyDbPath);
    initializeDatabase(legacy as unknown as SQLiteDatabase);
    // Shape it as v24 (pre-FTS), then add user data.
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
    const sessionId = legacy
      .prepare(
        `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status, audioPath)
         VALUES ('talk.mp3', 'Carol', 'S1', '2024-02-02', 'intake', 'cbt', 'completed', '7-1234.mp3')`
      )
      .run().lastInsertRowid as number;
    legacy
      .prepare(
        `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text)
         VALUES (?, 0, 1000, 'legacy anxiety discussion')`
      )
      .run(sessionId);
    const chatId = legacy
      .prepare(`INSERT INTO chats (sessionId, timestamp) VALUES (?, 1)`)
      .run(sessionId).lastInsertRowid as number;
    legacy
      .prepare(
        `INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, 'ai', 'legacy reply', 2)`
      )
      .run(chatId);
    legacy.close();
    return { audioBytes: Buffer.from('fake-audio-bytes') };
  }

  it('migrates data, encrypts recordings, and cleans up legacy files', async () => {
    const { audioBytes } = seedLegacyInstall();
    await fs.mkdir(legacyUploadsDir, { recursive: true });
    await fs.writeFile(path.join(legacyUploadsDir, '7-1234.mp3'), audioBytes);

    const migrating = makeManager({
      exportDatabaseForMigration: fakeExportDatabase,
    });
    await migrating.enable();
    await migrating.setup('password123');
    try {
      // Data survived with identical counts.
      expect(
        get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')
      ).toEqual({ total: 1 });
      expect(
        get<{ total: number }>(
          'SELECT COUNT(*) AS total FROM transcript_paragraphs'
        )
      ).toEqual({ total: 1 });
      // The v24→v25 leg ran: FTS works on migrated rows.
      const { searchTranscriptsFts } = await import('@therascript/db');
      const active = migrating.getActiveGenerationPaths()!;
      const probe = new Database(active.dbPath);
      try {
        expect(
          searchTranscriptsFts(probe as never, { query: 'anxiety' }).total
        ).toBe(1);
      } finally {
        probe.close();
      }
      // Audio references are vault-shaped and decrypt to the original bytes.
      const session = get<{ audioPath: string }>(
        'SELECT audioPath FROM sessions LIMIT 1'
      )!;
      expect(session.audioPath).toBe('7-1234.mp3.enc');
      const encBytes = await fs.readFile(
        path.join(active.recordingsDir, session.audioPath)
      );
      expect(
        decryptRecording(encBytes, migrating.getRecordingsKey()).equals(
          audioBytes
        )
      ).toBe(true);
      // Legacy files are gone (crash-safe manifest consumed).
      await expect(fs.access(legacyDbPath)).rejects.toThrow();
      await expect(fs.access(legacyUploadsDir)).rejects.toThrow();
      await expect(
        fs.access(path.join(vaultRoot, 'CLEANUP.json'))
      ).rejects.toThrow();
    } finally {
      await migrating.shutdown().catch(() => {});
    }
  });

  it('fails setup fast on dangling audio references, legacy untouched', async () => {
    seedLegacyInstall(); // references 7-1234.mp3; deliberately never written
    const migrating = makeManager({
      exportDatabaseForMigration: fakeExportDatabase,
    });
    await migrating.enable();
    // One actionable error (not the deep seal failure), before any staging.
    await expect(migrating.setup('password123')).rejects.toThrow(
      /Cannot migrate the legacy install.*7-1234\.mp3.*--repair-missing-audio.*No vault was created/
    );
    // Fail-closed: legacy files intact, no vault created, still locked.
    await expect(fs.access(legacyDbPath)).resolves.toBeUndefined();
    await expect(fs.access(path.join(vaultRoot, 'CURRENT'))).rejects.toThrow();
    await expect(fs.access(path.join(vaultRoot, 'STAGING'))).rejects.toThrow();
    expect(migrating.getStatus()).toBe('locked');
    await migrating.shutdown().catch(() => {});
  });
});

describe('restoreStagedAsActive', () => {
  it('commits a staged import without dropping sessions', async () => {
    await manager.enable();
    const { token } = await manager.setup('password123');
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy)
       VALUES ('a.mp3', 'c', 's', '2024-01-01', 'intake', 'cbt')`
    );
    const beforeId = await readCurrentGenerationId(vaultRoot);

    // Build the staged generation the way the import path does.
    const active = manager.getActiveGenerationPaths()!;
    const staged = await createStagedGeneration(vaultRoot);
    await writeKeysEnvelope(
      staged.keysPath,
      await readKeysEnvelope(active.keysPath)
    );
    const stagedDb = fakeDbOps.createVaultDb(
      staged.dbPath,
      manager.getDatabaseKey()
    );
    try {
      stagedDb
        .prepare(
          `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy)
           VALUES ('b.mp3', 'restored', 'r', '2024-03-03', 'intake', 'cbt')`
        )
        .run();
    } finally {
      stagedDb.close();
    }
    await sealGeneration(staged);

    const startsBefore = launcher.starts.length;
    await manager.restoreStagedAsActive(staged);
    expect(await readCurrentGenerationId(vaultRoot)).toBe(staged.id);
    expect(beforeId).not.toBe(staged.id);
    expect(launcher.starts.length).toBe(startsBefore + 1);
    expect(launcher.live).toBe(1);
    // Restored content is live; the browser session survived the cutover.
    expect(
      get<{ clientName: string }>('SELECT clientName FROM sessions LIMIT 1')
    ).toEqual({
      clientName: 'restored',
    });
    expect(manager.isSessionValid(token)).toBe(true);
  });

  it('refuses an incomplete staged generation and stays on the old one', async () => {
    await manager.enable();
    await manager.setup('password123');
    const beforeId = await readCurrentGenerationId(vaultRoot);
    const staged = await createStagedGeneration(vaultRoot);
    await expect(manager.restoreStagedAsActive(staged)).rejects.toBeInstanceOf(
      VaultFormatError
    );
    expect(await readCurrentGenerationId(vaultRoot)).toBe(beforeId);
    expect(manager.getStatus()).toBe('unlocked');
    expect(launcher.live).toBe(1);
  });
});

describe('lock drain and streams', () => {
  it('waits for in-flight requests before locking', async () => {
    await manager.enable();
    await manager.setup('password123');
    const release = manager.trackRequest();
    expect(manager.getInFlightRequests()).toBe(1);
    const locking = manager.lock();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manager.getStatus()).toBe('locking');
    release();
    await locking;
    expect(manager.getStatus()).toBe('locked');
  });

  it('proceeds after the drain timeout', async () => {
    const impatient = makeManager({ drainTimeoutMs: 30 });
    await impatient.enable();
    await impatient.setup('password123');
    const release = impatient.trackRequest();
    try {
      await impatient.lock();
      expect(impatient.getStatus()).toBe('locked');
    } finally {
      release();
      await impatient.shutdown().catch(() => {});
    }
  });

  it('aborts registered streams on lock', async () => {
    await manager.enable();
    await manager.setup('password123');
    const controller = new AbortController();
    const unregister = manager.registerStream(controller);
    expect(controller.signal.aborted).toBe(false);
    await manager.lock();
    expect(controller.signal.aborted).toBe(true);
    unregister();
  });

  it('prepares shutdown by aborting streams but keeps the vault open', async () => {
    await manager.enable();
    await manager.setup('password123');
    const controller = new AbortController();
    manager.registerStream(controller);
    await manager.prepareShutdown();
    expect(controller.signal.aborted).toBe(true);
    expect(manager.getStatus()).toBe('unlocked');
    expect(isDbUnlocked()).toBe(true);
  });
});

describe('unlock rate limiting', () => {
  it('blocks after the configured attempts until reset', async () => {
    const strict = makeManager({
      unlockRateLimit: { maxAttempts: 2, windowMs: 60_000 },
    });
    await strict.enable();
    expect(strict.checkUnlockAttempt('ip').allowed).toBe(true);
    expect(strict.checkUnlockAttempt('ip').allowed).toBe(true);
    const blocked = strict.checkUnlockAttempt('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    strict.resetUnlockAttempts('ip');
    expect(strict.checkUnlockAttempt('ip').allowed).toBe(true);
    await strict.shutdown().catch(() => {});
  });
});
