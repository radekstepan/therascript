// packages/vault/src/generations.ts
//
// Generation layout:
//
//   <vaultRoot>/
//     CURRENT                      active generation id (e.g. "gen_lx2…_9f3c1a")
//     STAGING                      id of the generation being built (setup/restore)
//     CLEANUP.json                 legacy paths still awaiting deletion (crash-safe)
//     generations/
//       <genId>/
//         vault.db                 encrypted database
//         vault.db-wal / -shm      sidecars while open (inside the vault dir)
//         keys.json                wrapped database + recordings keys (0600)
//         SEALED                   marker written after fsync, before cutover
//         recordings/              encrypted audio files (*.enc)
//
// Cutover is an atomic CURRENT replacement: the staged generation is fully
// verified and sealed first, then CURRENT.tmp is fsynced, renamed over
// CURRENT, and the vault directory is fsynced. A crash on either side of
// the rename leaves a recoverable state: CURRENT always names a complete
// generation.
import {
  promises as fs,
  constants as fsConstants,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { VaultFormatError, VaultStateError } from './errors.js';
import { assertValidEnvelopeShape, type VaultKeyEnvelope } from './keys.js';

export const GENERATIONS_DIR = 'generations';
export const CURRENT_FILE = 'CURRENT';
export const STAGING_FILE = 'STAGING';
export const CLEANUP_FILE = 'CLEANUP.json';
export const DB_FILE = 'vault.db';
export const KEYS_FILE = 'keys.json';
export const SEALED_FILE = 'SEALED';
export const RECORDINGS_DIR = 'recordings';

const GENERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface GenerationPaths {
  id: string;
  dir: string;
  dbPath: string;
  keysPath: string;
  sealedPath: string;
  recordingsDir: string;
}

export function generateGenerationId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `gen_${stamp}_${randomBytes(4).toString('hex')}`;
}

export function assertValidGenerationId(id: string): void {
  if (!GENERATION_ID_PATTERN.test(id)) {
    throw new VaultFormatError(`Invalid generation id: ${JSON.stringify(id)}`);
  }
}

