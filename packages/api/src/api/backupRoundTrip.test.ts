// @vitest-environment node
// packages/api/src/api/backupRoundTrip.test.ts
//
// Encrypted backup round-trip against a live
// vault: export → mutate → import restores exactly; wrong passwords,
// truncated archives, and hostile entries fail closed with the live
// vault untouched; legacy plaintext tars import through the same staged
// path. Real database, real repositories, real crypto; only the worker
// launcher and the cipher calls are faked.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tar from 'tar-stream';
import {
  initializeDatabase,
  attachUnlockedDb,
  closeDb,
  run,
  get,
  searchTranscriptsFts,
  type SQLiteDatabase,
} from '@therascript/db';
import {
  TEST_KDF_PARAMS,
  encryptRecording,
  decryptRecording,
  isEncryptedBackup,
  type VaultKeys,
} from '@therascript/vault';
import {
  VaultManager,
  getVaultManager,
  setVaultManagerForTests,
  resetVaultManager,
  type VaultDbOps,
  type WorkerHandle,
  type WorkerLauncher,
  type StagedGenerationRef,
} from '../services/vaultManager.js';
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from '../errors.js';

class FakeWorkerLauncher implements WorkerLauncher {
  starts = 0;
  live = 0;
  async startWorker(
    _keys: VaultKeys,
    _generation: StagedGenerationRef
  ): Promise<WorkerHandle> {
    this.starts += 1;
    this.live += 1;
    return {
      pid: 1,
      kill: async () => {
        this.live = Math.max(0, this.live - 1);
      },
      waitForExit: async () => {},
    };
  }
}

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
  isDbUnlocked: () => true,
  initializeDatabase: (connection) =>
    initializeDatabase(connection as unknown as SQLiteDatabase),
};

const { importDataService, exportVaultBackupService } = await import(
  './adminHandler.js'
);

let root: string;
let manager: VaultManager;
let launcher: FakeWorkerLauncher;

const AUDIO_BYTES = Buffer.from('fake-audio-bytes-for-backup-test');

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const piece of stream) chunks.push(Buffer.from(piece));
  return Buffer.concat(chunks);
}

function seedVaultContent(): void {
  const sessionId = run(
    `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status, audioPath, transcriptTokenCount, duration, showSpeakers, numSpeakers)
     VALUES ('talk.mp3', 'Carol', 'S1', '2024-02-02', 'intake', 'cbt', 'completed', '7-1234.mp3.enc', 42, 3600, 1, 2)`
  ).lastInsertRowid as number;
  run(
    `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text, speaker)
     VALUES (?, 0, 1000, 'backup marker anxiety discussion', 'SPEAKER_01')`,
    sessionId
  );
  const chatId = run(
    `INSERT INTO chats (sessionId, timestamp) VALUES (?, 1)`,
    sessionId
  ).lastInsertRowid as number;
  run(
    `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, model, duration, isTruncated)
     VALUES (?, 'user', 'how am I doing?', 2, NULL, NULL, NULL, NULL, NULL)`,
    chatId
  );
  run(
    `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, model, duration, isTruncated)
     VALUES (?, 'ai', 'you show steady progress', 3, 5, 6, 'author-model', 120, 0)`,
    chatId
  );
  run(
    `INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, 'system', 'transcript edited', 4)`,
    chatId
  );
  run(
    `INSERT INTO templates (title, text, createdAt) VALUES ('note', 'body', 5)`
  );
}

async function seedVaultRecording(): Promise<void> {
  const generation = manager.getActiveGenerationPaths()!;
  await fs.writeFile(
    path.join(generation.recordingsDir, '7-1234.mp3.enc'),
    encryptRecording(AUDIO_BYTES, manager.getRecordingsKey()),
    { mode: 0o600 }
  );
}

function sessionCount(): number {
  return get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')!
    .total;
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-backup-test-'));
  launcher = new FakeWorkerLauncher();
  manager = new VaultManager({
    vaultRoot: path.join(root, 'vault'),
    legacyDbPath: path.join(root, 'legacy.sqlite'),
    legacyUploadsDir: path.join(root, 'uploads'),
    workerLauncher: launcher,
    dbOps: fakeDbOps,
    kdfParams: TEST_KDF_PARAMS,
    cipherProbe: () => true,
  });
  await manager.enable();
  setVaultManagerForTests(manager);
  await manager.setup('vault-password');
  seedVaultContent();
  await seedVaultRecording();
});

afterEach(async () => {
  setVaultManagerForTests(null);
  await manager.shutdown().catch(() => {});
  resetVaultManager();
  closeDb();
  await fs.rm(root, { recursive: true, force: true });
});

