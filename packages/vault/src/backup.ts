// packages/vault/src/backup.ts
//
// Versioned, authenticated backup encryption. A backup password
// (independent of the vault password) is stretched with Argon2id; the tar
// payload is then sealed in AES-256-GCM chunks:
//
//   magic "VBAK01" (6) || headerLen BE-u32 (4) || headerJSON
//     || u32len(ct[0]) || ct[0] || ... || u32len(ct[n-1]) || ct[n-1]
//     || u32len(ctFinal) || ctFinal
//
// headerJSON = { v: 1, kdf: {...}, salt: b64, nonceBase: b64, chunkSize }.
// Chunk `i` uses nonce `nonceBase XOR (0x00*8 || BE-u32(i))` and AAD
// `magic || nonceBase || BE-u64(i) || u8(isFinal)`; the final chunk seals
// zero plaintext bytes with isFinal=1, so a truncated archive (missing end
// of stream) always fails closed instead of importing a prefix.
import { Readable } from 'node:stream';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { VaultAuthError, VaultFormatError } from './errors.js';
import {
  deriveWrappingKey,
  assertKdfParamsWithinBounds,
  clearBuffer,
  DEFAULT_KDF_PARAMS,
  VAULT_NONCE_BYTES,
  VAULT_SALT_BYTES,
  type VaultKdfParams,
} from './keys.js';

export const BACKUP_MAGIC = 'VBAK01';
export const BACKUP_VERSION = 1;
export const BACKUP_CHUNK_SIZE = 64 * 1024;
export const BACKUP_TAG_BYTES = 16;
/** Default per-entry ceiling enforced while importing an archive. */
export const DEFAULT_MAX_BACKUP_ENTRY_BYTES = 1024 * 1024 * 1024; // 1 GiB

interface BackupHeader {
  v: number;
  kdf: VaultKdfParams;
  salt: string;
  nonceBase: string;
  chunkSize: number;
}

function backupChunkNonce(nonceBase: Buffer, index: number): Buffer {
  const nonce = Buffer.from(nonceBase);
  nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ index) >>> 0, 8);
  return nonce;
}

function backupChunkAad(
  nonceBase: Buffer,
  index: number,
  isFinal: boolean
): Buffer {
  const aad = Buffer.alloc(6 + 12 + 8 + 1);
  Buffer.from(BACKUP_MAGIC, 'utf8').copy(aad, 0);
  nonceBase.copy(aad, 6);
  aad.writeBigUInt64BE(BigInt(index), 18);
  aad.writeUInt8(isFinal ? 1 : 0, 26);
  return aad;
}

function sealChunk(
  key: Buffer,
  nonceBase: Buffer,
  index: number,
  plaintext: Buffer,
  isFinal: boolean
): Buffer {
  const cipher = createCipheriv(
    'aes-256-gcm',
    key,
    backupChunkNonce(nonceBase, index)
  );
  cipher.setAAD(backupChunkAad(nonceBase, index, isFinal));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const framed = Buffer.alloc(4 + ct.length + BACKUP_TAG_BYTES);
  framed.writeUInt32BE(ct.length + BACKUP_TAG_BYTES, 0);
  ct.copy(framed, 4);
  cipher.getAuthTag().copy(framed, 4 + ct.length);
  return framed;
}

function openChunk(
  key: Buffer,
  nonceBase: Buffer,
  index: number,
  framed: Buffer,
  isFinal: boolean
): Buffer {
  // The final chunk seals zero plaintext bytes: exactly one tag. Data
  // chunks always carry >= 1 plaintext byte; callers route by frame
  // length before calling here.
  if (framed.length < BACKUP_TAG_BYTES) {
    throw new VaultFormatError('Backup chunk too short');
  }
  const ct = framed.subarray(0, framed.length - BACKUP_TAG_BYTES);
  const tag = framed.subarray(framed.length - BACKUP_TAG_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    backupChunkNonce(nonceBase, index)
  );
  decipher.setAAD(backupChunkAad(nonceBase, index, isFinal));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new VaultAuthError(`Backup authentication failed at chunk ${index}`);
  }
}

function encodeHeader(header: BackupHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const out = Buffer.alloc(6 + 4 + json.length);
  Buffer.from(BACKUP_MAGIC, 'utf8').copy(out, 0);
  out.writeUInt32BE(json.length, 6);
  json.copy(out, 10);
  return out;
}

