// @vitest-environment node
// packages/vault/src/cliPassword.test.ts
import { describe, it, expect } from 'vitest';
import {
  openSync,
  closeSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readPasswordFromEnvOrFd,
  promptForPassword,
  VAULT_PASSWORD_ENV,
  VAULT_PASSWORD_FD_ENV,
} from './cliPassword.js';
import { VaultStateError } from './errors.js';

describe('readPasswordFromEnvOrFd', () => {
  it('prefers the direct env var', () => {
    expect(readPasswordFromEnvOrFd({ [VAULT_PASSWORD_ENV]: 's3cret' })).toBe(
      's3cret'
    );
  });

  it('reads from a supplied file descriptor', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vault-pwfd-test-'));
    const file = path.join(dir, 'pw');
    writeFileSync(file, 'fd-password\n');
    const fd = openSync(file, 'r');
    try {
      expect(
        readPasswordFromEnvOrFd({ [VAULT_PASSWORD_FD_ENV]: String(fd) })
      ).toBe('fd-password');
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when neither is configured', () => {
    expect(readPasswordFromEnvOrFd({})).toBeNull();
    expect(readPasswordFromEnvOrFd({ [VAULT_PASSWORD_ENV]: '' })).toBeNull();
  });

  it('rejects an invalid fd', () => {
    expect(() =>
      readPasswordFromEnvOrFd({ [VAULT_PASSWORD_FD_ENV]: 'nope' })
    ).toThrow(VaultStateError);
  });
});

describe('promptForPassword', () => {
  it('rejects when stdin is not a TTY', async () => {
    const fakeInput = { isTTY: false } as unknown as NodeJS.ReadableStream;
    await expect(
      promptForPassword('pw: ', { input: fakeInput })
    ).rejects.toBeInstanceOf(VaultStateError);
  });
});
