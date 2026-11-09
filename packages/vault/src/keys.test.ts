// @vitest-environment node
// packages/vault/src/keys.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateVaultKeys,
  wrapVaultKeys,
  unwrapVaultKeys,
  verifyVaultPassword,
  rewrapVaultKeys,
  deriveWrappingKey,
  assertKdfParamsWithinBounds,
  clearVaultKeys,
  DEFAULT_KDF_PARAMS,
  TEST_KDF_PARAMS,
  VAULT_KEY_BYTES,
} from './keys.js';
import { VaultAuthError, VaultFormatError } from './errors.js';

describe('generateVaultKeys', () => {
  it('returns two independent 32-byte keys', () => {
    const keys = generateVaultKeys();
    expect(keys.database).toBeInstanceOf(Buffer);
    expect(keys.recordings).toBeInstanceOf(Buffer);
    expect(keys.database.length).toBe(VAULT_KEY_BYTES);
    expect(keys.recordings.length).toBe(VAULT_KEY_BYTES);
    expect(keys.database.equals(keys.recordings)).toBe(false);
    const again = generateVaultKeys();
    expect(again.database.equals(keys.database)).toBe(false);
  });
});

describe('wrap/unwrap round-trip', () => {
  it('unwraps with the correct password', async () => {
    const keys = generateVaultKeys();
    const envelope = await wrapVaultKeys(
      keys,
      'correct horse',
      TEST_KDF_PARAMS
    );
    expect(envelope.version).toBe(1);
    const opened = await unwrapVaultKeys(envelope, 'correct horse');
    expect(opened.database.equals(keys.database)).toBe(true);
    expect(opened.recordings.equals(keys.recordings)).toBe(true);
  });

  it('rejects a wrong password with VaultAuthError', async () => {
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'right',
      TEST_KDF_PARAMS
    );
    await expect(unwrapVaultKeys(envelope, 'wrong')).rejects.toBeInstanceOf(
      VaultAuthError
    );
  });

  it('rejects tampered ciphertext with VaultAuthError', async () => {
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'pw',
      TEST_KDF_PARAMS
    );
    const raw = Buffer.from(envelope.ciphertext, 'base64');
    raw[10] ^= 0xff;
    await expect(
      unwrapVaultKeys({ ...envelope, ciphertext: raw.toString('base64') }, 'pw')
    ).rejects.toBeInstanceOf(VaultAuthError);
  });

  it('rejects tampered KDF params or salt (bound via AAD)', async () => {
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'pw',
      TEST_KDF_PARAMS
    );
    await expect(
      unwrapVaultKeys(
        { ...envelope, kdf: { ...envelope.kdf, iterations: 2 } },
        'pw'
      )
    ).rejects.toBeInstanceOf(VaultAuthError);
  });

  it('rejects malformed envelopes with VaultFormatError', async () => {
    await expect(unwrapVaultKeys(null, 'pw')).rejects.toBeInstanceOf(
      VaultFormatError
    );
    await expect(unwrapVaultKeys({ version: 99 }, 'pw')).rejects.toBeInstanceOf(
      VaultFormatError
    );
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'pw',
      TEST_KDF_PARAMS
    );
    await expect(
      unwrapVaultKeys({ ...envelope, salt: 'not-base64!!!' }, 'pw')
    ).rejects.toBeInstanceOf(VaultFormatError);
  });

  it('uses a fresh salt and nonce per wrap', async () => {
    const keys = generateVaultKeys();
    const a = await wrapVaultKeys(keys, 'pw', TEST_KDF_PARAMS);
    const b = await wrapVaultKeys(keys, 'pw', TEST_KDF_PARAMS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects empty passwords', async () => {
    await expect(
      wrapVaultKeys(generateVaultKeys(), '', TEST_KDF_PARAMS)
    ).rejects.toBeInstanceOf(VaultFormatError);
  });
});

describe('verifyVaultPassword', () => {
  it('returns true/false without throwing on wrong passwords', async () => {
    const envelope = await wrapVaultKeys(
      generateVaultKeys(),
      'pw',
      TEST_KDF_PARAMS
    );
    await expect(verifyVaultPassword(envelope, 'pw')).resolves.toBe(true);
    await expect(verifyVaultPassword(envelope, 'nope')).resolves.toBe(false);
    await expect(verifyVaultPassword(null, 'pw')).rejects.toBeInstanceOf(
      VaultFormatError
    );
  });
});

describe('rewrapVaultKeys', () => {
  it('keeps data keys stable across a password change', async () => {
    const keys = generateVaultKeys();
    const first = await wrapVaultKeys(keys, 'old', TEST_KDF_PARAMS);
    const second = await rewrapVaultKeys(first, 'old', 'new');
    const opened = await unwrapVaultKeys(second, 'new');
    expect(opened.database.equals(keys.database)).toBe(true);
    expect(opened.recordings.equals(keys.recordings)).toBe(true);
    await expect(unwrapVaultKeys(second, 'old')).rejects.toBeInstanceOf(
      VaultAuthError
    );
  });

  it('refuses to rewrap with a wrong old password', async () => {
    const first = await wrapVaultKeys(
      generateVaultKeys(),
      'old',
      TEST_KDF_PARAMS
    );
    await expect(rewrapVaultKeys(first, 'nope', 'new')).rejects.toBeInstanceOf(
      VaultAuthError
    );
  });
});

describe('KDF bounds', () => {
  it('accepts the default and test parameters', () => {
    expect(() => assertKdfParamsWithinBounds(DEFAULT_KDF_PARAMS)).not.toThrow();
    expect(() => assertKdfParamsWithinBounds(TEST_KDF_PARAMS)).not.toThrow();
  });

  it('rejects hostile parameters before any hashing work', () => {
    expect(() =>
      assertKdfParamsWithinBounds({
        ...TEST_KDF_PARAMS,
        memorySizeKb: 1024 * 1024 * 1024,
      })
    ).toThrow(VaultFormatError);
    expect(() =>
      assertKdfParamsWithinBounds({ ...TEST_KDF_PARAMS, iterations: 0 })
    ).toThrow(VaultFormatError);
    expect(() =>
      assertKdfParamsWithinBounds({ ...TEST_KDF_PARAMS, parallelism: 99 })
    ).toThrow(VaultFormatError);
  });

  it('derives deterministically for the same password and salt', async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await deriveWrappingKey('pw', salt, TEST_KDF_PARAMS);
    const b = await deriveWrappingKey('pw', salt, TEST_KDF_PARAMS);
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
  });
});

describe('clearVaultKeys', () => {
  it('zeroes key material', () => {
    const keys = generateVaultKeys();
    clearVaultKeys(keys);
    expect(keys.database.equals(Buffer.alloc(32))).toBe(true);
    expect(keys.recordings.equals(Buffer.alloc(32))).toBe(true);
  });
});