function parseHeaderBytes(raw: Buffer): {
  header: BackupHeader;
  headerBytes: number;
} {
  if (raw.length < 10) throw new VaultFormatError('Backup header truncated');
  if (raw.subarray(0, 6).toString('utf8') !== BACKUP_MAGIC) {
    throw new VaultFormatError('Not an encrypted Therascript backup');
  }
  const headerLen = raw.readUInt32BE(6);
  if (headerLen === 0 || headerLen > 64 * 1024) {
    throw new VaultFormatError('Backup header has a bad length');
  }
  if (raw.length < 10 + headerLen) {
    throw new VaultFormatError('Backup header truncated');
  }
  let header: BackupHeader;
  try {
    header = JSON.parse(raw.subarray(10, 10 + headerLen).toString('utf8'));
  } catch {
    throw new VaultFormatError('Backup header is corrupt');
  }
  if (header.v !== BACKUP_VERSION) {
    throw new VaultFormatError('Unsupported backup version');
  }
  assertKdfParamsWithinBounds(header.kdf);
  if (
    Buffer.from(header.salt ?? '', 'base64').length !== VAULT_SALT_BYTES ||
    Buffer.from(header.nonceBase ?? '', 'base64').length !== VAULT_NONCE_BYTES
  ) {
    throw new VaultFormatError('Backup header has bad salt/nonce');
  }
  if (
    !Number.isInteger(header.chunkSize) ||
    header.chunkSize <= 0 ||
    header.chunkSize > 16 * 1024 * 1024
  ) {
    throw new VaultFormatError('Backup header has a bad chunk size');
  }
  return { header, headerBytes: 10 + headerLen };
}

async function deriveBackupKey(
  password: string | Buffer,
  salt: Buffer,
  kdf: VaultKdfParams
): Promise<Buffer> {
  if (
    (typeof password === 'string' ? password.length : password.length) === 0
  ) {
    throw new VaultFormatError('Backup password must not be empty');
  }
  return deriveWrappingKey(password, salt, kdf);
}

/** Encrypts a whole payload (tests, small backups). Prefer the stream API. */
export async function encryptBackupBuffer(
  plaintext: Buffer,
  password: string | Buffer,
  kdf: VaultKdfParams = DEFAULT_KDF_PARAMS
): Promise<Buffer> {
  assertKdfParamsWithinBounds(kdf);
  const salt = randomBytes(VAULT_SALT_BYTES);
  const nonceBase = randomBytes(VAULT_NONCE_BYTES);
  const key = await deriveBackupKey(password, salt, kdf);
  try {
    const parts: Buffer[] = [
      encodeHeader({
        v: BACKUP_VERSION,
        kdf: { ...kdf },
        salt: salt.toString('base64'),
        nonceBase: nonceBase.toString('base64'),
        chunkSize: BACKUP_CHUNK_SIZE,
      }),
    ];
    let index = 0;
    for (
      let offset = 0;
      offset < plaintext.length;
      offset += BACKUP_CHUNK_SIZE
    ) {
      parts.push(
        sealChunk(
          key,
          nonceBase,
          index,
          plaintext.subarray(offset, offset + BACKUP_CHUNK_SIZE),
          false
        )
      );
      index += 1;
    }
    parts.push(sealChunk(key, nonceBase, index, Buffer.alloc(0), true));
    return Buffer.concat(parts);
  } finally {
    clearBuffer(key);
  }
}

