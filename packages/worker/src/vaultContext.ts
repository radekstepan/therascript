// packages/worker/src/vaultContext.ts
//
// Worker-side vault state. Under API supervision the
// worker receives the unwrapped data keys over an inherited private pipe
// (fd from THERASCRIPT_VAULT_FD, never argv/env/Redis/logs) and keeps
// them in process memory until shutdown. Standalone boots (local dev
// without a vault) leave the context empty and run the legacy paths.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getAudioAbsolutePath } from '@therascript/services';
import { stagePlaintextTemp, type VaultKeys } from '@therascript/vault';

export interface WorkerVaultContext {
  keys: VaultKeys;
  generationId: string;
  dbPath: string;
  recordingsDir: string;
}

let context: WorkerVaultContext | null = null;

export function setWorkerVaultContext(next: WorkerVaultContext): void {
  context = next;
}

/** Test-only reset back to standalone (legacy) behavior. */
export function clearWorkerVaultContext(): void {
  context = null;
}

export function getWorkerVaultContext(): WorkerVaultContext | null {
  return context;
}

/** True when this worker was supervised-started into a vault. */
export function isVaultWorker(): boolean {
  return context !== null;
}

/** Vault workers skip Elasticsearch: FTS triggers index every write. */
export function shouldSkipElasticsearch(): boolean {
  return isVaultWorker();
}

export interface ResolvedWorkerAudio {
  /** Plaintext path for the Whisper service (staged temp file in vault mode). */
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Resolves a session audio id to a readable plaintext path. Vault
 * recordings decrypt into a private 0600 staging file that the caller
 * must release via `cleanup()`; legacy uploads resolve in place with a
 * no-op cleanup. Throws when the audio does not exist.
 */
export async function resolveWorkerAudioPath(
  audioId: string | null | undefined
): Promise<ResolvedWorkerAudio> {
  if (!audioId) {
    throw new Error('No audio file associated with this session.');
  }
  if (context && audioId.endsWith('.enc')) {
    const base = path.basename(audioId);
    if (base !== audioId) {
      throw new Error(`Invalid audio identifier: ${JSON.stringify(audioId)}`);
    }
    const encPath = path.resolve(context.recordingsDir, base);
    const relative = path.relative(context.recordingsDir, encPath);
    if (
      relative === '' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !existsSync(encPath)
    ) {
      throw new Error(`Audio file not found: ${audioId}`);
    }
    const staged = await stagePlaintextTemp(encPath, context.keys.recordings, {
      prefix: 'therascript-transcribe-',
    });
    return { path: staged.path, cleanup: staged.cleanup };
  }
  const legacyPath = getAudioAbsolutePath(audioId);
  if (!legacyPath) {
    throw new Error(`Audio file not found: ${audioId}`);
  }
  return { path: legacyPath, cleanup: async () => {} };
}
