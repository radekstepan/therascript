// @vitest-environment node
// packages/vault/src/workerPipe.test.ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  openSync,
  closeSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {
  encodeWorkerKeysPayload,
  decodeWorkerKeysPayload,
  readLineFromFd,
  WORKER_VAULT_FD_ENV,
  WORKER_READY_MARKER,
} from './workerPipe.js';
import { VaultFormatError } from './errors.js';

describe('worker keys payload', () => {
  it('round-trips over encode/decode', () => {
    const payload = {
      database: randomBytes(32),
      recordings: randomBytes(32),
      generationId: 'gen_abc',
      dbPath: '/vault/generations/gen_abc/vault.db',
    };
    const line = encodeWorkerKeysPayload(payload);
    expect(line).not.toContain('\n');
    // Key material travels base64-encoded: the raw bytes never appear.
    expect(line).not.toContain(payload.database.toString('latin1').slice(0, 8));
    const decoded = decodeWorkerKeysPayload(line);
    expect(decoded.database.equals(payload.database)).toBe(true);
    expect(decoded.recordings.equals(payload.recordings)).toBe(true);
    expect(decoded.generationId).toBe('gen_abc');
    expect(decoded.dbPath).toBe(payload.dbPath);
  });

  it('rejects malformed payloads', () => {
    expect(() => decodeWorkerKeysPayload('not json')).toThrow(VaultFormatError);
    expect(() => decodeWorkerKeysPayload('{"v":2}')).toThrow(VaultFormatError);
    expect(() =>
      decodeWorkerKeysPayload(
        JSON.stringify({
          v: 1,
          database: 'short',
          recordings: 'short',
          generationId: 'g',
          dbPath: 'd',
        })
      )
    ).toThrow(VaultFormatError);
    expect(() =>
      encodeWorkerKeysPayload({
        database: randomBytes(16),
        recordings: randomBytes(32),
        generationId: 'g',
        dbPath: 'd',
      })
    ).toThrow();
  });
});

describe('readLineFromFd', () => {
  function fdWithContents(contents: string): { fd: number; dir: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vault-pipe-test-'));
    const file = path.join(dir, 'keys');
    writeFileSync(file, contents);
    return { fd: openSync(file, 'r'), dir };
  }

  it('reads one newline-terminated line from an fd', () => {
    const { fd, dir } = fdWithContents('hello vault\ntrailing');
    try {
      expect(readLineFromFd(fd, { timeoutMs: 1000 })).toBe('hello vault');
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on EOF before newline', () => {
    const { fd, dir } = fdWithContents('no-newline');
    try {
      expect(() => readLineFromFd(fd, { timeoutMs: 1000 })).toThrow(
        VaultFormatError
      );
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hands keys to a supervised child over an inherited pipe', async () => {
    const payload = {
      database: randomBytes(32),
      recordings: randomBytes(32),
      generationId: 'gen_supervised',
      dbPath: '/vault/vault.db',
    };
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
        const fs = require('node:fs');
        const fd = Number(process.env['${WORKER_VAULT_FD_ENV}']);
        let line = '';
        const one = Buffer.alloc(1);
        for (;;) {
          const n = fs.readSync(fd, one, 0, 1, null);
          if (n === 0) { console.error('EOF'); process.exit(1); }
          if (one[0] === 10) break;
          line += one.toString();
        }
        const parsed = JSON.parse(line);
        if (parsed.v !== 1 || parsed.generationId !== 'gen_supervised') process.exit(2);
        if (Buffer.from(parsed.database, 'base64').length !== 32) process.exit(3);
        console.log('${WORKER_READY_MARKER}');
        `,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: { ...process.env, [WORKER_VAULT_FD_ENV]: '3' },
      }
    );
    const keysPipe = child.stdio[3] as Writable;
    keysPipe.write(`${encodeWorkerKeysPayload(payload)}\n`);
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    const exitCode = (await Promise.race([
      new Promise<number | null>((resolve) => child.once('exit', resolve)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ])) as number | null;
    keysPipe.destroy();
    if (exitCode === null) {
      child.kill('SIGKILL');
      throw new Error('supervised child timed out');
    }
    expect(exitCode).toBe(0);
    expect(stdout).toContain(WORKER_READY_MARKER);
  }, 20000);
});