/** Decrypts a whole payload, failing closed on truncation or tampering. */
export async function decryptBackupBuffer(
  encrypted: Buffer,
  password: string | Buffer
): Promise<Buffer> {
  const { header, headerBytes } = parseHeaderBytes(encrypted);
  const salt = Buffer.from(header.salt, 'base64');
  const nonceBase = Buffer.from(header.nonceBase, 'base64');
  const key = await deriveBackupKey(password, salt, header.kdf);
  try {
    const chunks: Buffer[] = [];
    let offset = headerBytes;
    let index = 0;
    let sawFinal = false;
    for (;;) {
      if (offset + 4 > encrypted.length) break;
      const frameLen = encrypted.readUInt32BE(offset);
      if (
        frameLen === 0 ||
        frameLen > header.chunkSize + BACKUP_TAG_BYTES + 1
      ) {
        throw new VaultFormatError('Backup chunk frame is corrupt');
      }
      if (offset + 4 + frameLen > encrypted.length) break; // truncated
      const framed = encrypted.subarray(offset + 4, offset + 4 + frameLen);
      offset += 4 + frameLen;
      // The final chunk is the only zero-plaintext chunk; try final first
      // when the remaining length matches an empty seal, else data chunk.
      if (frameLen === BACKUP_TAG_BYTES) {
        const tail = openChunk(key, nonceBase, index, framed, true);
        if (tail.length !== 0) {
          throw new VaultFormatError('Backup final chunk is corrupt');
        }
        sawFinal = true;
        index += 1;
        break;
      }
      chunks.push(openChunk(key, nonceBase, index, framed, false));
      index += 1;
    }
    if (!sawFinal) {
      throw new VaultFormatError(
        'Backup is truncated: missing authenticated end of stream'
      );
    }
    if (offset !== encrypted.length) {
      throw new VaultFormatError('Backup has trailing garbage');
    }
    return Buffer.concat(chunks);
  } finally {
    clearBuffer(key);
  }
}

type ByteSource = AsyncIterable<Buffer | Uint8Array>;

/** Incremental reader that yields decrypted plaintext chunks. */
async function* decryptBackupGenerator(
  source: ByteSource,
  password: string | Buffer
): AsyncGenerator<Buffer> {
  let buffered = Buffer.alloc(0);
  let header: BackupHeader | null = null;
  let nonceBase: Buffer | null = null;
  let key: Buffer | null = null;
  let index = 0;
  let sawFinal = false;
  let sourceEnded = false;

  const fill = async (
    iterator: AsyncIterator<Buffer | Uint8Array>,
    needed: number
  ): Promise<boolean> => {
    while (buffered.length < needed && !sourceEnded) {
      const next = await iterator.next();
      if (next.done) {
        sourceEnded = true;
        break;
      }
      buffered = Buffer.concat([buffered, Buffer.from(next.value)]);
    }
    return buffered.length >= needed;
  };

  try {
    const iterator = source[Symbol.asyncIterator]();
    if (!(await fill(iterator, 10))) {
      throw new VaultFormatError('Backup header truncated');
    }
    if (buffered.subarray(0, 6).toString('utf8') !== BACKUP_MAGIC) {
      throw new VaultFormatError('Not an encrypted Therascript backup');
    }
    const headerLen = buffered.readUInt32BE(6);
    if (headerLen === 0 || headerLen > 64 * 1024) {
      throw new VaultFormatError('Backup header has a bad length');
    }
    if (!(await fill(iterator, 10 + headerLen))) {
      throw new VaultFormatError('Backup header truncated');
    }
    const parsed = parseHeaderBytes(buffered.subarray(0, 10 + headerLen));
    header = parsed.header;
    buffered = buffered.subarray(parsed.headerBytes);
    nonceBase = Buffer.from(header.nonceBase, 'base64');
    key = await deriveBackupKey(
      password,
      Buffer.from(header.salt, 'base64'),
      header.kdf
    );

    for (;;) {
      if (!(await fill(iterator, 4))) break; // truncated: no final seen
      const frameLen = buffered.readUInt32BE(0);
      if (
        frameLen === 0 ||
        frameLen > header.chunkSize + BACKUP_TAG_BYTES + 1
      ) {
        throw new VaultFormatError('Backup chunk frame is corrupt');
      }
      if (!(await fill(iterator, 4 + frameLen))) break; // truncated mid-chunk
      const framed = buffered.subarray(4, 4 + frameLen);
      buffered = buffered.subarray(4 + frameLen);
      if (frameLen === BACKUP_TAG_BYTES) {
        const tail = openChunk(key, nonceBase, index, framed, true);
        if (tail.length !== 0) {
          throw new VaultFormatError('Backup final chunk is corrupt');
        }
        sawFinal = true;
        index += 1;
        break;
      }
      yield openChunk(key, nonceBase, index, framed, false);
      index += 1;
    }
    // Any bytes after the final chunk (or a missing final chunk) fail closed.
    if (!sawFinal) {
      throw new VaultFormatError(
        'Backup is truncated: missing authenticated end of stream'
      );
    }
    // Drain: trailing garbage after the final seal is corruption.
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      buffered = Buffer.concat([buffered, Buffer.from(next.value)]);
    }
    if (buffered.length !== 0) {
      throw new VaultFormatError('Backup has trailing garbage');
    }
  } finally {
    if (key) clearBuffer(key);
  }
}

