// packages/vault/src/workerPipe.ts
//
// Parent→worker key handoff. The API supervises the worker
// process and passes the unwrapped data keys over an inherited private
// pipe (never the command line, environment, Redis, or logs):
//
//   parent: spawn(worker, { stdio: [..., 'pipe'] })  // child fd 3
//   parent: pipe.write(encodeWorkerKeysPayload(...) + '\n')
//   worker: payload = decodeWorkerKeysPayload(await readLineFromFd(3))
//   worker: ... open vault, migrate, start consumers ...
//   worker: stdout.write('THERASCRIPT_WORKER_READY\n')
//
// The parent waits for the ready marker with a timeout; on timeout or
// early exit it kills the child and the unlock fails closed.
import { readSync } from 'node:fs';
import { VaultFormatError } from './errors.js';
import { VAULT_KEY_BYTES } from './keys.js';

export const WORKER_VAULT_FD_ENV = 'THERASCRIPT_VAULT_FD';
export const WORKER_READY_MARKER = 'THERASCRIPT_WORKER_READY';
export const WORKER_KEYS_MAX_LINE_BYTES = 4096;

export interface WorkerKeysPayload {
  database: Buffer;
  recordings: Buffer;
  generationId: string;
  dbPath: string;
}

function assertB64Key(value: unknown, label: string): Buffer {
  if (typeof value !== 'string') {
    throw new VaultFormatError(`Worker keys payload has a bad ${label}`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== VAULT_KEY_BYTES) {
    throw new VaultFormatError(`Worker keys payload has a bad ${label}`);
  }
  return decoded;
}

export function encodeWorkerKeysPayload(payload: WorkerKeysPayload): string {
  if (
    !Buffer.isBuffer(payload.database) ||
    payload.database.length !== VAULT_KEY_BYTES ||
    !Buffer.isBuffer(payload.recordings) ||
    payload.recordings.length !== VAULT_KEY_BYTES
  ) {
    throw new Error('Invalid worker keys payload');
  }
  if (
    typeof payload.generationId !== 'string' ||
    payload.generationId === '' ||
    typeof payload.dbPath !== 'string' ||
    payload.dbPath === ''
  ) {
    throw new Error('Invalid worker keys payload');
  }
  return JSON.stringify({
    v: 1,
    database: payload.database.toString('base64'),
    recordings: payload.recordings.toString('base64'),
    generationId: payload.generationId,
    dbPath: payload.dbPath,
  });
}

export function decodeWorkerKeysPayload(line: string): WorkerKeysPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new VaultFormatError('Worker keys payload is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new VaultFormatError('Worker keys payload is malformed');
  }
  const record = parsed as Record<string, unknown>;
  if (record['v'] !== 1) {
    throw new VaultFormatError('Worker keys payload has a bad version');
  }
  const database = assertB64Key(record['database'], 'database key');
  const recordings = assertB64Key(record['recordings'], 'recordings key');
  if (
    typeof record['generationId'] !== 'string' ||
    record['generationId'] === '' ||
    typeof record['dbPath'] !== 'string' ||
    record['dbPath'] === ''
  ) {
    throw new VaultFormatError('Worker keys payload is malformed');
  }
  return {
    database,
    recordings,
    generationId: record['generationId'],
    dbPath: record['dbPath'],
  };
}

export interface ReadLineOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Synchronously reads one `\n`-terminated line from `fd` (the worker side:
 * fd 3 is a blocking pipe whose writer is the parent). Throws on timeout,
 * EOF before newline, or oversized lines.
 */
export function readLineFromFd(
  fd: number,
  options: ReadLineOptions = {}
): string {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? WORKER_KEYS_MAX_LINE_BYTES;
  const deadline = Date.now() + timeoutMs;
  const chunks: Buffer[] = [];
  let total = 0;
  const one = Buffer.alloc(1);
  for (;;) {
    if (Date.now() > deadline) {
      throw new VaultFormatError('Timed out waiting for worker keys');
    }
    let bytesRead: number;
    try {
      bytesRead = readSync(fd, one, 0, 1, null);
    } catch (error) {
      throw new VaultFormatError(
        `Failed to read worker keys: ${(error as Error).message}`
      );
    }
    if (bytesRead === 0) {
      throw new VaultFormatError('Worker keys pipe closed before newline');
    }
    if (one[0] === 0x0a) break;
    chunks.push(Buffer.from(one));
    total += 1;
    if (total > maxBytes) {
      throw new VaultFormatError('Worker keys line too long');
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** True when the worker was launched under vault supervision. */
export function supervisedVaultFd(): number | null {
  const raw = process.env[WORKER_VAULT_FD_ENV];
  if (raw === undefined || raw === '') return null;
  const fd = Number.parseInt(raw, 10);
  if (!Number.isInteger(fd) || fd < 0) return null;
  return fd;
}