export function resolveGenerationPaths(
  vaultRoot: string,
  id: string
): GenerationPaths {
  assertValidGenerationId(id);
  const dir = path.join(vaultRoot, GENERATIONS_DIR, id);
  return {
    id,
    dir,
    dbPath: path.join(dir, DB_FILE),
    keysPath: path.join(dir, KEYS_FILE),
    sealedPath: path.join(dir, SEALED_FILE),
    recordingsDir: path.join(dir, RECORDINGS_DIR),
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function syncFile(filePath: string): void {
  const fd = openSync(filePath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Best-effort directory fsync. Returns false (instead of throwing) on
 * platforms/filesystems that cannot fsync a directory handle, since the
 * atomic rename itself is the correctness mechanism and dir fsync is the
 * durability polish.
 */
function trySyncDir(dirPath: string): boolean {
  try {
    const fd = openSync(dirPath, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureVaultRoot(vaultRoot: string): Promise<void> {
  await fs.mkdir(path.join(vaultRoot, GENERATIONS_DIR), { recursive: true });
}

/** Creates a new staged generation directory and records it in STAGING. */
export async function createStagedGeneration(
  vaultRoot: string
): Promise<GenerationPaths> {
  await ensureVaultRoot(vaultRoot);
  const paths = resolveGenerationPaths(vaultRoot, generateGenerationId());
  await fs.mkdir(paths.recordingsDir, { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, STAGING_FILE),
    `${paths.id}\n`,
    'utf8'
  );
  trySyncDir(vaultRoot);
  return paths;
}

export async function readCurrentGenerationId(
  vaultRoot: string
): Promise<string | null> {
  const currentPath = path.join(vaultRoot, CURRENT_FILE);
  if (!(await pathExists(currentPath))) return null;
  const raw = (await fs.readFile(currentPath, 'utf8')).trim();
  if (raw === '') return null;
  assertValidGenerationId(raw);
  return raw;
}

export async function readStagingGenerationId(
  vaultRoot: string
): Promise<string | null> {
  const stagingPath = path.join(vaultRoot, STAGING_FILE);
  if (!(await pathExists(stagingPath))) return null;
  const raw = (await fs.readFile(stagingPath, 'utf8')).trim();
  if (raw === '') return null;
  assertValidGenerationId(raw);
  return raw;
}

export async function getActiveGeneration(
  vaultRoot: string
): Promise<GenerationPaths | null> {
  const id = await readCurrentGenerationId(vaultRoot);
  if (!id) return null;
  return resolveGenerationPaths(vaultRoot, id);
}

export async function writeKeysEnvelope(
  keysPath: string,
  envelope: VaultKeyEnvelope
): Promise<void> {
  assertValidEnvelopeShape(envelope);
  await fs.writeFile(keysPath, JSON.stringify(envelope, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.chmod(keysPath, 0o600);
}

export async function readKeysEnvelope(
  keysPath: string
): Promise<VaultKeyEnvelope> {
  let raw: string;
  try {
    raw = await fs.readFile(keysPath, 'utf8');
  } catch {
    throw new VaultFormatError(`Missing vault keys file: ${keysPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VaultFormatError(`Corrupt vault keys file: ${keysPath}`);
  }
  assertValidEnvelopeShape(parsed);
  return parsed;
}

/**
 * Structural verification before cutover: database file present and
 * non-empty, keys parse, recordings directory exists, SEALED marker
 * present. Content verification (PRAGMA integrity_check, record counts,
 * recording references) runs against the open staged database by the
 * caller — see `verifyAndSealGeneration` in the API layer.
 */
export async function verifyStagedGeneration(
  paths: GenerationPaths
): Promise<void> {
  const fail = (detail: string): never => {
    throw new VaultFormatError(
      `Staged generation ${paths.id} is incomplete: ${detail}`
    );
  };
  let dbStat;
  try {
    dbStat = await fs.stat(paths.dbPath);
  } catch {
    fail('database file missing');
    throw new Error('unreachable');
  }
  if (!dbStat.isFile() || dbStat.size === 0) fail('database file empty');
  if (!(await pathExists(paths.recordingsDir))) fail('recordings dir missing');
  await readKeysEnvelope(paths.keysPath).catch(() => fail('keys unreadable'));
  if (!(await pathExists(paths.sealedPath))) fail('SEALED marker missing');
}

/** Flush staged files to durable storage and write the SEALED marker. */
export async function sealGeneration(paths: GenerationPaths): Promise<void> {
  syncFile(paths.dbPath);
  syncFile(paths.keysPath);
  await fs.writeFile(paths.sealedPath, `${new Date().toISOString()}\n`, 'utf8');
  syncFile(paths.sealedPath);
  trySyncDir(paths.recordingsDir);
  trySyncDir(paths.dir);
}

/**
 * Atomically makes `genId` the active generation. The staged generation
 * must already be verified and sealed.
 */
export async function replaceCurrentGeneration(
  vaultRoot: string,
  genId: string
): Promise<GenerationPaths> {
  const paths = resolveGenerationPaths(vaultRoot, genId);
  await verifyStagedGeneration(paths);
  const currentPath = path.join(vaultRoot, CURRENT_FILE);
  const tmpPath = `${currentPath}.tmp`;
  await fs.writeFile(tmpPath, `${genId}\n`, 'utf8');
  syncFile(tmpPath);
  await fs.rename(tmpPath, currentPath);
  trySyncDir(vaultRoot);
  await fs.rm(path.join(vaultRoot, STAGING_FILE), { force: true });
  trySyncDir(vaultRoot);
  return paths;
}

/** Deletes a staged (never-activated) generation. Refuses the active one. */
export async function discardStagedGeneration(
  vaultRoot: string,
  paths: GenerationPaths
): Promise<void> {
  const current = await readCurrentGenerationId(vaultRoot);
  if (current !== null && current === paths.id) {
    throw new VaultStateError(
      `Refusing to discard the active generation ${paths.id}`
    );
  }
  await fs.rm(paths.dir, { recursive: true, force: true });
  const staging = await readStagingGenerationId(vaultRoot);
  if (staging === paths.id) {
    await fs.rm(path.join(vaultRoot, STAGING_FILE), { force: true });
  }
}

export interface VaultRecovery {
  activeId: string | null;
  completedCutover: boolean;
  discardedStagingId: string | null;
}

/**
 * Restart recovery (track which side of the cutover completed):
 *
 * - CURRENT valid → active; a leftover STAGING entry for a *different* id is
 *   an interrupted build and is discarded.
 * - CURRENT missing but STAGING names a sealed, complete generation → the
 *   crash happened after seal but before rename; complete the cutover.
 * - Otherwise → no vault (fresh install or interrupted pre-seal build, which
 *   is discarded).
 */
export async function recoverVaultLayout(
  vaultRoot: string
): Promise<VaultRecovery> {
  const activeId = (await pathExists(vaultRoot))
    ? await readCurrentGenerationId(vaultRoot)
    : null;
  const stagingId = (await pathExists(vaultRoot))
    ? await readStagingGenerationId(vaultRoot)
    : null;

  if (activeId) {
    if (stagingId && stagingId !== activeId) {
      await discardStagedGeneration(
        vaultRoot,
        resolveGenerationPaths(vaultRoot, stagingId)
      );
      return {
        activeId,
        completedCutover: false,
        discardedStagingId: stagingId,
      };
    }
    return { activeId, completedCutover: false, discardedStagingId: null };
  }

  if (stagingId) {
    const staged = resolveGenerationPaths(vaultRoot, stagingId);
    try {
      await verifyStagedGeneration(staged);
    } catch {
      await discardStagedGeneration(vaultRoot, staged);
      return {
        activeId: null,
        completedCutover: false,
        discardedStagingId: stagingId,
      };
    }
    await replaceCurrentGeneration(vaultRoot, stagingId);
    return {
      activeId: stagingId,
      completedCutover: true,
      discardedStagingId: null,
    };
  }

  return { activeId: null, completedCutover: false, discardedStagingId: null };
}

export async function listGenerationIds(vaultRoot: string): Promise<string[]> {
  const dir = path.join(vaultRoot, GENERATIONS_DIR);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries.filter((entry) => GENERATION_ID_PATTERN.test(entry)).sort();
}

// --- Crash-safe legacy cleanup -------------------------------------------

export interface CleanupManifest {
  version: 1;
  createdAt: string;
  paths: string[];
}

export async function writeCleanupManifest(
  vaultRoot: string,
  absolutePaths: string[]
): Promise<void> {
  const manifest: CleanupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    paths: [...absolutePaths].sort(),
  };
  await fs.writeFile(
    path.join(vaultRoot, CLEANUP_FILE),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

export interface CleanupResult {
  removed: string[];
  missing: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Deletes every path listed in CLEANUP.json (files or directories).
 * Interrupted cleanup resumes on the next call: the manifest is rewritten
 * with the remainder, or removed when nothing is left.
 */
export async function resumeInterruptedCleanup(
  vaultRoot: string
): Promise<CleanupResult | null> {
  const manifestPath = path.join(vaultRoot, CLEANUP_FILE);
  if (!(await pathExists(manifestPath))) return null;
  let manifest: CleanupManifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(manifestPath, 'utf8')
    ) as CleanupManifest;
  } catch {
    throw new VaultFormatError('Corrupt vault cleanup manifest');
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.paths)) {
    throw new VaultFormatError('Corrupt vault cleanup manifest');
  }
  const result: CleanupResult = { removed: [], missing: [], failed: [] };
  const remaining: string[] = [];
  for (const target of manifest.paths) {
    if (typeof target !== 'string' || target === '') {
      continue;
    }
    if (!(await pathExists(target))) {
      result.missing.push(target);
      continue;
    }
    try {
      await fs.rm(target, { recursive: true, force: true });
      result.removed.push(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ path: target, error: message });
      remaining.push(target);
    }
  }
  if (remaining.length === 0) {
    await fs.rm(manifestPath, { force: true });
  } else {
    await writeCleanupManifest(vaultRoot, remaining);
  }
  return result;
}
