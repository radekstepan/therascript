// @vitest-environment node
// packages/api/src/services/vaultAudioService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  initializeDatabase,
  attachUnlockedDb,
  closeDb,
  type SQLiteDatabase,
} from '@therascript/db';
import { TEST_KDF_PARAMS, type VaultKeys } from '@therascript/vault';
import {
  VaultManager,
  setVaultManagerForTests,
  resetVaultManager,
  type VaultDbOps,
  type WorkerHandle,
  type WorkerLauncher,
  type StagedGenerationRef,
} from './vaultManager.js';
import {
  saveVaultAudio,
  deleteVaultAudio,
  getVaultAudioEncPath,
  getVaultAudioPlaintextSize,
  readVaultAudioRange,
  readVaultAudioFull,
  isVaultAudioAvailable,
  isVaultAudioId,
  audioIdToOriginalName,
  saveSessionAudio,
  deleteSessionAudio,
  isSessionAudioAvailable,
} from './vaultAudioService.js';

class FakeWorkerLauncher implements WorkerLauncher {
  async startWorker(): Promise<WorkerHandle> {
    return { pid: 1, kill: async () => {}, waitForExit: async () => {} };
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

let root: string;
let manager: VaultManager;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-audio-test-'));
  manager = new VaultManager({
    vaultRoot: path.join(root, 'vault'),
    legacyDbPath: path.join(root, 'legacy.sqlite'),
    legacyUploadsDir: path.join(root, 'uploads'),
    workerLauncher: new FakeWorkerLauncher(),
    dbOps: fakeDbOps,
    kdfParams: TEST_KDF_PARAMS,
    cipherProbe: () => true,
  });
  await manager.enable();
  setVaultManagerForTests(manager);
  await manager.setup('password123');
});

afterEach(async () => {
  setVaultManagerForTests(null);
  await manager.shutdown().catch(() => {});
  resetVaultManager();
  closeDb();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('vault audio storage', () => {
  it('saves encrypted audio and round-trips bytes', async () => {
    const original = randomBytes(5000);
    const id = await saveVaultAudio(3, 'talk.mp3', original);
    expect(id).toMatch(/^3-\d+\.mp3\.enc$/);
    const encPath = getVaultAudioEncPath(id)!;
    expect(encPath).toContain('recordings');
    expect((await fs.stat(encPath)).mode & 0o777).toBe(0o600);
    // Ciphertext reveals nothing of the plaintext.
    expect(
      (await fs.readFile(encPath)).includes(original.subarray(0, 100))
    ).toBe(false);
    await expect(readVaultAudioFull(id)).resolves.toEqual(original);
    await expect(getVaultAudioPlaintextSize(id)).resolves.toBe(original.length);
  });

  it('decrypts ranges for playback', async () => {
    const original = randomBytes(200000);
    const id = await saveVaultAudio(3, 'talk.mp3', original);
    await expect(readVaultAudioRange(id, 0, 99)).resolves.toEqual(
      original.subarray(0, 100)
    );
    await expect(readVaultAudioRange(id, 1000, 2000)).resolves.toEqual(
      original.subarray(1000, 2001)
    );
    // Cross-chunk span (64 KiB chunks).
    await expect(readVaultAudioRange(id, 65530, 65545)).resolves.toEqual(
      original.subarray(65530, 65546)
    );
  });

  it('reports availability and deletes', async () => {
    expect(isVaultAudioAvailable('nope.mp3.enc')).toBe(false);
    const id = await saveVaultAudio(3, 'talk.mp3', randomBytes(100));
    expect(isVaultAudioAvailable(id)).toBe(true);
    await deleteVaultAudio(id);
    expect(isVaultAudioAvailable(id)).toBe(false);
    await expect(readVaultAudioFull(id)).rejects.toThrow(/Audio not found/);
  });

  it('rejects non-vault ids and traversal', () => {
    expect(getVaultAudioEncPath(null)).toBeNull();
    expect(getVaultAudioEncPath('plain.mp3')).toBeNull();
    expect(getVaultAudioEncPath('../vault.db')).toBeNull();
    expect(getVaultAudioEncPath('sub/dir/x.mp3.enc')).toBeNull();
    expect(getVaultAudioEncPath('')).toBeNull();
  });

  it('unified helpers route to vault storage when protected', async () => {
    const original = randomBytes(1000);
    const id = await saveSessionAudio(9, 'note.wav', original);
    expect(isVaultAudioId(id)).toBe(true);
    expect(isSessionAudioAvailable(id)).toBe(true);
    expect(audioIdToOriginalName(id)).toBe('9-' + id.slice(2, id.length - 4));
    await deleteSessionAudio(id);
    expect(isSessionAudioAvailable(id)).toBe(false);
    await deleteSessionAudio(null);
  });
});

describe('audio id helpers', () => {
  it('classifies ids and strips the suffix', () => {
    expect(isVaultAudioId('1-2.mp3.enc')).toBe(true);
    expect(isVaultAudioId('1-2.mp3')).toBe(false);
    expect(isVaultAudioId(null)).toBe(false);
    expect(isVaultAudioId(undefined)).toBe(false);
    expect(audioIdToOriginalName('1-2.mp3.enc')).toBe('1-2.mp3');
    expect(audioIdToOriginalName('1-2.mp3')).toBe('1-2.mp3');
  });
});
