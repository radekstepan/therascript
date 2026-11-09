// @vitest-environment node
// packages/api/src/routes/vaultRoutes.test.ts
//
// HTTP contracts for the vault control path: status visibility per
// session, setup/unlock/lock/change-password flows, cookie handling,
// origin enforcement, unlock rate limiting, and the guard on a sample
// protected route. Backed by a real VaultManager with a fake worker
// launcher and plaintext stand-in DbOps (same doubles as
// vaultManager.test.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Elysia } from 'elysia';
import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initializeDatabase,
  attachUnlockedDb,
  closeDb,
  type SQLiteDatabase,
} from '@therascript/db';
import { TEST_KDF_PARAMS, type VaultKeys } from '@therascript/vault';
import {
  VaultManager,
  setVaultManagerForTests,
  resetVaultManager,
  type VaultDbOps,
  type WorkerHandle,
  type WorkerLauncher,
  type StagedGenerationRef,
} from '../services/vaultManager.js';
import { CLIENT_IP_HEADER } from '../api/vaultHandler.js';

class FakeWorkerLauncher implements WorkerLauncher {
  live = 0;
  async startWorker(
    _keys: VaultKeys,
    _generation: StagedGenerationRef
  ): Promise<WorkerHandle> {
    this.live += 1;
    return {
      pid: 1,
      kill: async () => {
        this.live = Math.max(0, this.live - 1);
      },
      waitForExit: async () => {},
    };
  }
}

const fakeDbOps: VaultDbOps = {
  openVaultDb: (filename, _key, options) =>
    new Database(filename, {
      fileMustExist: options?.fileMustExist ?? true,
    }) as unknown as SQLiteDatabase,
  createVaultDb: (filename, _key) => {
    const connection = new Database(filename) as unknown as SQLiteDatabase;
    initializeDatabase(connection);
    return connection;
  },
  openLegacyDatabase: (filename) =>
    new Database(filename) as unknown as SQLiteDatabase,
  attachUnlockedDb: (connection) =>
    attachUnlockedDb(connection as unknown as SQLiteDatabase),
  closeDb: () => closeDb(),
  isDbUnlocked: () => true,
  initializeDatabase: (connection) =>
    initializeDatabase(connection as unknown as SQLiteDatabase),
};

const ORIGIN = 'http://localhost:3002';

let root: string;
let app: Elysia<any, any, any, any, any, any>;
let password = 'password123';

function jsonRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    ip?: string;
  } = {}
): Request {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers['cookie'] = init.cookie;
  if (init.origin !== null) headers['origin'] = init.origin ?? ORIGIN;
  headers[CLIENT_IP_HEADER] = init.ip ?? 'test-client';
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('therascript_vault_session=');
  expect(setCookie).toContain('HttpOnly');
  // Sessions survive browser restarts (the vault still re-locks with the
  // API process).
  expect(setCookie).toContain('Max-Age=');
  return setCookie.split(';')[0]!;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-routes-test-'));
  const manager = new VaultManager({
    vaultRoot: path.join(root, 'vault'),
    legacyDbPath: path.join(root, 'legacy.sqlite'),
    legacyUploadsDir: path.join(root, 'uploads'),
    workerLauncher: new FakeWorkerLauncher(),
    dbOps: fakeDbOps,
    kdfParams: TEST_KDF_PARAMS,
    cipherProbe: () => true,
  });
  await manager.enable();
  setVaultManagerForTests(manager);

  const { vaultRoutes } = await import('./vaultRoutes.js');
  const { vaultGuardBeforeHandle, vaultGuardAfterHandle, vaultGuardOnError } =
    await import('../middleware/vaultGuard.js');
  const { setupMiddleware } = await import('../setupMiddleware.js');
  // Mirrors setupRoutes(): guard hooks inline so they propagate into
  // mounted groups and later inline routes.
  app = new Elysia()
    .use(setupMiddleware('test', {} as never))
    .onBeforeHandle(vaultGuardBeforeHandle)
    .onAfterHandle(vaultGuardAfterHandle)
    .onError(vaultGuardOnError)
    .use(vaultRoutes)
    .get('/api/probe', () => ({ probe: 'ok' }));
});

afterAll(async () => {
  resetVaultManager();
  closeDb();
  await fs.rm(root, { recursive: true, force: true });
});

describe('GET /api/vault/status', () => {
  it('reports locked without a session', async () => {
    const response = await app.handle(jsonRequest('/api/vault/status'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'locked',
      hasVault: false,
      authenticated: false,
      legacyFallback: false,
    });
  });
});

