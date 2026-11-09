// packages/vault/src/keys.ts
//
// Vault key lifecycle:
//
//   - Two random 256-bit data keys: `database` (vault.db encryption) and `recordings`
//     (AES-GCM chunked recording encryption).
//   - A wrapping key derived from the vault password with Argon2id (via
//     hash-wasm, no native toolchain required) and a random salt.
//   - The data keys are sealed with AES-256-GCM into a versioned,
//     authenticated envelope persisted as `keys.json` inside the active
//     generation directory. Password changes rewrap the same data keys.
//   - Derivation parameters are versioned and bounded so a hostile or
//     corrupt envelope cannot demand 1 TiB of RAM on unlock.
//
// Nothing in this module logs secrets. Passwords and keys never leave as
// strings except inside the authenticated envelope ciphertext.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { VaultAuthError, VaultFormatError } from './errors.js';

export const VAULT_KEYS_VERSION = 1;
export const VAULT_KEY_BYTES = 32;
export const VAULT_SALT_BYTES = 16;
export const VAULT_NONCE_BYTES = 12;
export const VAULT_KEYS_AAD_PREFIX = 'therascript-vault-keys-v1';

export interface VaultKdfParams {
  algorithm: 'argon2id';
  /** Envelope format version this parameter set belongs to. */
  version: typeof VAULT_KEYS_VERSION;
  parallelism: number;
  /** Argon2 time cost (iterations). */
  iterations: number;
  /** Argon2 memory cost in KiB. */
  memorySizeKb: number;
  hashLength: number;
}

export interface VaultKeys {
  database: Buffer;
  recordings: Buffer;
}

export interface VaultKeyEnvelope {
  version: typeof VAULT_KEYS_VERSION;
  kdf: VaultKdfParams;
  /** base64 random salt */
  salt: string;
  /** base64 AES-GCM nonce */
  nonce: string;
  /** base64 AES-GCM ciphertext (tag appended) */
  ciphertext: string;
}

/** Production KDF parameters: ~64 MiB / 3 passes, well under a second. */
export const DEFAULT_KDF_PARAMS: VaultKdfParams = {
  algorithm: 'argon2id',
  version: VAULT_KEYS_VERSION,
  parallelism: 1,
  iterations: 3,
  memorySizeKb: 65536,
  hashLength: 32,
};

/**
 * Test-only KDF parameters (8 MiB / 1 pass). Within the accepted bounds so
 * validation stays meaningful, but fast enough for unit tests. Never persist
 * envelopes created with these outside of tests.
 */
export const TEST_KDF_PARAMS: VaultKdfParams = {
  algorithm: 'argon2id',
  version: VAULT_KEYS_VERSION,
  parallelism: 1,
  iterations: 1,
  memorySizeKb: 8192,
  hashLength: 32,
};

/** Hard bounds accepted when reading an envelope back from disk. */
export const KDF_BOUNDS = {
  parallelism: { min: 1, max: 4 },
  iterations: { min: 1, max: 10 },
  memorySizeKb: { min: 8192, max: 1048576 },
} as const;

export function generateVaultKeys(): VaultKeys {
  return {
    database: randomBytes(VAULT_KEY_BYTES),
    recordings: randomBytes(VAULT_KEY_BYTES),
  };
}

export function clearBuffer(buffer: Buffer): void {
  buffer.fill(0);
}

export function clearVaultKeys(keys: VaultKeys): void {
  clearBuffer(keys.database);
  clearBuffer(keys.recordings);
}

function assertValidRawKey(key: Buffer, label: string): void {
  if (!Buffer.isBuffer(key) || key.length !== VAULT_KEY_BYTES) {
    throw new Error(`Invalid ${label} key`);
  }
}

export function assertKdfParamsWithinBounds(
  params: VaultKdfParams
): asserts params is VaultKdfParams {
  const fail = (detail: string): never => {
    throw new VaultFormatError(`Invalid KDF parameters: ${detail}`);
  };
  if (params.algorithm !== 'argon2id') fail('unsupported algorithm');
  if (params.version !== VAULT_KEYS_VERSION) fail('unsupported version');
  for (const field of ['parallelism', 'iterations', 'memorySizeKb'] as const) {
    const value = params[field];
    const { min, max } = KDF_BOUNDS[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(`${field} out of bounds`);
    }
  }
  if (params.hashLength !== VAULT_KEY_BYTES) fail('unsupported hash length');
}

export async function deriveWrappingKey(
  password: string | Buffer,
  salt: Buffer,
  params: VaultKdfParams = DEFAULT_KDF_PARAMS
): Promise<Buffer> {
  assertKdfParamsWithinBounds(params);
  if (!Buffer.isBuffer(salt) || salt.length !== VAULT_SALT_BYTES) {
    throw new VaultFormatError('Invalid KDF salt');
  }
  const derived = await argon2id({
    password:
      typeof password === 'string' ? password : new Uint8Array(password),
    salt: new Uint8Array(salt),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySizeKb,
    hashLength: params.hashLength,
    outputType: 'binary',
  });
  return Buffer.from(derived);
}

function canonicalKdfJson(params: VaultKdfParams): string {
  // Fixed field order so the AAD is stable regardless of key order on disk.
  return JSON.stringify({
    algorithm: params.algorithm,
    version: params.version,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySizeKb: params.memorySizeKb,
    hashLength: params.hashLength,
  });
}

function envelopeAad(salt: Buffer, params: VaultKdfParams): Buffer {
  return Buffer.concat([
    Buffer.from(VAULT_KEYS_AAD_PREFIX, 'utf8'),
    Buffer.from([0]),
    salt,
    Buffer.from([0]),
    Buffer.from(canonicalKdfJson(params), 'utf8'),
  ]);
}

