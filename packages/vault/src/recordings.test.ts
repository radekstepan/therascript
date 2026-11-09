// @vitest-environment node
// packages/vault/src/recordings.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  encryptRecording,
  decryptRecording,
  decryptRecordingRange,
  decryptRecordingFileRange,
  getRecordingPlaintextSize,
  getRecordingFilePlaintextSize,
  stagePlaintextTemp,
  parseRecordingHeader,
  RECORDING_CHUNK_SIZE,
} from './recordings.js';
import { VaultAuthError, VaultFormatError } from './errors.js';

const key = randomBytes(32);
const tmpFiles: string[] = [];

async function writeTmp(contents: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-rec-test-'));
  const file = path.join(dir, 'audio.enc');
  await fs.writeFile(file, contents);
  tmpFiles.push(dir);
  return file;
}

afterEach(async () => {
  while (tmpFiles.length > 0) {
    await fs.rm(tmpFiles.pop()!, { recursive: true, force: true });
  }
});

describe('recording round-trip', () => {
  it('round-trips single- and multi-chunk payloads', () => {
    for (const size of [
      1,
      100,
      RECORDING_CHUNK_SIZE,
      RECORDING_CHUNK_SIZE + 7,
      RECORDING_CHUNK_SIZE * 3 + 13,
    ]) {
      const plain = randomBytes(size);
      const enc = encryptRecording(plain, key);
      expect(getRecordingPlaintextSize(enc)).toBe(size);
      expect(decryptRecording(enc, key).equals(plain)).toBe(true);
    }
  });

  it('rejects a wrong key with VaultAuthError', () => {
    const enc = encryptRecording(randomBytes(1000), key);
    expect(() => decryptRecording(enc, randomBytes(32))).toThrow(
      VaultAuthError
    );
  });

  it('rejects tampered chunks', () => {
    const enc = encryptRecording(randomBytes(RECORDING_CHUNK_SIZE + 100), key);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 20] ^= 0x01;
    expect(() => decryptRecording(tampered, key)).toThrow(VaultAuthError);
  });

  it('rejects truncated containers', () => {
    const enc = encryptRecording(randomBytes(1000), key);
    expect(() =>
      decryptRecording(enc.subarray(0, enc.length - 5), key)
    ).toThrow(VaultFormatError);
    expect(() => decryptRecording(Buffer.alloc(10), key)).toThrow(
      VaultFormatError
    );
  });

  it('detects a dropped trailing chunk instead of clipping', () => {
    const enc = encryptRecording(
      randomBytes(RECORDING_CHUNK_SIZE + 500),
      key,
      1024
    );
    // Drop the whole last ciphertext chunk: layout math says one chunk is
    // missing relative to the sealed total length.
    const lastChunkCt = 500 + 16;
    const clipped = enc.subarray(0, enc.length - lastChunkCt);
    expect(() => decryptRecording(clipped, key)).toThrow(VaultFormatError);
  });

  it('rejects bad magic', () => {
    const enc = encryptRecording(randomBytes(100), key);
    enc.write('XXXXXX', 0);
    expect(() => parseRecordingHeader(enc)).toThrow(VaultFormatError);
  });

  it('supports small chunk sizes for tests', () => {
    const plain = randomBytes(1000);
    const enc = encryptRecording(plain, key, 64);
    expect(decryptRecording(enc, key).equals(plain)).toBe(true);
  });
});

describe('range decryption', () => {
  it('decrypts arbitrary ranges including cross-chunk spans', () => {
    const plain = randomBytes(RECORDING_CHUNK_SIZE * 2 + 500);
    const enc = encryptRecording(plain, key);
    const cases: Array<[number, number]> = [
      [0, 10],
      [0, RECORDING_CHUNK_SIZE],
      [100, 200],
      [RECORDING_CHUNK_SIZE - 50, RECORDING_CHUNK_SIZE + 50],
      [RECORDING_CHUNK_SIZE, plain.length],
      [0, plain.length],
      [plain.length - 1, plain.length],
    ];
    for (const [start, end] of cases) {
      expect(
        decryptRecordingRange(enc, key, start, end).equals(
          plain.subarray(start, end)
        )
      ).toBe(true);
    }
  });

  it('rejects out-of-bounds ranges', () => {
    const enc = encryptRecording(randomBytes(100), key);
    expect(() => decryptRecordingRange(enc, key, -1, 10)).toThrow(
      VaultFormatError
    );
    expect(() => decryptRecordingRange(enc, key, 0, 101)).toThrow(
      VaultFormatError
    );
    expect(() => decryptRecordingRange(enc, key, 50, 40)).toThrow(
      VaultFormatError
    );
  });
});

describe('file-backed access', () => {
  it('reports plaintext size from header + file size', async () => {
    const plain = randomBytes(5000);
    const file = await writeTmp(encryptRecording(plain, key));
    await expect(getRecordingFilePlaintextSize(file)).resolves.toBe(
      plain.length
    );
  });

  it('decrypts file ranges with positional reads', async () => {
    const plain = randomBytes(RECORDING_CHUNK_SIZE + 999);
    const file = await writeTmp(encryptRecording(plain, key));
    await expect(decryptRecordingFileRange(file, key, 0, 100)).resolves.toEqual(
      plain.subarray(0, 100)
    );
    await expect(
      decryptRecordingFileRange(
        file,
        key,
        RECORDING_CHUNK_SIZE - 10,
        RECORDING_CHUNK_SIZE + 10
      )
    ).resolves.toEqual(
      plain.subarray(RECORDING_CHUNK_SIZE - 10, RECORDING_CHUNK_SIZE + 10)
    );
    await expect(
      decryptRecordingFileRange(file, key, 0, plain.length + 1)
    ).rejects.toBeInstanceOf(VaultFormatError);
  });
});

describe('stagePlaintextTemp', () => {
  it('stages 0600 plaintext and cleans up', async () => {
    const plain = randomBytes(1234);
    const file = await writeTmp(encryptRecording(plain, key));
    const staged = await stagePlaintextTemp(file, key);
    expect((await fs.stat(staged.path)).mode & 0o777).toBe(0o600);
    expect(staged.bytes).toBe(plain.length);
    expect((await fs.readFile(staged.path)).equals(plain)).toBe(true);
    await staged.cleanup();
    await expect(fs.access(staged.path)).rejects.toThrow();
    await staged.cleanup(); // idempotent
  });
});
