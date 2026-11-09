// @vitest-environment node
// packages/worker/src/vaultContext.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encryptRecording } from '@therascript/vault';
import {
  setWorkerVaultContext,
  clearWorkerVaultContext,
  getWorkerVaultContext,
  isVaultWorker,
  shouldSkipElasticsearch,
  resolveWorkerAudioPath,
} from './vaultContext.js';

let root: string;
let recordingsDir: string;
const keys = { database: randomBytes(32), recordings: randomBytes(32) };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-vault-test-'));
  recordingsDir = path.join(root, 'recordings');
  await fs.mkdir(recordingsDir, { recursive: true });
  clearWorkerVaultContext();
});

afterEach(async () => {
  clearWorkerVaultContext();
  await fs.rm(root, { recursive: true, force: true });
});

describe('worker vault context', () => {
  it('starts empty (standalone legacy behavior)', () => {
    expect(getWorkerVaultContext()).toBeNull();
    expect(isVaultWorker()).toBe(false);
    expect(shouldSkipElasticsearch()).toBe(false);
  });

  it('activates vault behavior once set', () => {
    setWorkerVaultContext({
      keys,
      generationId: 'gen_test',
      dbPath: path.join(root, 'vault.db'),
      recordingsDir,
    });
    expect(isVaultWorker()).toBe(true);
    expect(shouldSkipElasticsearch()).toBe(true);
    expect(getWorkerVaultContext()?.generationId).toBe('gen_test');
  });

  it('rejects missing audio ids', async () => {
    await expect(resolveWorkerAudioPath(null)).rejects.toThrow(/No audio/);
    await expect(resolveWorkerAudioPath('')).rejects.toThrow(/No audio/);
  });
});

describe('resolveWorkerAudioPath in vault mode', () => {
  const audio = Buffer.from('worker-audio-bytes');

  beforeEach(async () => {
    setWorkerVaultContext({
      keys,
      generationId: 'gen_test',
      dbPath: path.join(root, 'vault.db'),
      recordingsDir,
    });
    await fs.writeFile(
      path.join(recordingsDir, '5-5.mp3.enc'),
      encryptRecording(audio, keys.recordings)
    );
  });

  it('stages decrypted plaintext and cleans up', async () => {
    const resolved = await resolveWorkerAudioPath('5-5.mp3.enc');
    expect(resolved.path).not.toContain(recordingsDir);
    expect(await fs.readFile(resolved.path)).toEqual(audio);
    expect((await fs.stat(resolved.path)).mode & 0o777).toBe(0o600);
    await resolved.cleanup();
    await expect(fs.access(resolved.path)).rejects.toThrow();
  });

  it('rejects traversal and missing files', async () => {
    await expect(resolveWorkerAudioPath('../vault.db')).rejects.toThrow();
    await expect(resolveWorkerAudioPath('sub/x.mp3.enc')).rejects.toThrow();
    await expect(resolveWorkerAudioPath('missing.mp3.enc')).rejects.toThrow(
      /not found/
    );
  });
});