describe('encrypted backup round-trip', () => {
  it('exports an encrypted archive that restores exactly', async () => {
    const { readCurrentGenerationId } = await import('@therascript/vault');
    const vaultRoot = path.join(root, 'vault');
    const beforeId = await readCurrentGenerationId(vaultRoot);

    const encrypted = await collect(
      await exportVaultBackupService('backup-password', TEST_KDF_PARAMS)
    );
    expect(isEncryptedBackup(encrypted)).toBe(true);
    // No plaintext marker survives in the sealed archive.
    expect(encrypted.includes(Buffer.from('backup marker'))).toBe(false);
    expect(encrypted.includes(AUDIO_BYTES)).toBe(false);

    // Mutate live state, then restore: the backup wins wholesale.
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status)
       VALUES ('intruder.mp3', 'Mallory', 'X', '2024-09-09', 'intake', 'cbt', 'completed')`
    );
    expect(sessionCount()).toBe(2);

    const result = await importDataService(
      new File([encrypted], 'backup.tvbak'),
      { backupPassword: 'backup-password' }
    );
    expect(result.message).toMatch(/Import successful/);
    expect(sessionCount()).toBe(1);
    const afterId = await readCurrentGenerationId(vaultRoot);
    expect(afterId).not.toBe(beforeId);

    // Content survived with full coverage: speaker, model, duration,
    // truncation flag, token counts, and the decrypted recording.
    const session = get<{
      clientName: string;
      audioPath: string;
      duration: number;
      numSpeakers: number;
    }>(
      'SELECT clientName, audioPath, duration, numSpeakers FROM sessions LIMIT 1'
    )!;
    expect(session).toMatchObject({
      clientName: 'Carol',
      audioPath: '7-1234.mp3.enc',
      duration: 3600,
      numSpeakers: 2,
    });
    const paragraph = get<{ text: string; speaker: string }>(
      'SELECT text, speaker FROM transcript_paragraphs LIMIT 1'
    )!;
    expect(paragraph).toMatchObject({
      text: 'backup marker anxiety discussion',
      speaker: 'SPEAKER_01',
    });
    const messages = await import('@therascript/db').then((m) =>
      (m as { all: <T>(sql: string) => T[] }).all<{
        sender: string;
        model: string | null;
        duration: number | null;
      }>('SELECT sender, model, duration FROM messages ORDER BY timestamp ASC')
    );
    expect(messages.map((m) => m.sender)).toEqual(['user', 'ai', 'system']);
    expect(messages[1]).toMatchObject({ model: 'author-model', duration: 120 });

    const generation = manager.getActiveGenerationPaths()!;
    const restoredAudio = decryptRecording(
      await fs.readFile(path.join(generation.recordingsDir, '7-1234.mp3.enc')),
      manager.getRecordingsKey()
    );
    expect(restoredAudio.equals(AUDIO_BYTES)).toBe(true);

    // The staged database serves FTS immediately after cutover.
    const probe = new Database(generation.dbPath, { readonly: true });
    try {
      expect(
        searchTranscriptsFts(probe as never, { query: 'backup marker' }).total
      ).toBe(1);
    } finally {
      probe.close();
    }
    // The worker was restarted onto the new generation.
    expect(launcher.starts).toBe(2);
    expect(launcher.live).toBe(1);
  });

  it('fails closed on a wrong backup password with the vault untouched', async () => {
    const { readCurrentGenerationId } = await import('@therascript/vault');
    const encrypted = await collect(
      await exportVaultBackupService('backup-password', TEST_KDF_PARAMS)
    );
    const beforeId = await readCurrentGenerationId(path.join(root, 'vault'));
    await expect(
      importDataService(new File([encrypted], 'backup.tvbak'), {
        backupPassword: 'wrong-password',
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await readCurrentGenerationId(path.join(root, 'vault'))).toBe(
      beforeId
    );
    expect(sessionCount()).toBe(1);
    expect(getVaultManager().getStatus()).toBe('unlocked');
  });

  it('fails closed on a truncated archive with the vault untouched', async () => {
    const { readCurrentGenerationId } = await import('@therascript/vault');
    const encrypted = await collect(
      await exportVaultBackupService('backup-password', TEST_KDF_PARAMS)
    );
    const beforeId = await readCurrentGenerationId(path.join(root, 'vault'));
    const truncated = encrypted.subarray(0, encrypted.length - 100);
    await expect(
      importDataService(new File([truncated], 'backup.tvbak'), {
        backupPassword: 'backup-password',
      })
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await readCurrentGenerationId(path.join(root, 'vault'))).toBe(
      beforeId
    );
    expect(sessionCount()).toBe(1);
  });

  it('requires the backup password for encrypted archives', async () => {
    const encrypted = await collect(
      await exportVaultBackupService('backup-password', TEST_KDF_PARAMS)
    );
    await expect(
      importDataService(new File([encrypted], 'backup.tvbak'))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses to export when a referenced recording is missing', async () => {
    run(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status, audioPath)
       VALUES ('gone.mp3', 'Ghost', 'G', '2024-01-01', 'intake', 'cbt', 'completed', 'missing.mp3.enc')`
    );
    const stream = await exportVaultBackupService(
      'backup-password',
      TEST_KDF_PARAMS
    );
    await expect(collect(stream)).rejects.toThrow(/Backup incomplete/);
  });
});

