// @vitest-environment node
// packages/vault/src/generations.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createStagedGeneration,
  readCurrentGenerationId,
  replaceCurrentGeneration,
  discardStagedGeneration,
  recoverVaultLayout,
  listGenerationIds,
  sealGeneration,
  verifyStagedGeneration,
  writeKeysEnvelope,
  readKeysEnvelope,
  writeCleanupManifest,
  resumeInterruptedCleanup,
  resolveGenerationPaths,
  CURRENT_FILE,
  STAGING_FILE,
} from './generations.js';
import { generateVaultKeys, wrapVaultKeys, TEST_KDF_PARAMS } from './keys.js';
import { VaultFormatError, VaultStateError } from './errors.js';

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-gen-test-'));
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

async function buildCompleteStaged() {
  const staged = await createStagedGeneration(vaultRoot);
  await fs.writeFile(staged.dbPath, Buffer.alloc(64, 1));
  await writeKeysEnvelope(
    staged.keysPath,
    await wrapVaultKeys(generateVaultKeys(), 'pw', TEST_KDF_PARAMS)
  );
  await sealGeneration(staged);
  return staged;
}

describe('generation lifecycle', () => {
  it('starts with no active generation', async () => {
    await expect(readCurrentGenerationId(vaultRoot)).resolves.toBeNull();
    await expect(listGenerationIds(vaultRoot)).resolves.toEqual([]);
  });

  it('cuts over atomically and leaves no STAGING behind', async () => {
    const staged = await buildCompleteStaged();
    await replaceCurrentGeneration(vaultRoot, staged.id);
    await expect(readCurrentGenerationId(vaultRoot)).resolves.toBe(staged.id);
    await expect(
      fs.access(path.join(vaultRoot, STAGING_FILE)).then(
        () => true,
        () => false
      )
    ).resolves.toBe(false);
  });

  it('refuses cutover of an incomplete generation', async () => {
    const staged = await createStagedGeneration(vaultRoot);
    await expect(
      replaceCurrentGeneration(vaultRoot, staged.id)
    ).rejects.toBeInstanceOf(VaultFormatError);
    await expect(readCurrentGenerationId(vaultRoot)).resolves.toBeNull();
  });

  it('refuses cutover of an unsealed generation', async () => {
    const staged = await createStagedGeneration(vaultRoot);
    await fs.writeFile(staged.dbPath, Buffer.alloc(64, 1));
    await writeKeysEnvelope(
      staged.keysPath,
      await wrapVaultKeys(generateVaultKeys(), 'pw', TEST_KDF_PARAMS)
    );
    await expect(verifyStagedGeneration(staged)).rejects.toBeInstanceOf(
      VaultFormatError
    );
  });

  it('refuses to discard the active generation', async () => {
    const staged = await buildCompleteStaged();
    await replaceCurrentGeneration(vaultRoot, staged.id);
    await expect(
      discardStagedGeneration(vaultRoot, staged)
    ).rejects.toBeInstanceOf(VaultStateError);
  });

  it('rejects a corrupt CURRENT file', async () => {
    await fs.writeFile(
      path.join(vaultRoot, CURRENT_FILE),
      '../../etc\n',
      'utf8'
    );
    await expect(readCurrentGenerationId(vaultRoot)).rejects.toBeInstanceOf(
      VaultFormatError
    );
  });
});

describe('recoverVaultLayout', () => {
  it('completes a cutover that crashed after seal but before rename', async () => {
    const staged = await buildCompleteStaged();
    // STAGING exists, CURRENT missing: exactly the post-seal crash window.
    const recovery = await recoverVaultLayout(vaultRoot);
    expect(recovery).toEqual({
      activeId: staged.id,
      completedCutover: true,
      discardedStagingId: null,
    });
    await expect(readCurrentGenerationId(vaultRoot)).resolves.toBe(staged.id);
  });

  it('discards an interrupted pre-seal build', async () => {
    const staged = await createStagedGeneration(vaultRoot);
    const recovery = await recoverVaultLayout(vaultRoot);
    expect(recovery.activeId).toBeNull();
    expect(recovery.completedCutover).toBe(false);
    expect(recovery.discardedStagingId).toBe(staged.id);
    await expect(listGenerationIds(vaultRoot)).resolves.toEqual([]);
  });

  it('discards leftover staging once another generation is active', async () => {
    const first = await buildCompleteStaged();
    await replaceCurrentGeneration(vaultRoot, first.id);
    const second = await createStagedGeneration(vaultRoot);
    const recovery = await recoverVaultLayout(vaultRoot);
    expect(recovery.activeId).toBe(first.id);
    expect(recovery.discardedStagingId).toBe(second.id);
  });
});

describe('keys envelope persistence', () => {
  it('round-trips the envelope with 0600 permissions', async () => {
    const staged = await createStagedGeneration(vaultRoot);
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'pw',
      TEST_KDF_PARAMS
    );
    await writeKeysEnvelope(staged.keysPath, envelope);
    const mode = (await fs.stat(staged.keysPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    await expect(readKeysEnvelope(staged.keysPath)).resolves.toEqual(envelope);
  });

  it('reports a missing keys file as a format error', async () => {
    const staged = resolveGenerationPaths(vaultRoot, 'gen_missing');
    await expect(readKeysEnvelope(staged.keysPath)).rejects.toBeInstanceOf(
      VaultFormatError
    );
  });
});

describe('crash-safe legacy cleanup', () => {
  it('removes listed paths and the manifest', async () => {
    const legacyDb = path.join(vaultRoot, 'legacy.sqlite');
    const legacyDir = path.join(vaultRoot, 'legacy-uploads');
    await fs.writeFile(legacyDb, 'x');
    await fs.mkdir(legacyDir, { recursive: true });
    await writeCleanupManifest(vaultRoot, [legacyDb, legacyDir]);
    const result = await resumeInterruptedCleanup(vaultRoot);
    expect(result?.removed.sort()).toEqual([legacyDb, legacyDir].sort());
    expect(result?.failed).toEqual([]);
    await expect(resumeInterruptedCleanup(vaultRoot)).resolves.toBeNull();
  });

  it('tolerates already-missing paths', async () => {
    await writeCleanupManifest(vaultRoot, [path.join(vaultRoot, 'gone')]);
    const result = await resumeInterruptedCleanup(vaultRoot);
    expect(result?.missing).toHaveLength(1);
    expect(result?.failed).toEqual([]);
  });
});
