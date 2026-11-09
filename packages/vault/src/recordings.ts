// packages/vault/src/recordings.ts
//
// Encrypted recording storage. Audio bytes are sealed with
// AES-256-GCM in fixed-size chunks so playback can decrypt an HTTP range
// without touching the rest of the file:
//
//   magic "VREC01" (6) || baseNonce (12) || chunkSize BE-u32 (4)
//     || plaintextSize BE-u64 (8) || ctChunk[0] || ... || ctChunk[n-1]
//
// Every plaintext chunk except the last is exactly `chunkSize` bytes, so
// ciphertext chunk boundaries are pure arithmetic (ct length = pt + 16 tag
// bytes). Chunk `i` uses nonce `baseNonce XOR (0x00*8 || BE-u32(i))` and
// AAD `magic || baseNonce || BE-u32(chunkSize) || BE-u64(plaintextSize)
// || BE-u64(i)`, binding each chunk to its position and the total length:
// reordering, truncating, or dropping trailing chunks fails auth (or the
// layout check against the sealed plaintext size).
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { VaultAuthError, VaultFormatError } from './errors.js';
import { VAULT_KEY_BYTES } from './keys.js';

export const RECORDING_MAGIC = 'VREC01';
export const RECORDING_HEADER_BYTES = 6 + 12 + 4 + 8;
export const RECORDING_CHUNK_SIZE = 64 * 1024;
export const RECORDING_TAG_BYTES = 16;

export interface RecordingHeader {
  baseNonce: Buffer;
  chunkSize: number;
  chunkCount: number;
  /** Plaintext length in bytes, derived from the container size. */
  plaintextSize: number;
}

function assertRecordingsKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== VAULT_KEY_BYTES) {
    throw new Error('Invalid recordings key');
  }
}

function chunkNonce(baseNonce: Buffer, index: number): Buffer {
  const nonce = Buffer.from(baseNonce);
  nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ index) >>> 0, 8);
  return nonce;
}

function chunkAad(
  baseNonce: Buffer,
  chunkSize: number,
  plaintextSize: number,
  index: number
): Buffer {
  const aad = Buffer.alloc(6 + 12 + 4 + 8 + 8);
  Buffer.from(RECORDING_MAGIC, 'utf8').copy(aad, 0);
  baseNonce.copy(aad, 6);
  aad.writeUInt32BE(chunkSize, 18);
  aad.writeBigUInt64BE(BigInt(plaintextSize), 22);
  aad.writeBigUInt64BE(BigInt(index), 30);
  return aad;
}

export function parseRecordingHeader(encrypted: Buffer): RecordingHeader {
  if (encrypted.length < RECORDING_HEADER_BYTES) {
    throw new VaultFormatError('Recording container too short');
  }
  if (encrypted.subarray(0, 6).toString('utf8') !== RECORDING_MAGIC) {
    throw new VaultFormatError('Recording container has a bad magic');
  }
  const baseNonce = encrypted.subarray(6, 18);
  const chunkSize = encrypted.readUInt32BE(18);
  if (chunkSize === 0 || chunkSize > 16 * 1024 * 1024) {
    throw new VaultFormatError('Recording container has a bad chunk size');
  }
  const declaredSize = Number(encrypted.readBigUInt64BE(22));
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    throw new VaultFormatError('Recording container has a bad size');
  }
  const bodyBytes = encrypted.length - RECORDING_HEADER_BYTES;
  const fullChunkCt = chunkSize + RECORDING_TAG_BYTES;
  if (bodyBytes === 0) {
    throw new VaultFormatError('Recording container has no chunks');
  }
  // All chunks except the last are full-size; the last holds 1..chunkSize
  // plaintext bytes (+ tag). Walk from the total: chunkCount = ceil over
  // full chunks, then validate the remainder is a legal last chunk.
  const chunkCount = Math.max(1, Math.ceil(bodyBytes / fullChunkCt));
  const lastChunkCt = bodyBytes - (chunkCount - 1) * fullChunkCt;
  if (lastChunkCt <= RECORDING_TAG_BYTES || lastChunkCt > fullChunkCt) {
    throw new VaultFormatError('Recording container has a corrupt layout');
  }
  const plaintextSize =
    (chunkCount - 1) * chunkSize + (lastChunkCt - RECORDING_TAG_BYTES);
  // The sealed total length authenticates the chunk count: dropped
  // trailing chunks (or a tampered size, which breaks chunk auth via AAD)
  // fail here instead of decrypting a clipped recording.
  if (plaintextSize !== declaredSize) {
    throw new VaultFormatError('Recording container size mismatch');
  }
  return {
    baseNonce: Buffer.from(baseNonce),
    chunkSize,
    chunkCount,
    plaintextSize,
  };
}

