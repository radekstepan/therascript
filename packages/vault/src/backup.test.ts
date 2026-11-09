// @vitest-environment node
// packages/vault/src/backup.test.ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import {
  encryptBackupBuffer,
  decryptBackupBuffer,
  encryptBackupStream,
  decryptBackupStream,
  isEncryptedBackup,
  validateArchiveEntry,
  resolveArchiveEntryPath,
  BACKUP_MAGIC,
} from './backup.js';
import { TEST_KDF_PARAMS } from './keys.js';
import { VaultAuthError, VaultFormatError } from './errors.js';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const piece of stream) chunks.push(Buffer.from(piece));
  return Buffer.concat(chunks);
}

describe('encrypted backup round-trip', () => {
  it('round-trips buffers of many sizes', async () => {
    for (const size of [0, 1, 100, 65536, 65537, 200000]) {
      const plain = randomBytes(size);
      const enc = await encryptBackupBuffer(
        plain,
        'backup-pw',
        TEST_KDF_PARAMS
      );
      expect(isEncryptedBackup(enc)).toBe(true);
      expect(enc.subarray(0, 6).toString('utf8')).toBe(BACKUP_MAGIC);
      await expect(decryptBackupBuffer(enc, 'backup-pw')).resolves.toEqual(
        plain
      );
    }
  });

  it('round-trips through the streaming API', async () => {
    const plain = randomBytes(200000);
    const source = Readable.from([
      plain.subarray(0, 1000),
      plain.subarray(1000, 70000),
      plain.subarray(70000),
    ]);
    const enc = await collect(
      encryptBackupStream(source, 'pw', TEST_KDF_PARAMS)
    );
    // Decrypt from awkwardly-sized stream pieces.
    const drip = Readable.from([
      enc.subarray(0, 3),
      enc.subarray(3, 11),
      enc.subarray(11, 50000),
      enc.subarray(50000),
    ]);
    await expect(collect(decryptBackupStream(drip, 'pw'))).resolves.toEqual(
      plain
    );
  });

  it('buffer and stream formats agree', async () => {
    const plain = randomBytes(90000);
    const viaBuffer = await encryptBackupBuffer(plain, 'pw', TEST_KDF_PARAMS);
    await expect(
      collect(decryptBackupStream(Readable.from([viaBuffer]), 'pw'))
    ).resolves.toEqual(plain);
  });

  it('rejects a wrong backup password', async () => {
    const enc = await encryptBackupBuffer(
      randomBytes(500),
      'right',
      TEST_KDF_PARAMS
    );
    await expect(decryptBackupBuffer(enc, 'wrong')).rejects.toBeInstanceOf(
      VaultAuthError
    );
    await expect(
      collect(decryptBackupStream(Readable.from([enc]), 'wrong'))
    ).rejects.toBeInstanceOf(VaultAuthError);
  });

  it('fails closed on truncation (missing authenticated end of stream)', async () => {
    const enc = await encryptBackupBuffer(
      randomBytes(200000),
      'pw',
      TEST_KDF_PARAMS
    );
    for (const cut of [1, 10, 100, 70000, enc.length - 20]) {
      await expect(
        decryptBackupBuffer(enc.subarray(0, cut), 'pw')
      ).rejects.toBeInstanceOf(VaultFormatError);
    }
    // Stream truncation mid-chunk.
    await expect(
      collect(decryptBackupStream(Readable.from([enc.subarray(0, 500)]), 'pw'))
    ).rejects.toBeInstanceOf(VaultFormatError);
  });

  it('rejects tampered ciphertext and trailing garbage', async () => {
    const enc = await encryptBackupBuffer(
      randomBytes(5000),
      'pw',
      TEST_KDF_PARAMS
    );
    const tampered = Buffer.from(enc);
    tampered[300] ^= 0x01;
    await expect(decryptBackupBuffer(tampered, 'pw')).rejects.toBeInstanceOf(
      VaultAuthError
    );
    await expect(
      decryptBackupBuffer(Buffer.concat([enc, Buffer.from([1, 2, 3])]), 'pw')
    ).rejects.toBeInstanceOf(VaultFormatError);
  });

  it('rejects plaintext tar input as not-a-backup', async () => {
    await expect(
      decryptBackupBuffer(Buffer.from('sessions.json'), 'pw')
    ).rejects.toBeInstanceOf(VaultFormatError);
    expect(isEncryptedBackup(Buffer.from('sessions.json'))).toBe(false);
  });

  it('rejects empty backup passwords', async () => {
    await expect(
      encryptBackupBuffer(randomBytes(10), '', TEST_KDF_PARAMS)
    ).rejects.toBeInstanceOf(VaultFormatError);
  });
});

describe('validateArchiveEntry', () => {
  it('accepts the entries our exporter writes', () => {
    expect(() =>
      validateArchiveEntry('sessions.json', 100, 'file')
    ).not.toThrow();
    expect(() =>
      validateArchiveEntry('uploads/audio.mp3', 10, 'file')
    ).not.toThrow();
    expect(() => validateArchiveEntry('uploads', 0, 'directory')).not.toThrow();
    expect(() =>
      validateArchiveEntry('sessions.json', 100, undefined)
    ).not.toThrow();
  });

  it('rejects traversal, absolute paths, and hostile types', () => {
    expect(() => validateArchiveEntry('../evil', 10, 'file')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('a/../../evil', 10, 'file')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('/etc/passwd', 10, 'file')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('C:\\evil', 10, 'file')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('link', 0, 'symlink')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('dev', 0, 'character-device')).toThrow(
      VaultFormatError
    );
    expect(() => validateArchiveEntry('', 0, 'file')).toThrow(VaultFormatError);
    expect(() => validateArchiveEntry('ok.json', -1, 'file')).toThrow(
      VaultFormatError
    );
  });

  it('enforces the per-entry size ceiling', () => {
    expect(() =>
      validateArchiveEntry('big.bin', 11, 'file', { maxEntryBytes: 10 })
    ).toThrow(VaultFormatError);
    expect(() =>
      validateArchiveEntry('big.bin', 10, 'file', { maxEntryBytes: 10 })
    ).not.toThrow();
  });
});

describe('resolveArchiveEntryPath', () => {
  it('roots entries under the staging dir', () => {
    expect(resolveArchiveEntryPath('/tmp/stage', 'uploads/a.mp3')).toBe(
      '/tmp/stage/uploads/a.mp3'
    );
    expect(() => resolveArchiveEntryPath('/tmp/stage', '../escape')).toThrow(
      VaultFormatError
    );
  });
});
