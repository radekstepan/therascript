// packages/api/src/services/vaultManager.ts
//
// Vault lifecycle owner for the API process:
//
//   - enable(): recover layout, resume cleanup, decide vault vs
//     legacy-fallback boot (fail closed when a vault exists but the
//     cipher-capable binding is missing).
//   - setup()/unlock()/lock()/changePassword(): exclusive transitions.
//   - Supervised worker: keys travel over an inherited private pipe.
//   - In-flight request drain + SSE/LLM stream abort registry for lock.
//   - Staged import support: restoreStagedAsActive().
//
// HTTP concerns (cookies, origin, rate limits, status codes) live in
// `vaultHandler.ts` / `vaultRoutes.ts`; this module is HTTP-agnostic.
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';
import config from '@therascript/config';
import { isSafeAudioBasename } from './vaultMigrationPrep.js';
import {
  openVaultDb as realOpenVaultDb,
  createVaultDb as realCreateVaultDb,
  openLegacyDatabase as realOpenLegacyDatabase,
  attachUnlockedDb as realAttachUnlockedDb,
  closeDb as realCloseDb,
  isDbUnlocked as realIsDbUnlocked,
  initializeDatabase as realInitializeDatabase,
  copyPlaintextDbAndRekey as realCopyPlaintextDbAndRekey,
  detectCipherSupport,
  type SQLiteDatabase,
} from '@therascript/db';
import {
  VaultLockedError,
  VaultAuthError,
  VaultFormatError,
  VaultStateError,
  generateVaultKeys,
  wrapVaultKeys,
  unwrapVaultKeys,
  verifyVaultPassword,
  rewrapVaultKeys,
  clearVaultKeys,
  DEFAULT_KDF_PARAMS,
  type VaultKeys,
  type VaultKdfParams,
  createStagedGeneration,
  getActiveGeneration,
  replaceCurrentGeneration,
  discardStagedGeneration,
  sealGeneration,
  verifyStagedGeneration,
  writeKeysEnvelope,
  readKeysEnvelope,
  recoverVaultLayout,
  resumeInterruptedCleanup,
  writeCleanupManifest,
  encryptRecording,
  withExclusiveVaultTransition,
  VaultSessionStore,
  UnlockRateLimiter,
  type RateLimitDecision,
  encodeWorkerKeysPayload,
  WORKER_VAULT_FD_ENV,
  WORKER_READY_MARKER,
} from '@therascript/vault';

export type VaultLifecycleStatus =
  | 'locked'
  | 'unlocking'
  | 'unlocked'
  | 'locking';
export type VaultBootMode = 'vault' | 'legacy-fallback';

export interface VaultPublicStatus {
  status: VaultLifecycleStatus;
  hasVault: boolean;
  authenticated: boolean;
  legacyFallback: boolean;
}

/** Database operations, injectable so tests run without the cipher binding. */
export interface VaultDbOps {
  openVaultDb(
    filename: string,
    key: Buffer,
    options?: { fileMustExist?: boolean }
  ): SQLiteDatabase;
  createVaultDb(filename: string, key: Buffer): SQLiteDatabase;
  openLegacyDatabase(filename: string): SQLiteDatabase;
  attachUnlockedDb(connection: SQLiteDatabase): void;
  closeDb(): void;
  isDbUnlocked(): boolean;
  initializeDatabase(connection: SQLiteDatabase): void;
}

export const defaultVaultDbOps: VaultDbOps = {
  openVaultDb: (filename, key, options) =>
    realOpenVaultDb(filename, key, options),
  createVaultDb: (filename, key) => realCreateVaultDb(filename, key),
  openLegacyDatabase: (filename) => realOpenLegacyDatabase(filename),
  attachUnlockedDb: (connection) => realAttachUnlockedDb(connection),
  closeDb: () => realCloseDb(),
  isDbUnlocked: () => realIsDbUnlocked(),
  initializeDatabase: (connection) => realInitializeDatabase(connection),
};

export interface WorkerHandle {
  pid: number | undefined;
  kill(): Promise<void>;
  waitForExit(): Promise<void>;
}

export interface StagedGenerationRef {
  id: string;
  dir: string;
  dbPath: string;
  keysPath: string;
  sealedPath: string;
  recordingsDir: string;
}

export interface WorkerLauncher {
  startWorker(
    keys: VaultKeys,
    generation: StagedGenerationRef
  ): Promise<WorkerHandle>;
}

function defaultWorkerEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/api/dist/services/ -> packages/worker/dist/index.js
  return path.resolve(here, '../../../worker/dist/index.js');
}

