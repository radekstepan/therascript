// packages/api/src/routes/vaultRoutes.ts
import { Elysia, t } from 'elysia';
import config from '@therascript/config';
import {
  buildSessionCookie,
  buildClearSessionCookie,
  parseSessionCookie,
  SESSION_MAX_AGE_SECONDS,
} from '@therascript/vault';
import {
  getVaultStatusService,
  setupVaultService,
  unlockVaultService,
  lockVaultService,
  changeVaultPasswordService,
  clientIpFromRequest,
} from '../api/vaultHandler.js';
import { UnauthorizedError } from '../errors.js';
import { getVaultManager } from '../services/vaultManager.js';

const VaultStatusSchema = t.Object({
  status: t.Union([
    t.Literal('locked'),
    t.Literal('unlocking'),
    t.Literal('unlocked'),
    t.Literal('locking'),
  ]),
  hasVault: t.Boolean(),
  authenticated: t.Boolean(),
  legacyFallback: t.Boolean(),
});

const TokenResponseSchema = t.Object({
  ok: t.Boolean(),
  status: t.String(),
});

const PasswordBodySchema = t.Object({
  password: t.String({ minLength: 1, maxLength: 1024 }),
});

const ChangePasswordBodySchema = t.Object({
  oldPassword: t.String({ minLength: 1, maxLength: 1024 }),
  newPassword: t.String({ minLength: 1, maxLength: 1024 }),
});

function sessionCookieHeader(token: string): string {
  return buildSessionCookie(token, {
    // The UI is normally served over plain HTTP on localhost. Only mark the
    // cookie Secure when the configured browser origin actually uses HTTPS;
    // otherwise some browsers drop it and the vault screen reappears after
    // every reload.
    secure: /^https:/i.test(config.server.corsOrigin),
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
}

function requestContext(request: Request): {
  clientIp: string;
  origin: string | null;
} {
  return {
    clientIp: clientIpFromRequest(request),
    origin: request.headers.get('origin'),
  };
}

export const vaultRoutes = new Elysia({ prefix: '/api/vault' })
  .model({
    vaultStatus: VaultStatusSchema,
    tokenResponse: TokenResponseSchema,
    passwordBody: PasswordBodySchema,
    changePasswordBody: ChangePasswordBodySchema,
    errorResponse: t.Object({
      error: t.String(),
      message: t.String(),
      details: t.Optional(t.Any()),
    }),
  })
  .group('', { detail: { tags: ['Vault'] } }, (app) =>
    app
      .get(
        '/status',
        ({ request }) => {
          const token = parseSessionCookie(request.headers.get('cookie'));
          return getVaultStatusService(token);
        },
        {
          response: { 200: 'vaultStatus' },
          detail: { summary: 'Vault status for this browser session' },
        }
      )
      .post(
        '/setup',
        async ({ body, request, set }) => {
          const { token } = await setupVaultService(
            body.password,
            requestContext(request)
          );
          set.headers['Set-Cookie'] = sessionCookieHeader(token);
          set.status = 200;
          return { ok: true, status: 'unlocked' };
        },
        {
          body: 'passwordBody',
          response: { 200: 'tokenResponse' },
          detail: {
            summary: 'Create the vault (first use / legacy upgrade)',
          },
        }
      )
      .post(
        '/unlock',
        async ({ body, request, set }) => {
          const { token } = await unlockVaultService(
            body.password,
            requestContext(request)
          );
          set.headers['Set-Cookie'] = sessionCookieHeader(token);
          set.status = 200;
          return { ok: true, status: 'unlocked' };
        },
        {
          body: 'passwordBody',
          response: { 200: 'tokenResponse', 401: 'errorResponse' },
          detail: { summary: 'Unlock the vault' },
        }
      )
      .post(
        '/lock',
        async ({ request, set }) => {
          const token = parseSessionCookie(request.headers.get('cookie'));
          if (!getVaultManager().isSessionValid(token)) {
            throw new UnauthorizedError('Vault is locked');
          }
          await lockVaultService();
          set.headers['Set-Cookie'] = buildClearSessionCookie();
          set.status = 200;
          return { ok: true, status: 'locked' };
        },
        {
          response: { 200: 'tokenResponse', 401: 'errorResponse' },
          detail: { summary: 'Lock the vault (revokes all sessions)' },
        }
      )
      .post(
        '/change-password',
        async ({ body, request, set }) => {
          const token = parseSessionCookie(request.headers.get('cookie'));
          if (!getVaultManager().isSessionValid(token)) {
            throw new UnauthorizedError('Vault is locked');
          }
          await changeVaultPasswordService(body.oldPassword, body.newPassword);
          set.status = 200;
          return { ok: true, status: 'unlocked' };
        },
        {
          body: 'changePasswordBody',
          response: { 200: 'tokenResponse', 401: 'errorResponse' },
          detail: { summary: 'Change the vault password (rewraps keys)' },
        }
      )
  );