/** Byte range of ciphertext chunk `index` within the container. */
function chunkCtRange(
  header: RecordingHeader,
  totalBytes: number,
  index: number
): { start: number; end: number } {
  const fullChunkCt = header.chunkSize + RECORDING_TAG_BYTES;
  const start = RECORDING_HEADER_BYTES + index * fullChunkCt;
  const end =
    index === header.chunkCount - 1 ? totalBytes : start + fullChunkCt;
  return { start, end };
}

function decryptChunk(
  key: Buffer,
  header: RecordingHeader,
  chunkCt: Buffer,
  index: number
): Buffer {
  const ciphertext = chunkCt.subarray(0, chunkCt.length - RECORDING_TAG_BYTES);
  const tag = chunkCt.subarray(chunkCt.length - RECORDING_TAG_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    chunkNonce(header.baseNonce, index)
  );
  decipher.setAAD(
    chunkAad(header.baseNonce, header.chunkSize, header.plaintextSize, index)
  );
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new VaultAuthError(
      `Recording authentication failed at chunk ${index}`
    );
  }
}

export function encryptRecording(
  plaintext: Buffer,
  key: Buffer,
  chunkSize: number = RECORDING_CHUNK_SIZE
): Buffer {
  assertRecordingsKey(key);
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > 16 * 1024 * 1024
  ) {
    throw new VaultFormatError('Invalid recording chunk size');
  }
  if (plaintext.length === 0) {
    throw new VaultFormatError('Cannot encrypt an empty recording');
  }
  const baseNonce = randomBytes(12);
  const header = Buffer.alloc(RECORDING_HEADER_BYTES);
  Buffer.from(RECORDING_MAGIC, 'utf8').copy(header, 0);
  baseNonce.copy(header, 6);
  header.writeUInt32BE(chunkSize, 18);
  header.writeBigUInt64BE(BigInt(plaintext.length), 22);
  const parts: Buffer[] = [header];
  const chunkCount = Math.ceil(plaintext.length / chunkSize);
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = plaintext.subarray(
      index * chunkSize,
      Math.min(plaintext.length, (index + 1) * chunkSize)
    );
    const cipher = createCipheriv(
      'aes-256-gcm',
      key,
      chunkNonce(baseNonce, index)
    );
    cipher.setAAD(chunkAad(baseNonce, chunkSize, plaintext.length, index));
    const ct = Buffer.concat([cipher.update(chunk), cipher.final()]);
    parts.push(ct, cipher.getAuthTag());
  }
  return Buffer.concat(parts);
}

export function decryptRecording(encrypted: Buffer, key: Buffer): Buffer {
  assertRecordingsKey(key);
  const header = parseRecordingHeader(encrypted);
  const chunks: Buffer[] = [];
  for (let index = 0; index < header.chunkCount; index += 1) {
    const { start, end } = chunkCtRange(header, encrypted.length, index);
    chunks.push(
      decryptChunk(key, header, encrypted.subarray(start, end), index)
    );
  }
  return Buffer.concat(chunks);
}

/**
 * Decrypts plaintext bytes `[start, end)` — the primitive behind HTTP
 * range playback of encrypted recordings. Only the covered chunks are
 * authenticated and decrypted.
 */
export function decryptRecordingRange(
  encrypted: Buffer,
  key: Buffer,
  start: number,
  end: number
): Buffer {
  assertRecordingsKey(key);
  const header = parseRecordingHeader(encrypted);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > header.plaintextSize
  ) {
    throw new VaultFormatError('Invalid recording range');
  }
  if (start === end) return Buffer.alloc(0);
  const firstChunk = Math.floor(start / header.chunkSize);
  const lastChunk = Math.floor((end - 1) / header.chunkSize);
  const parts: Buffer[] = [];
  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const { start: ctStart, end: ctEnd } = chunkCtRange(
      header,
      encrypted.length,
      index
    );
    const plain = decryptChunk(
      key,
      header,
      encrypted.subarray(ctStart, ctEnd),
      index
    );
    const chunkPlainStart = index * header.chunkSize;
    const sliceStart = Math.max(start - chunkPlainStart, 0);
    const sliceEnd = Math.min(end - chunkPlainStart, plain.length);
    parts.push(plain.subarray(sliceStart, sliceEnd));
  }
  return Buffer.concat(parts);
}