describe('POST /api/vault/setup', () => {
  it('rejects missing origins', async () => {
    const response = await app.handle(
      jsonRequest('/api/vault/setup', {
        method: 'POST',
        body: { password },
        origin: null,
        ip: 'setup-origin',
      })
    );
    expect(response.status).toBe(403);
  });

  it('rejects short passwords', async () => {
    const response = await app.handle(
      jsonRequest('/api/vault/setup', {
        method: 'POST',
        body: { password: 'short' },
        ip: 'setup-short',
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects invalid bodies', async () => {
    const response = await app.handle(
      jsonRequest('/api/vault/setup', {
        method: 'POST',
        body: {},
        ip: 'setup-body',
      })
    );
    // Elysia's native schema-validation status (response validation
    // elsewhere in the repo also asserts 422).
    expect(response.status).toBe(422);
  });
});

describe('vault session lifecycle over HTTP', () => {
  let cookie = '';

  it('setup issues an HttpOnly session cookie', async () => {
    const response = await app.handle(
      jsonRequest('/api/vault/setup', {
        method: 'POST',
        body: { password },
        ip: 'setup-ok',
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'unlocked' });
    cookie = sessionCookieFrom(response);
  });

  it('status is unlocked for the session, locked for strangers', async () => {
    const authed = await app.handle(
      jsonRequest('/api/vault/status', { cookie })
    );
    expect(await authed.json()).toMatchObject({
      status: 'unlocked',
      hasVault: true,
      authenticated: true,
    });
    const stranger = await app.handle(
      jsonRequest('/api/vault/status', {
        cookie: 'therascript_vault_session=bogus',
      })
    );
    expect(await stranger.json()).toMatchObject({
      status: 'locked',
      authenticated: false,
    });
  });

  it('guard blocks protected routes without a session', async () => {
    const denied = await app.handle(jsonRequest('/api/probe'));
    expect(denied.status).toBe(401);
    const allowed = await app.handle(jsonRequest('/api/probe', { cookie }));
    expect(allowed.status).toBe(200);
  });

  it('duplicate setup conflicts', async () => {
    const response = await app.handle(
      jsonRequest('/api/vault/setup', {
        method: 'POST',
        body: { password },
        ip: 'setup-dup',
      })
    );
    expect(response.status).toBe(409);
  });

  it('unlock verifies the password for a second session', async () => {
    const wrong = await app.handle(
      jsonRequest('/api/vault/unlock', {
        method: 'POST',
        body: { password: 'wrongpassword' },
        ip: 'unlock-second',
      })
    );
    expect(wrong.status).toBe(401);
    const right = await app.handle(
      jsonRequest('/api/vault/unlock', {
        method: 'POST',
        body: { password },
        ip: 'unlock-second',
      })
    );
    expect(right.status).toBe(200);
    const secondCookie = sessionCookieFrom(right);
    expect(secondCookie).not.toBe(cookie);
    const probe = await app.handle(
      jsonRequest('/api/probe', { cookie: secondCookie })
    );
    expect(probe.status).toBe(200);
  });

  it('change-password rotates to a new password', async () => {
    const wrong = await app.handle(
      jsonRequest('/api/vault/change-password', {
        method: 'POST',
        body: { oldPassword: 'nope-nope-nope', newPassword: 'newpassword456' },
        cookie,
        ip: 'change-pw',
      })
    );
    expect(wrong.status).toBe(401);
    const right = await app.handle(
      jsonRequest('/api/vault/change-password', {
        method: 'POST',
        body: { oldPassword: password, newPassword: 'newpassword456' },
        cookie,
        ip: 'change-pw',
      })
    );
    expect(right.status).toBe(200);
    password = 'newpassword456';
  });

  it('lock revokes sessions and clears the cookie', async () => {
    const unauth = await app.handle(
      jsonRequest('/api/vault/lock', { method: 'POST' })
    );
    expect(unauth.status).toBe(401);
    const response = await app.handle(
      jsonRequest('/api/vault/lock', { method: 'POST', cookie })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    const probe = await app.handle(jsonRequest('/api/probe', { cookie }));
    expect(probe.status).toBe(401);
  });

  it('unlock works after lock with the new password', async () => {
    const old = await app.handle(
      jsonRequest('/api/vault/unlock', {
        method: 'POST',
        body: { password: 'password123' },
        ip: 'unlock-after-lock',
      })
    );
    expect(old.status).toBe(401);
    const fresh = await app.handle(
      jsonRequest('/api/vault/unlock', {
        method: 'POST',
        body: { password },
        ip: 'unlock-after-lock',
      })
    );
    expect(fresh.status).toBe(200);
    cookie = sessionCookieFrom(fresh);
    const probe = await app.handle(jsonRequest('/api/probe', { cookie }));
    expect(probe.status).toBe(200);
  });

  it('rate-limits unlock attempts per client', async () => {
    const ip = 'rate-limited-client';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.handle(
        jsonRequest('/api/vault/unlock', {
          method: 'POST',
          body: { password: 'wrongpassword' },
          ip,
        })
      );
      expect(response.status).toBe(401);
    }
    const limited = await app.handle(
      jsonRequest('/api/vault/unlock', {
        method: 'POST',
        body: { password: 'wrongpassword' },
        ip,
      })
    );
    expect(limited.status).toBe(429);
  });
});