async function* encryptBackupGenerator(
  source: ByteSource,
  password: string | Buffer,
  kdf: VaultKdfParams
): AsyncGenerator<Buffer> {
  assertKdfParamsWithinBounds(kdf);
  const salt = randomBytes(VAULT_SALT_BYTES);
  const nonceBase = randomBytes(VAULT_NONCE_BYTES);
  const key = await deriveBackupKey(password, salt, kdf);
  try {
    yield encodeHeader({
      v: BACKUP_VERSION,
      kdf: { ...kdf },
      salt: salt.toString('base64'),
      nonceBase: nonceBase.toString('base64'),
      chunkSize: BACKUP_CHUNK_SIZE,
    });
    let index = 0;
    let carry = Buffer.alloc(0);
    for await (const piece of source) {
      carry = Buffer.concat([carry, Buffer.from(piece)]);
      while (carry.length >= BACKUP_CHUNK_SIZE) {
        yield sealChunk(
          key,
          nonceBase,
          index,
          carry.subarray(0, BACKUP_CHUNK_SIZE),
          false
        );
        index += 1;
        carry = carry.subarray(BACKUP_CHUNK_SIZE);
      }
    }
    if (carry.length > 0) {
      yield sealChunk(key, nonceBase, index, carry, false);
      index += 1;
    }
    yield sealChunk(key, nonceBase, index, Buffer.alloc(0), true);
  } finally {
    clearBuffer(key);
  }
}

export function encryptBackupStream(
  source: ByteSource,
  password: string | Buffer,
  kdf: VaultKdfParams = DEFAULT_KDF_PARAMS
): Readable {
  return Readable.from(encryptBackupGenerator(source, password, kdf));
}

export function decryptBackupStream(
  source: ByteSource,
  password: string | Buffer
): Readable {
  return Readable.from(decryptBackupGenerator(source, password));
}

/** True when the leading bytes look like an encrypted backup. */
export function isEncryptedBackup(leadingBytes: Buffer): boolean {
  return (
    leadingBytes.length >= 6 &&
    leadingBytes.subarray(0, 6).toString('utf8') === BACKUP_MAGIC
  );
}

// --- Archive entry validation (import path) -------------------------------

export interface ArchiveEntryConstraints {
  maxEntryBytes?: number;
}

/**
 * Rejects hostile tar entries before anything is written: absolute paths,
 * parent traversal, drive letters, oversized entries, and non-file/dir
 * types (symlinks, hardlinks, devices, fifos). Names are expected in the
 * posix form our exporter writes (`uploads/<file>`, `<table>.json`).
 */
export function validateArchiveEntry(
  name: string,
  size: number,
  type: string | undefined,
  constraints: ArchiveEntryConstraints = {}
): void {
  const maxEntryBytes =
    constraints.maxEntryBytes ?? DEFAULT_MAX_BACKUP_ENTRY_BYTES;
  const fail = (detail: string): never => {
    throw new VaultFormatError(
      `Unsafe backup entry ${JSON.stringify(name)}: ${detail}`
    );
  };
  if (typeof name !== 'string' || name === '') fail('empty name');
  if (name.length > 1024) fail('name too long');
  if (
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[A-Za-z]:/.test(name) ||
    name.includes('\0')
  ) {
    fail('absolute or NUL-containing path');
  }
  const normalized = name.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) fail('empty path');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    fail('dot-segment traversal');
  }
  // Collapse `.`/`..`-free but still suspicious double separators is
  // unnecessary; the join below is always rooted at the staging dir and
  // re-checked with path.relative by the importer.
  if (!Number.isInteger(size) || size < 0) fail('bad size');
  if (size > maxEntryBytes) fail(`entry larger than ${maxEntryBytes} bytes`);
  if (type !== undefined && type !== 'file' && type !== 'directory') {
    fail(`unsupported entry type ${JSON.stringify(type)}`);
  }
}

/**
 * Resolves an already-validated entry name under `stagingDir` and refuses
 * anything that escapes it (defense in depth behind validateArchiveEntry).
 */
export function resolveArchiveEntryPath(
  stagingDir: string,
  name: string
): string {
  const target = path.resolve(stagingDir, name);
  const relative = path.relative(stagingDir, target);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new VaultFormatError(
      `Unsafe backup entry ${JSON.stringify(name)}: escapes staging dir`
    );
  }
  return target;
}