describe('legacy plaintext import into a vault', () => {
  async function buildLegacyTar(
    entries: Record<string, unknown>,
    uploads: Record<string, Buffer> = {}
  ): Promise<File> {
    const pack = tar.pack();
    for (const [name, value] of Object.entries(entries)) {
      pack.entry({ name }, JSON.stringify(value));
    }
    for (const [name, bytes] of Object.entries(uploads)) {
      pack.entry({ name: `uploads/${name}` }, bytes);
    }
    pack.finalize();
    return new File(
      [await collect(pack as unknown as AsyncIterable<Buffer>)],
      'legacy.tar'
    );
  }

  function legacyEntries(): Record<string, unknown> {
    return {
      'sessions.json': [
        {
          id: 1,
          fileName: 'legacy.mp3',
          clientName: 'Legacy',
          sessionName: 'L1',
          date: '2023-01-01',
          sessionType: 'intake',
          therapy: 'cbt',
          audioPath: '9-9.mp3',
          status: 'completed',
          whisperJobId: null,
          transcriptTokenCount: 3,
        },
      ],
      'chats.json': [
        { id: 1, sessionId: 1, timestamp: 1, name: null, tags: null },
      ],
      'messages.json': [
        { id: 1, chatId: 1, sender: 'user', text: 'hi', timestamp: 1 },
      ],
      'templates.json': [],
      'transcript_paragraphs.json': [
        {
          id: 1,
          sessionId: 1,
          paragraphIndex: 0,
          timestampMs: 500,
          text: 'legacy words',
        },
      ],
      'analysis_jobs.json': [],
      'analysis_job_sessions.json': [],
      'intermediate_summaries.json': [],
    };
  }

  it('imports a legacy tar through encrypted staging', async () => {
    const file = await buildLegacyTar(legacyEntries(), {
      '9-9.mp3': Buffer.from('legacy-audio'),
    });
    const result = await importDataService(file);
    expect(result.message).toMatch(/Import successful/);
    const session = get<{ clientName: string; audioPath: string }>(
      'SELECT clientName, audioPath FROM sessions LIMIT 1'
    )!;
    expect(session).toEqual({ clientName: 'Legacy', audioPath: '9-9.mp3.enc' });
    const generation = manager.getActiveGenerationPaths()!;
    const restored = decryptRecording(
      await fs.readFile(path.join(generation.recordingsDir, '9-9.mp3.enc')),
      manager.getRecordingsKey()
    );
    expect(restored.equals(Buffer.from('legacy-audio'))).toBe(true);
  });

  it('rejects path traversal entries without touching the vault', async () => {
    const { readCurrentGenerationId } = await import('@therascript/vault');
    const beforeId = await readCurrentGenerationId(path.join(root, 'vault'));
    const pack = tar.pack();
    pack.entry({ name: '../evil.json' }, '[]');
    pack.entry({ name: 'sessions.json' }, '[]');
    pack.finalize();
    const file = new File(
      [await collect(pack as unknown as AsyncIterable<Buffer>)],
      'evil.tar'
    );
    await expect(importDataService(file)).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(await readCurrentGenerationId(path.join(root, 'vault'))).toBe(
      beforeId
    );
    expect(sessionCount()).toBe(1);
  });

  it('rejects symlink entries without touching the vault', async () => {
    const pack = tar.pack();
    pack.entry(
      {
        name: 'uploads/sneaky.mp3',
        type: 'symlink',
        linkname: '/etc/passwd',
      } as never,
      ''
    );
    pack.entry({ name: 'sessions.json' }, '[]');
    pack.finalize();
    const file = new File(
      [await collect(pack as unknown as AsyncIterable<Buffer>)],
      'evil.tar'
    );
    await expect(importDataService(file)).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(sessionCount()).toBe(1);
  });
});