/** Supervises the real worker process over an inherited private pipe. */
export class NodeWorkerLauncher implements WorkerLauncher {
  private readonly workerEntry: string;
  private readonly readyTimeoutMs: number;

  constructor(options: { workerEntry?: string; readyTimeoutMs?: number } = {}) {
    this.workerEntry =
      options.workerEntry ??
      process.env['THERASCRIPT_WORKER_ENTRY'] ??
      defaultWorkerEntry();
    this.readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
  }

  async startWorker(
    keys: VaultKeys,
    generation: StagedGenerationRef
  ): Promise<WorkerHandle> {
    const child: ChildProcess = spawn(process.execPath, [this.workerEntry], {
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, [WORKER_VAULT_FD_ENV]: '3' },
    });
    const stderrTail: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrTail.push(chunk.toString('utf8'));
      while (stderrTail.join('').length > 8000) stderrTail.shift();
    });
    // Forward worker stdout (minus the ready marker) for observability.
    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line !== WORKER_READY_MARKER && line !== '') {
          console.log(`[worker] ${line}`);
        }
      }
    });

    const keysPipe = child.stdio[3] as Writable | undefined;
    if (!keysPipe) {
      child.kill('SIGKILL');
      throw new Error('Worker pipe allocation failed');
    }

    const waitForExit = (): Promise<void> =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.once('error', () => resolve());
      });

    const kill = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const exited = await Promise.race([
        waitForExit().then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 10_000)
        ),
      ]);
      if (!exited) child.kill('SIGKILL');
      await waitForExit();
    };

    try {
      keysPipe.write(
        `${encodeWorkerKeysPayload({
          database: keys.database,
          recordings: keys.recordings,
          generationId: generation.id,
          dbPath: generation.dbPath,
        })}\n`
      );
      await this.waitForReady(child, waitForExit);
      keysPipe.destroy();
      return { pid: child.pid, kill, waitForExit };
    } catch (error) {
      keysPipe.destroy();
      await kill().catch(() => {});
      const tail = stderrTail.join('').trim().slice(-2000);
      throw new Error(
        `Worker failed to start: ${(error as Error).message}` +
          (tail ? ` (worker stderr: ${tail})` : '')
      );
    }
  }

  private waitForReady(
    child: ChildProcess,
    waitForExit: () => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for ${WORKER_READY_MARKER}`));
      }, this.readyTimeoutMs);
      const onData = (chunk: Buffer): void => {
        // The forwarder above strips the marker from logs; detect it here
        // on the raw chunk stream.
        if (
          chunk
            .toString('utf8')
            .split('\n')
            .some((l) => l.trim() === WORKER_READY_MARKER)
        ) {
          cleanup();
          resolve();
        }
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error('worker exited before signaling ready'));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
      };
      child.stdout?.on('data', onData);
      child.once('exit', onExit);
    });
  }
}

export interface LegacyInstall {
  dbPath: string;
  uploadsDir: string;
}

export interface VaultManagerOptions {
  vaultRoot: string;
  legacyDbPath: string;
  legacyUploadsDir: string;
  workerLauncher?: WorkerLauncher;
  dbOps?: VaultDbOps;
  kdfParams?: VaultKdfParams;
  cipherProbe?: () => boolean;
  drainTimeoutMs?: number;
  unlockRateLimit?: { maxAttempts?: number; windowMs?: number };
  /**
   * Copies a legacy plaintext database to the staged path and encrypts
   * it with the vault data key. Defaults to the byte-copy + in-place
   * rekey in `@therascript/db`; tests inject a stub.
   */
  exportDatabaseForMigration?: (
    stagedDbPath: string,
    legacyDbPath: string,
    key: Buffer
  ) => Promise<void> | void;
}

const MIGRATION_COUNT_TABLES = [
  'sessions',
  'transcript_paragraphs',
  'chats',
  'messages',
  'templates',
  'usage_logs',
  'analysis_jobs',
  'verification_jobs',
  'message_verifications',
  'verified_statements',
  'verification_statement_reviews',
] as const;

/** First 8 entries, then "and N more" — keeps preflight errors readable. */
function formatFileList(files: string[]): string {
  const shown = files.slice(0, 8);
  const rest = files.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
}

export class VaultManager {
  private readonly options: Required<
    Pick<VaultManagerOptions, 'vaultRoot' | 'legacyDbPath' | 'legacyUploadsDir'>
  > &
    Omit<
      VaultManagerOptions,
      'vaultRoot' | 'legacyDbPath' | 'legacyUploadsDir'
    >;
  private readonly dbOps: VaultDbOps;
  private readonly workerLauncher: WorkerLauncher;
  private readonly sessions = new VaultSessionStore();
  private readonly rateLimiter: UnlockRateLimiter;
  private readonly streams = new Set<AbortController>();

  private bootMode: VaultBootMode | null = null;
  private status: VaultLifecycleStatus = 'locked';
  private hasVaultFlag = false;
  private keys: VaultKeys | null = null;
  private activeGeneration: StagedGenerationRef | null = null;
  private workerHandle: WorkerHandle | null = null;
  private inFlightRequests = 0;

  constructor(options: VaultManagerOptions) {
    this.options = options;
    this.dbOps = options.dbOps ?? defaultVaultDbOps;
    this.workerLauncher = options.workerLauncher ?? new NodeWorkerLauncher();
    this.rateLimiter = new UnlockRateLimiter(options.unlockRateLimit ?? {});
  }

  // --- Boot ---------------------------------------------------------------

  getBootMode(): VaultBootMode | null {
    return this.bootMode;
  }

  /** True once enable() has selected vault mode (guard + FTS + ES-skip). */
  isProtectionActive(): boolean {
    return this.bootMode === 'vault';
  }

  isUnlocked(): boolean {
    return this.status === 'unlocked';
  }

  getStatus(): VaultLifecycleStatus {
    return this.status;
  }

  async enable(): Promise<VaultBootMode> {
    if (this.bootMode) return this.bootMode;
    const recovery = await recoverVaultLayout(this.options.vaultRoot);
    this.hasVaultFlag = recovery.activeId !== null;
    this.activeGeneration = recovery.activeId
      ? await getActiveGeneration(this.options.vaultRoot)
      : null;
    try {
      const cleanup = await resumeInterruptedCleanup(this.options.vaultRoot);
      if (
        cleanup &&
        (cleanup.removed.length > 0 || cleanup.failed.length > 0)
      ) {
        console.log(
          `[vault] Resumed interrupted cleanup: removed=${cleanup.removed.length} failed=${cleanup.failed.length}`
        );
      }
    } catch (error) {
      console.warn('[vault] Interrupted cleanup failed:', error);
    }

    const probe = this.options.cipherProbe ?? detectCipherSupport;
    if (!probe()) {
      if (this.hasVaultFlag) {
        // Fail closed: a vault exists but cannot be opened safely.
        throw new Error(
          'Vault exists but cipher support is missing. Refusing legacy boot.'
        );
      }
      this.bootMode = 'legacy-fallback';
      this.status = 'unlocked';
      console.warn(
        '[vault] Cipher support missing: legacy-plaintext fallback boot. ' +
          'Install better-sqlite3-multiple-ciphers to enable the vault.'
      );
      return this.bootMode;
    }
    this.bootMode = 'vault';
    this.status = 'locked';
    console.log(
      `[vault] Enabled in vault mode (hasVault=${this.hasVaultFlag}). HTTP is up but locked.`
    );
    return this.bootMode;
  }

  private requireVaultMode(): void {
    if (this.bootMode !== 'vault') {
      throw new VaultStateError('Vault is unavailable (legacy fallback boot)');
    }
  }

  // --- Status / sessions ----------------------------------------------------

  getPublicStatus(sessionToken: string | null | undefined): VaultPublicStatus {
    if (this.bootMode === 'legacy-fallback') {
      return {
        status: 'unlocked',
        hasVault: false,
        authenticated: true,
        legacyFallback: true,
      };
    }
    // Persisted tokens are only meaningful while the vault is open.
    const authenticated =
      this.status === 'unlocked' && this.sessions.isValid(sessionToken);
    return {
      // Never leak the open database to a stranger's browser: without a
      // valid session the UI always lands on the vault screen.
      status:
        authenticated || this.status !== 'unlocked' ? this.status : 'locked',
      hasVault: this.hasVaultFlag,
      authenticated,
      legacyFallback: false,
    };
  }

  isSessionValid(token: string | null | undefined): boolean {
    if (this.bootMode === 'legacy-fallback') return true;
    // A token restored from disk must never pass the guard while locked.
    if (this.status !== 'unlocked') return false;
    return this.sessions.isValid(token);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  checkUnlockAttempt(clientIp: string): RateLimitDecision {
    return this.rateLimiter.check(`unlock:${clientIp}`);
  }

  resetUnlockAttempts(clientIp: string): void {
    this.rateLimiter.reset(`unlock:${clientIp}`);
  }

  // --- Request drain + stream registry ---------------------------------------

  trackRequest(): () => void {
    this.inFlightRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    };
  }

  getInFlightRequests(): number {
    return this.inFlightRequests;
  }

  registerStream(controller: AbortController): () => void {
    this.streams.add(controller);
    return () => {
      this.streams.delete(controller);
    };
  }

  private async drainRequests(): Promise<void> {
    const timeoutMs = this.options.drainTimeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    while (this.inFlightRequests > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.inFlightRequests > 0) {
      console.warn(
        `[vault] Lock proceeding with ${this.inFlightRequests} in-flight request(s) after drain timeout.`
      );
    }
  }

  private abortStreams(): void {
    if (this.streams.size === 0) return;
    console.log(`[vault] Aborting ${this.streams.size} active stream(s).`);
    for (const controller of this.streams) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
    this.streams.clear();
  }

  // --- Transitions ------------------------------------------------------------

  private static assertPasswordUsable(password: string, label: string): void {
    if (typeof password !== 'string' || password.length < 8) {
      throw new VaultFormatError(`${label} must be at least 8 characters`);
    }
    if (password.length > 1024) {
      throw new VaultFormatError(`${label} is too long`);
    }
  }

  /**
   * First-time setup: creates the vault (migrating a legacy install when
   * one exists), starts the worker, attaches the database, and issues the
   * first browser session.
   */
  async setup(password: string): Promise<{ token: string }> {
    this.requireVaultMode();
    VaultManager.assertPasswordUsable(password, 'Vault password');
    return withExclusiveVaultTransition(
      async () => {
        if (this.status !== 'locked') {
          throw new VaultStateError(`Cannot setup while ${this.status}`);
        }
        if (await getActiveGeneration(this.options.vaultRoot)) {
          throw new VaultStateError('Vault already exists; unlock instead');
        }
        // Preflight runs while still 'locked': a failure here (or in
        // staging/key generation) must leave setup retryable instead of
        // bricking the manager in 'unlocking' until restart.
        const legacy = await this.detectLegacyInstall();
        // Fail fast on unmigratable references before generating keys or
        // staging anything (Argon2id + copy + rekey come later).
        if (legacy) await this.preflightLegacyMigration(legacy);
        const staged = await createStagedGeneration(this.options.vaultRoot);
        const keys = generateVaultKeys();
        this.status = 'unlocking';
        try {
          await writeKeysEnvelope(
            staged.keysPath,
            await wrapVaultKeys(
              keys,
              password,
              this.options.kdfParams ?? DEFAULT_KDF_PARAMS
            )
          );
          if (legacy) {
            await this.migrateLegacyIntoStaged(legacy, staged, keys);
          } else {
            const fresh = this.dbOps.createVaultDb(
              staged.dbPath,
              keys.database
            );
            fresh.close();
          }
          await this.verifyAndSealStaged(staged, keys, legacy);
          await replaceCurrentGeneration(this.options.vaultRoot, staged.id);
          this.activeGeneration = staged;
          this.hasVaultFlag = true;

          const connection = this.dbOps.openVaultDb(
            staged.dbPath,
            keys.database
          );
          let handle: WorkerHandle | null = null;
          try {
            this.dbOps.initializeDatabase(connection);
            handle = await this.workerLauncher.startWorker(keys, staged);
            this.dbOps.attachUnlockedDb(connection);
          } catch (error) {
            try {
              connection.close();
            } catch {
              // ignore
            }
            if (handle) await handle.kill().catch(() => {});
            throw error;
          }
          this.workerHandle = handle;
          this.keys = keys;
          this.status = 'unlocked';
          if (legacy) await this.cleanupLegacyInstall(legacy);
          const token = this.sessions.issue();
          return { token };
        } catch (error) {
          clearVaultKeys(keys);
          await discardStagedGeneration(this.options.vaultRoot, staged).catch(
            () => {}
          );
          this.status = 'locked';
          throw error;
        }
      },
      { ifBusy: 'throw' }
    );
  }

  async unlock(password: string): Promise<{ token: string }> {
    this.requireVaultMode();
    if (typeof password !== 'string' || password.length === 0) {
      throw new VaultAuthError('Incorrect vault password');
    }
    return withExclusiveVaultTransition(
      async () => {
        if (this.status === 'unlocked') {
          // Second browser while the server is already open: verify the
          // password, then issue an independent session (no restart).
          const active = await getActiveGeneration(this.options.vaultRoot);
          if (!active) throw new VaultLockedError();
          const envelope = await readKeysEnvelope(active.keysPath);
          if (!(await verifyVaultPassword(envelope, password))) {
            throw new VaultAuthError('Incorrect vault password');
          }
          return { token: this.sessions.issue() };
        }
        if (this.status !== 'locked') {
          throw new VaultStateError(`Cannot unlock while ${this.status}`);
        }
        this.status = 'unlocking';
        const active = await getActiveGeneration(this.options.vaultRoot);
        if (!active) {
          this.status = 'locked';
          throw new VaultStateError('No vault yet; set a password first');
        }
        let keys: VaultKeys | null = null;
        try {
          const envelope = await readKeysEnvelope(active.keysPath);
          keys = await unwrapVaultKeys(envelope, password);
          const connection = this.dbOps.openVaultDb(
            active.dbPath,
            keys.database
          );
          let handle: WorkerHandle | null = null;
          try {
            // Runs pending migrations: the "upgrade active generation"
            // step of the unlock flow.
            this.dbOps.initializeDatabase(connection);
            handle = await this.workerLauncher.startWorker(keys, active);
            this.dbOps.attachUnlockedDb(connection);
          } catch (error) {
            try {
              connection.close();
            } catch {
              // ignore
            }
            if (handle) await handle.kill().catch(() => {});
            throw error;
          }
          this.workerHandle = handle;
          this.keys = keys;
          keys = null; // ownership transferred; do not clear on success
          this.activeGeneration = active;
          this.hasVaultFlag = true;
          this.status = 'unlocked';
          return { token: this.sessions.issue() };
        } catch (error) {
          if (keys) clearVaultKeys(keys);
          this.status = 'locked';
          throw error;
        }
      },
      { ifBusy: 'throw' }
    );
  }

  async lock(
    options: {
      /** Shutdown queues behind an in-flight transition; HTTP fails fast. */
      ifBusy?: 'queue' | 'throw';
    } = {}
  ): Promise<void> {
    this.requireVaultMode();
    return withExclusiveVaultTransition(
      async () => {
        if (this.status === 'locked') return;
        if (this.status !== 'unlocked') {
          throw new VaultStateError(`Cannot lock while ${this.status}`);
        }
        this.status = 'locking';
        try {
          this.sessions.revokeAll();
          await this.drainRequests();
          this.abortStreams();
          if (this.workerHandle) {
            await this.workerHandle.kill().catch((error) => {
              console.warn('[vault] Worker stop failed:', error);
            });
            this.workerHandle = null;
          }
          this.dbOps.closeDb();
        } finally {
          if (this.keys) {
            clearVaultKeys(this.keys);
            this.keys = null;
          }
          this.status = 'locked';
        }
      },
      { ifBusy: options.ifBusy ?? 'throw' }
    );
  }

  async changePassword(
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    this.requireVaultMode();
    if (this.status !== 'unlocked') throw new VaultLockedError();
    VaultManager.assertPasswordUsable(newPassword, 'New vault password');
    return withExclusiveVaultTransition(
      async () => {
        const active = await getActiveGeneration(this.options.vaultRoot);
        if (!active) throw new VaultLockedError();
        const envelope = await readKeysEnvelope(active.keysPath);
        const rewrapped = await rewrapVaultKeys(
          envelope,
          oldPassword,
          newPassword
        );
        await writeKeysEnvelope(active.keysPath, rewrapped);
      },
      { ifBusy: 'throw' }
    );
  }

  /**
   * Commits a verified + sealed staged generation built by the import
   * path: reopens the live database on it and restarts the worker.
   * The current generation stays live until the atomic cutover.
   */
  async restoreStagedAsActive(staged: StagedGenerationRef): Promise<void> {
    this.requireVaultMode();
    if (this.status !== 'unlocked' || !this.keys) throw new VaultLockedError();
    return withExclusiveVaultTransition(
      async () => this.commitStagedGenerationInner(staged),
      { ifBusy: 'throw' }
    );
  }

  /**
   * Staged-import orchestration: creates a fresh generation
   * (same keys, fresh schema), runs `work` to fill it (restore +
   * recordings + FTS rebuild + content verification), then seals and
   * commits it. On any error the staged generation is discarded and the
   * live vault is untouched.
   */
  async importIntoStagedGeneration<T>(
    work: (staged: StagedGenerationRef, stagedDb: SQLiteDatabase) => Promise<T>
  ): Promise<T> {
    this.requireVaultMode();
    if (this.status !== 'unlocked' || !this.keys) throw new VaultLockedError();
    return withExclusiveVaultTransition(
      async () => {
        const staged = await createStagedGeneration(this.options.vaultRoot);
        try {
          // The import reuses the live data keys: copy the envelope bytes
          // so the staged generation opens with the same password.
          const live = await getActiveGeneration(this.options.vaultRoot);
          if (!live) throw new VaultLockedError();
          await fs.copyFile(live.keysPath, staged.keysPath);
          await fs.chmod(staged.keysPath, 0o600);
          const stagedDb = this.dbOps.createVaultDb(
            staged.dbPath,
            this.keys!.database
          );
          let result: T;
          try {
            result = await work(staged, stagedDb);
          } finally {
            stagedDb.close();
          }
          await sealGeneration(staged);
          await this.commitStagedGenerationInner(staged);
          return result;
        } catch (error) {
          await discardStagedGeneration(this.options.vaultRoot, staged).catch(
            () => {}
          );
          throw error;
        }
      },
      { ifBusy: 'throw' }
    );
  }

  /** Cutover + reopen + worker restart. Caller holds the transition. */
  private async commitStagedGenerationInner(
    staged: StagedGenerationRef
  ): Promise<void> {
    await verifyStagedGeneration(staged);
    // Prove the staged database opens with the live keys BEFORE
    // detaching the current generation.
    const probe = this.dbOps.openVaultDb(staged.dbPath, this.keys!.database);
    probe.close();
    if (this.workerHandle) {
      await this.workerHandle.kill().catch(() => {});
      this.workerHandle = null;
    }
    this.dbOps.closeDb();
    await replaceCurrentGeneration(this.options.vaultRoot, staged.id);
    try {
      const connection = this.dbOps.openVaultDb(
        staged.dbPath,
        this.keys!.database
      );
      const handle = await this.workerLauncher.startWorker(this.keys!, staged);
      this.dbOps.attachUnlockedDb(connection);
      this.workerHandle = handle;
      this.activeGeneration = staged;
    } catch (error) {
      // CURRENT names a complete generation: the next unlock recovers.
      // Park here as locked rather than half-open.
      if (this.keys) clearVaultKeys(this.keys);
      this.keys = null;
      this.workerHandle = null;
      this.status = 'locked';
      throw error;
    }
  }

  /**
   * Shutdown pre-lock: drain in-flight requests and abort active streams so
   * the HTTP server can close. The database and keys stay open because model
   * unload reads the active LLM settings from it; the final `shutdown()`
   * performs the actual lock afterwards.
   */
  async prepareShutdown(): Promise<void> {
    if (this.bootMode !== 'vault' || this.status !== 'unlocked') return;
    await this.drainRequests();
    this.abortStreams();
  }

  /**
   * Best-effort lock for process shutdown: stops the supervised worker,
   * closes the database, clears keys, and revokes every browser session so
   * the next start always requires the vault password.
   */
  async shutdown(): Promise<void> {
    if (this.bootMode !== 'vault') return;
    if (this.status === 'unlocked') {
      await this.lock({ ifBusy: 'queue' })
        .then(() => {
          console.log('[vault] Vault locked for shutdown.');
        })
        .catch((error) => {
          console.warn('[vault] Shutdown lock failed:', error);
        });
    } else if (this.workerHandle) {
      await this.workerHandle.kill().catch(() => {});
      this.workerHandle = null;
    }
  }

  // --- Key / generation accessors (vault internals only) ------------------------

  getActiveGenerationPaths(): StagedGenerationRef | null {
    return this.activeGeneration;
  }

  getDatabaseKey(): Buffer {
    if (!this.keys) throw new VaultLockedError();
    return this.keys.database;
  }

  getRecordingsKey(): Buffer {
    if (!this.keys) throw new VaultLockedError();
    return this.keys.recordings;
  }

  // --- Legacy migration ----------------------------------------------------------

  async detectLegacyInstall(): Promise<LegacyInstall | null> {
    try {
      const stat = await fs.stat(this.options.legacyDbPath);
      if (!stat.isFile() || stat.size === 0) return null;
    } catch {
      return null;
    }
    return {
      dbPath: this.options.legacyDbPath,
      uploadsDir: this.options.legacyUploadsDir,
    };
  }

  /**
   * Fail-fast migration validation, before keys are generated or anything
   * is staged: every legacy audioPath reference must be a safe basename
   * present in the legacy uploads dir. Throws one actionable error listing
   * every problem (the seal check would otherwise surface them one at a
   * time after minutes of expensive work).
   */
  private async preflightLegacyMigration(legacy: LegacyInstall): Promise<void> {
    const probe = this.dbOps.openLegacyDatabase(legacy.dbPath);
    let refs: string[];
    try {
      const rows = probe
        .prepare(
          'SELECT DISTINCT audioPath AS p FROM sessions WHERE audioPath IS NOT NULL'
        )
        .all() as { p: string }[];
      refs = rows.map((row) => row.p);
    } finally {
      probe.close();
    }
    const unsafe = refs.filter((ref) => !isSafeAudioBasename(ref));
    let entries: Set<string>;
    try {
      const dirents = await fs.readdir(legacy.uploadsDir, {
        withFileTypes: true,
      });
      entries = new Set(
        dirents.filter((entry) => entry.isFile()).map((entry) => entry.name)
      );
    } catch {
      entries = new Set();
    }
    const missing = [...new Set(refs)].filter(
      (ref) => isSafeAudioBasename(ref) && !entries.has(ref)
    );
    if (unsafe.length === 0 && missing.length === 0) return;
    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(
        `${missing.length} session(s) reference recordings missing from ${legacy.uploadsDir}: ${formatFileList(missing)}`
      );
    }
    if (unsafe.length > 0) {
      problems.push(
        `${unsafe.length} audioPath reference(s) are not plain file names: ${formatFileList(unsafe)}`
      );
    }
    throw new VaultFormatError(
      `Cannot migrate the legacy install. ${problems.join(' ')} ` +
        `Restore the files, or run 'yarn vault:prepare-migration --repair-missing-audio' ` +
        'to clear references whose audio is already unrecoverable, then retry setup. ' +
        'No vault was created.'
    );
  }

  private defaultExportDatabase(
    stagedDbPath: string,
    legacyDbPath: string,
    key: Buffer
  ): void {
    // Byte-copy the quiesced legacy file, then encrypt the copy in place.
    // Requires the cipher-capable binding for `rekey()`; the plaintext
    // copy exists only inside the staging directory until the rekey lands.
    realCopyPlaintextDbAndRekey(stagedDbPath, legacyDbPath, key);
  }

  private async migrateLegacyIntoStaged(
    legacy: LegacyInstall,
    staged: StagedGenerationRef,
    keys: VaultKeys
  ): Promise<void> {
    // Quiesce writers (none are running pre-setup) and fold the WAL back
    // into the legacy file so the export sees every committed row.
    const legacyProbe = this.dbOps.openLegacyDatabase(legacy.dbPath);
    try {
      legacyProbe.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      legacyProbe.close();
    }

    // The export brings the source schema (byte copy preserves the schema
    // version); initializeDatabase upgrades it afterwards.
    const sourceVersion = this.readUserVersion(legacy.dbPath);
    const exportFn =
      this.options.exportDatabaseForMigration ??
      this.defaultExportDatabase.bind(this);
    await exportFn(staged.dbPath, legacy.dbPath, keys.database);
    const stagedDb = this.dbOps.openVaultDb(staged.dbPath, keys.database);
    try {
      // Explicitly preserve the source schema version across the export,
      // then migrate forward to the latest schema.
      stagedDb.pragma(`user_version = ${sourceVersion}`);
      this.dbOps.initializeDatabase(stagedDb);
      // Vault audio ids always end in .enc; migrated rows are rewritten
      // so playback, transcription, and backup resolve uniformly.
      stagedDb.exec(
        `UPDATE sessions SET audioPath = audioPath || '.enc' WHERE audioPath IS NOT NULL AND audioPath NOT LIKE '%.enc'`
      );
    } finally {
      stagedDb.close();
    }

    await this.encryptLegacyRecordings(legacy, staged, keys.recordings);
  }

  private readUserVersion(dbPath: string): number {
    const probe = this.dbOps.openLegacyDatabase(dbPath);
    try {
      return probe.pragma('user_version', { simple: true }) as number;
    } finally {
      probe.close();
    }
  }

  private async encryptLegacyRecordings(
    legacy: LegacyInstall,
    staged: StagedGenerationRef,
    recordingsKey: Buffer
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(legacy.uploadsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (
        entry === '' ||
        entry.startsWith('.') ||
        entry.includes('/') ||
        entry.includes('\\')
      ) {
        continue;
      }
      const source = path.join(legacy.uploadsDir, entry);
      const stat = await fs.stat(source);
      if (!stat.isFile()) continue;
      const plaintext = await fs.readFile(source);
      if (plaintext.length === 0) continue;
      const encrypted = encryptRecording(plaintext, recordingsKey);
      const target = path.join(staged.recordingsDir, `${entry}.enc`);
      await fs.writeFile(target, encrypted, { mode: 0o600 });
      await fs.chmod(target, 0o600);
    }
  }

  private countMigrationTables(
    opener: (dbPath: string) => SQLiteDatabase,
    dbPath: string
  ): Record<string, number> {
    const connection = opener(dbPath);
    try {
      const counts: Record<string, number> = {};
      const tables = (
        connection
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name);
      for (const table of MIGRATION_COUNT_TABLES) {
        if (!tables.includes(table)) {
          counts[table] = -1;
          continue;
        }
        const row = connection
          .prepare(`SELECT COUNT(*) AS total FROM "${table}"`)
          .get() as { total: number };
        counts[table] = row.total;
      }
      return counts;
    } finally {
      connection.close();
    }
  }

  private async verifyAndSealStaged(
    staged: StagedGenerationRef,
    keys: VaultKeys,
    legacy: LegacyInstall | null
  ): Promise<void> {
    const connection = this.dbOps.openVaultDb(staged.dbPath, keys.database);
    try {
      const integrity = connection.prepare('PRAGMA integrity_check').all() as {
        integrity_check: string;
      }[];
      if (
        integrity.length === 0 ||
        integrity.some((row) => row.integrity_check !== 'ok')
      ) {
        throw new VaultFormatError('Staged database failed integrity_check');
      }
      const fkErrors = connection
        .prepare('PRAGMA foreign_key_check')
        .all() as unknown[];
      if (fkErrors.length > 0) {
        throw new VaultFormatError(
          `Staged database has ${fkErrors.length} foreign-key violation(s)`
        );
      }
      if (legacy) {
        const expected = this.countMigrationTables(
          (p) => this.dbOps.openLegacyDatabase(p),
          legacy.dbPath
        );
        const actual = this.countMigrationTables(
          (p) => this.dbOps.openVaultDb(p, keys.database),
          staged.dbPath
        );
        for (const table of MIGRATION_COUNT_TABLES) {
          if (expected[table] !== actual[table]) {
            throw new VaultFormatError(
              `Migration count mismatch on ${table}: legacy=${expected[table]} staged=${actual[table]}`
            );
          }
        }
        // Every migrated audio reference must have an encrypted payload.
        const sessions = connection
          .prepare('SELECT audioPath FROM sessions WHERE audioPath IS NOT NULL')
          .all() as { audioPath: string }[];
        for (const row of sessions) {
          const base = path.basename(row.audioPath);
          if (base !== row.audioPath || !base.endsWith('.enc')) {
            throw new VaultFormatError(
              `Migrated audioPath is not vault-shaped: ${JSON.stringify(row.audioPath)}`
            );
          }
          try {
            await fs.access(path.join(staged.recordingsDir, base));
          } catch {
            throw new VaultFormatError(`Missing migrated recording: ${base}`);
          }
        }
      }
    } finally {
      connection.close();
    }
    await sealGeneration(staged);
  }

  private async cleanupLegacyInstall(legacy: LegacyInstall): Promise<void> {
    // Tracked in CLEANUP.json so a crash between cutover and deletion
    // resumes on the next boot. Elasticsearch indices hold transcript
    // copies too; they are dropped best-effort (the service may be down).
    await writeCleanupManifest(this.options.vaultRoot, [
      legacy.dbPath,
      `${legacy.dbPath}-wal`,
      `${legacy.dbPath}-shm`,
      `${legacy.dbPath}-journal`,
      legacy.uploadsDir,
    ]);
    // Best-effort and time-bounded: the ES service may be down (or
    // already retired), and this runs inside the setup transition.
    const dropLegacyIndices = (async () => {
      try {
        const { getElasticsearchClient } = await import(
          '@therascript/elasticsearch-client'
        );
        const client = getElasticsearchClient(config.elasticsearch.url);
        await client.indices.delete({ index: 'therascript_*' }).catch(() => {});
      } catch {
        // The ES service is optional in vault mode; its absence is fine.
      }
    })();
    await Promise.race([
      dropLegacyIndices,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    const result = await resumeInterruptedCleanup(this.options.vaultRoot);
    if (result && result.failed.length > 0) {
      console.warn(
        '[vault] Legacy cleanup incomplete, will resume on next boot:',
        result.failed
      );
    }
  }
}

// --- Process singleton ----------------------------------------------------------

let singleton: VaultManager | null = null;

export function getVaultManager(): VaultManager {
  if (!singleton) {
    // Defensive fallbacks: unit tests often mock @therascript/config
    // partially. The manager stays inert (protection inactive) until
    // enable() runs, so these only need to be well-typed here.
    const vaultDir =
      (config as { vault?: { dir?: string } }).vault?.dir ??
      path.join(process.cwd(), 'packages/api/data/vault');
    const dbConfig = (
      config as { db?: { sqlitePath?: string; uploadsDir?: string } }
    ).db;
    singleton = new VaultManager({
      vaultRoot: vaultDir,
      legacyDbPath: dbConfig?.sqlitePath ?? ':memory:',
      legacyUploadsDir:
        dbConfig?.uploadsDir ??
        path.join(process.cwd(), 'packages/api/data/uploads'),
    });
  }
  return singleton;
}

/** Test-only: swaps the process singleton (restored via resetVaultManager). */
export function setVaultManagerForTests(manager: VaultManager | null): void {
  singleton = manager;
}

export function resetVaultManager(): void {
  singleton = null;
}