/** Plaintext size without decrypting (header + container arithmetic). */
export function getRecordingPlaintextSize(encrypted: Buffer): number {
  return parseRecordingHeader(encrypted).plaintextSize;
}

/** Reads only the header + file size to report the plaintext size. */
export async function getRecordingFilePlaintextSize(
  encPath: string
): Promise<number> {
  const handle = await fs.open(encPath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < RECORDING_HEADER_BYTES) {
      throw new VaultFormatError('Recording container too short');
    }
    const headerBytes = Buffer.alloc(RECORDING_HEADER_BYTES);
    await handle.read(headerBytes, 0, RECORDING_HEADER_BYTES, 0);
    const fake = Buffer.concat([
      headerBytes,
      Buffer.alloc(Math.max(0, stat.size - RECORDING_HEADER_BYTES)),
    ]);
    return parseRecordingHeader(fake).plaintextSize;
  } finally {
    await handle.close();
  }
}

/**
 * File-backed range decryption with positional reads: only the header and
 * the covered ciphertext chunks are read from disk.
 */
export async function decryptRecordingFileRange(
  encPath: string,
  key: Buffer,
  start: number,
  end: number
): Promise<Buffer> {
  assertRecordingsKey(key);
  const handle = await fs.open(encPath, 'r');
  try {
    const stat = await handle.stat();
    const headerBytes = Buffer.alloc(RECORDING_HEADER_BYTES);
    const { bytesRead } = await handle.read(
      headerBytes,
      0,
      RECORDING_HEADER_BYTES,
      0
    );
    if (bytesRead < RECORDING_HEADER_BYTES) {
      throw new VaultFormatError('Recording container too short');
    }
    // Reuse the layout math by synthesizing a same-length container view.
    const view = Buffer.concat([
      headerBytes,
      Buffer.alloc(Math.max(0, stat.size - RECORDING_HEADER_BYTES)),
    ]);
    const header = parseRecordingHeader(view);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > header.plaintextSize
    ) {
      throw new VaultFormatError('Invalid recording range');
    }
    if (start === end) return Buffer.alloc(0);
    const firstChunk = Math.floor(start / header.chunkSize);
    const lastChunk = Math.floor((end - 1) / header.chunkSize);
    const parts: Buffer[] = [];
    for (let index = firstChunk; index <= lastChunk; index += 1) {
      const { start: ctStart, end: ctEnd } = chunkCtRange(
        header,
        stat.size,
        index
      );
      const chunkCt = Buffer.alloc(ctEnd - ctStart);
      await handle.read(chunkCt, 0, chunkCt.length, ctStart);
      const plain = decryptChunk(key, header, chunkCt, index);
      const chunkPlainStart = index * header.chunkSize;
      parts.push(
        plain.subarray(
          Math.max(start - chunkPlainStart, 0),
          Math.min(end - chunkPlainStart, plain.length)
        )
      );
    }
    return Buffer.concat(parts);
  } finally {
    await handle.close();
  }
}

export interface StagedPlaintext {
  path: string;
  bytes: number;
  cleanup: () => Promise<void>;
}

/**
 * Decrypts an encrypted recording into a private, non-persistent staging
 * file (0600, under the OS temp dir) for consumers that need a plaintext
 * path — e.g. transcription. The caller must await `cleanup()`.
 */
export async function stagePlaintextTemp(
  encPath: string,
  key: Buffer,
  options: { tmpRoot?: string; prefix?: string } = {}
): Promise<StagedPlaintext> {
  assertRecordingsKey(key);
  const dir = await fs.mkdtemp(
    path.join(
      options.tmpRoot ?? os.tmpdir(),
      options.prefix ?? 'therascript-plain-'
    )
  );
  const stagedPath = path.join(dir, 'audio.bin');
  const plaintext = decryptRecording(await fs.readFile(encPath), key);
  await fs.writeFile(stagedPath, plaintext, { mode: 0o600 });
  await fs.chmod(stagedPath, 0o600);
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { path: stagedPath, bytes: plaintext.length, cleanup };
}
