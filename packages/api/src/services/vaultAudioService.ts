// packages/api/src/services/vaultAudioService.ts
//
// Vault-aware session audio storage. In vault mode,
// recordings are AES-GCM chunked containers (`<id>.enc`) inside the
// active generation's recordings dir; playback decrypts only the
// requested byte range. In legacy mode everything delegates to the
// plaintext uploads dir. Callers branch on `isProtectionActive()` —
// audio ids are uniformly `.enc`-suffixed under vault mode (migration
// rewrites legacy rows, new uploads write vault ids directly).
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  encryptRecording,
  decryptRecording,
  decryptRecordingFileRange,
  getRecordingFilePlaintextSize,
  type VaultKeys,
} from '@therascript/vault';
import {
  getUploadsDir,
  getAudioAbsolutePath,
  saveUploadedAudio,
  deleteUploadedAudioFile,
} from '@therascript/services';
import { getVaultManager } from './vaultManager.js';

export const VAULT_AUDIO_SUFFIX = '.enc';

/** Vault-shaped audio ids always end in `.enc` (vault mode invariant). */
export function isVaultAudioId(audioId: string | null | undefined): boolean {
  return typeof audioId === 'string' && audioId.endsWith(VAULT_AUDIO_SUFFIX);
}

/**
 * Resolves an audio id to its absolute `.enc` path inside the active
 * generation, or null when the id is missing, not vault-shaped, outside
 * the recordings dir, or the file does not exist.
 */
export function getVaultAudioEncPath(
  audioId: string | null | undefined
): string | null {
  if (!isVaultAudioId(audioId)) return null;
  const generation = getVaultManager().getActiveGenerationPaths();
  if (!generation) return null;
  const base = path.basename(audioId as string);
  if (base !== audioId) return null;
  const absolute = path.resolve(generation.recordingsDir, base);
  const relative = path.relative(generation.recordingsDir, absolute);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return existsSync(absolute) ? absolute : null;
}

/** Original filename for an audio id (vault suffix stripped for mime sniffing). */
export function audioIdToOriginalName(audioId: string): string {
  return audioId.endsWith(VAULT_AUDIO_SUFFIX)
    ? audioId.slice(0, -VAULT_AUDIO_SUFFIX.length)
    : audioId;
}

export function isVaultAudioAvailable(
  audioId: string | null | undefined
): boolean {
  return getVaultAudioEncPath(audioId) !== null;
}

function recordingsKey(): Buffer {
  return getVaultManager().getRecordingsKey();
}

export function getActiveRecordingsKey(): Buffer {
  return recordingsKey();
}

/** Encrypts and stores an upload, returning its vault audio id. */
export async function saveVaultAudio(
  sessionId: number,
  originalFilename: string,
  audioData: Buffer
): Promise<string> {
  const generation = getVaultManager().getActiveGenerationPaths();
  if (!generation) {
    throw new Error('Vault is locked');
  }
  const extension = path.extname(originalFilename);
  const id = `${sessionId}-${Date.now()}${extension}${VAULT_AUDIO_SUFFIX}`;
  const target = path.join(generation.recordingsDir, id);
  await fs.writeFile(target, encryptRecording(audioData, recordingsKey()), {
    mode: 0o600,
  });
  await fs.chmod(target, 0o600);
  return id;
}

export async function deleteVaultAudio(
  audioId: string | null | undefined
): Promise<void> {
  const encPath = getVaultAudioEncPath(audioId);
  if (!encPath) return;
  await fs.rm(encPath, { force: true });
}

/** Plaintext size of a vault recording without decrypting it. */
export async function getVaultAudioPlaintextSize(
  audioId: string
): Promise<number> {
  const encPath = getVaultAudioEncPath(audioId);
  if (!encPath) throw new Error(`Audio not found: ${audioId}`);
  return getRecordingFilePlaintextSize(encPath);
}

/** Decrypts plaintext bytes `[start, end]` (inclusive) for range playback. */
export async function readVaultAudioRange(
  audioId: string,
  start: number,
  endInclusive: number
): Promise<Buffer> {
  const encPath = getVaultAudioEncPath(audioId);
  if (!encPath) throw new Error(`Audio not found: ${audioId}`);
  return decryptRecordingFileRange(
    encPath,
    recordingsKey(),
    start,
    endInclusive + 1
  );
}

/** Decrypts a whole vault recording (backups, non-range playback). */
export async function readVaultAudioFull(audioId: string): Promise<Buffer> {
  const encPath = getVaultAudioEncPath(audioId);
  if (!encPath) throw new Error(`Audio not found: ${audioId}`);
  return decryptRecording(await fs.readFile(encPath), recordingsKey());
}

// --- Unified call-site helpers (vault when protected, legacy otherwise) ---

export async function saveSessionAudio(
  sessionId: number,
  originalFilename: string,
  audioData: Buffer
): Promise<string> {
  if (getVaultManager().isProtectionActive()) {
    return saveVaultAudio(sessionId, originalFilename, audioData);
  }
  return saveUploadedAudio(sessionId, originalFilename, audioData);
}

export async function deleteSessionAudio(
  audioId: string | null | undefined
): Promise<void> {
  if (!audioId) return;
  if (getVaultManager().isProtectionActive()) {
    await deleteVaultAudio(audioId);
    return;
  }
  await deleteUploadedAudioFile(audioId);
}

export function isSessionAudioAvailable(
  audioId: string | null | undefined
): boolean {
  if (!audioId) return false;
  if (getVaultManager().isProtectionActive()) {
    return isVaultAudioAvailable(audioId);
  }
  const absolute = getAudioAbsolutePath(audioId);
  return absolute !== null && existsSync(absolute);
}

export function getLegacyUploadsDir(): string {
  return getUploadsDir();
}

export type { VaultKeys };