function assertBase64Length(
  value: unknown,
  bytes: number,
  label: string
): Buffer {
  if (typeof value !== 'string') {
    throw new VaultFormatError(`Invalid vault envelope: ${label} missing`);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    throw new VaultFormatError(`Invalid vault envelope: ${label} not base64`);
  }
  if (decoded.length !== bytes) {
    throw new VaultFormatError(`Invalid vault envelope: ${label} length`);
  }
  return decoded;
}

/** Strict structural validation for a parsed `keys.json` payload. */
export function assertValidEnvelopeShape(
  value: unknown
): asserts value is VaultKeyEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new VaultFormatError('Invalid vault envelope: not an object');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope['version'] !== VAULT_KEYS_VERSION) {
    throw new VaultFormatError('Invalid vault envelope: unsupported version');
  }
  const kdf = envelope['kdf'];
  if (typeof kdf !== 'object' || kdf === null) {
    throw new VaultFormatError('Invalid vault envelope: kdf missing');
  }
  const params = kdf as Record<string, unknown>;
  if (
    params['algorithm'] !== 'argon2id' ||
    typeof params['parallelism'] !== 'number' ||
    typeof params['iterations'] !== 'number' ||
    typeof params['memorySizeKb'] !== 'number' ||
    typeof params['hashLength'] !== 'number' ||
    typeof params['version'] !== 'number'
  ) {
    throw new VaultFormatError('Invalid vault envelope: malformed kdf');
  }
  assertKdfParamsWithinBounds(params as unknown as VaultKdfParams);
  assertBase64Length(envelope['salt'], VAULT_SALT_BYTES, 'salt');
  assertBase64Length(envelope['nonce'], VAULT_NONCE_BYTES, 'nonce');
  if (
    typeof envelope['ciphertext'] !== 'string' ||
    envelope['ciphertext'].length === 0
  ) {
    throw new VaultFormatError('Invalid vault envelope: ciphertext missing');
  }
}

export async function wrapVaultKeys(
  keys: VaultKeys,
  password: string | Buffer,
  params: VaultKdfParams = DEFAULT_KDF_PARAMS
): Promise<VaultKeyEnvelope> {
  assertValidRawKey(keys.database, 'database');
  assertValidRawKey(keys.recordings, 'recordings');
  assertKdfParamsWithinBounds(params);
  if (
    (typeof password === 'string' ? password.length : password.length) === 0
  ) {
    throw new VaultFormatError('Vault password must not be empty');
  }
  const salt = randomBytes(VAULT_SALT_BYTES);
  const wrappingKey = await deriveWrappingKey(password, salt, params);
  try {
    const nonce = randomBytes(VAULT_NONCE_BYTES);
    const plaintext = Buffer.from(
      JSON.stringify({
        database: keys.database.toString('base64'),
        recordings: keys.recordings.toString('base64'),
      }),
      'utf8'
    );
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce);
    cipher.setAAD(envelopeAad(salt, params));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      version: VAULT_KEYS_VERSION,
      kdf: { ...params },
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
    };
  } finally {
    clearBuffer(wrappingKey);
  }
}

export async function unwrapVaultKeys(
  envelope: unknown,
  password: string | Buffer
): Promise<VaultKeys> {
  assertValidEnvelopeShape(envelope);
  const salt = Buffer.from(envelope.salt, 'base64');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const combined = Buffer.from(envelope.ciphertext, 'base64');
  if (combined.length < 16 + 1) {
    throw new VaultFormatError('Invalid vault envelope: ciphertext too short');
  }
  const ciphertext = combined.subarray(0, combined.length - 16);
  const tag = combined.subarray(combined.length - 16);
  const wrappingKey = await deriveWrappingKey(password, salt, envelope.kdf);
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, nonce);
    decipher.setAAD(envelopeAad(salt, envelope.kdf));
    decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
    } catch {
      throw new VaultAuthError('Incorrect vault password');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new VaultFormatError('Invalid vault envelope: payload corrupt');
    } finally {
      clearBuffer(plaintext);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new VaultFormatError('Invalid vault envelope: payload corrupt');
    }
    const payload = parsed as Record<string, unknown>;
    const database = assertBase64Length(
      payload['database'],
      VAULT_KEY_BYTES,
      'database key'
    );
    const recordings = assertBase64Length(
      payload['recordings'],
      VAULT_KEY_BYTES,
      'recordings key'
    );
    return { database, recordings };
  } finally {
    clearBuffer(wrappingKey);
  }
}

/**
 * True when `password` opens `envelope`; false on authentication failure.
 * Format errors still throw — a corrupt envelope is not a wrong password.
 */
export async function verifyVaultPassword(
  envelope: unknown,
  password: string | Buffer
): Promise<boolean> {
  try {
    const keys = await unwrapVaultKeys(envelope, password);
    clearVaultKeys(keys);
    return true;
  } catch (error) {
    if (error instanceof VaultAuthError) return false;
    throw error;
  }
}

/** Password change: same data keys, fresh salt/nonce, new password. */
export async function rewrapVaultKeys(
  envelope: unknown,
  oldPassword: string | Buffer,
  newPassword: string | Buffer
): Promise<VaultKeyEnvelope> {
  const keys = await unwrapVaultKeys(envelope, oldPassword);
  try {
    assertValidEnvelopeShape(envelope);
    return await wrapVaultKeys(keys, newPassword, envelope.kdf);
  } finally {
    clearVaultKeys(keys);
  }
}
