// packages/api/src/api/vaultHandler.ts
//
// HTTP-facing vault services: origin + rate-limit enforcement and
// vault-error → HTTP-error mapping over the VaultManager singleton.
import config from '@therascript/config';
import {
  VaultAuthError,
  VaultBusyError,
  VaultFormatError,
  VaultLockedError,
  VaultStateError,
  isOriginAllowed,
} from '@therascript/vault';
import {
  getVaultManager,
  type VaultPublicStatus,
} from '../services/vaultManager.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../errors.js';

export interface VaultRequestContext {
  clientIp: string;
  origin: string | null;
}

/** The node:http front door stamps the socket address here (server.ts). */
export const CLIENT_IP_HEADER = 'x-therascript-remote-addr';

export function clientIpFromRequest(request: Request): string {
  const stamped = request.headers.get(CLIENT_IP_HEADER);
  if (stamped && stamped.trim() !== '') return stamped.trim();
  return 'unknown';
}

export function getVaultStatusService(
  sessionToken: string | null | undefined
): VaultPublicStatus {
  return getVaultManager().getPublicStatus(sessionToken);
}

function mapVaultError(error: unknown): never {
  if (error instanceof VaultAuthError) {
    throw new UnauthorizedError('Incorrect password');
  }
  if (error instanceof VaultLockedError) {
    throw new UnauthorizedError('Vault is locked');
  }
  if (error instanceof VaultBusyError) {
    throw new ConflictError(
      'A vault operation is already in progress; retry shortly'
    );
  }
  if (error instanceof VaultStateError) {
    throw new ConflictError(error.message);
  }
  if (error instanceof VaultFormatError) {
    throw new BadRequestError(error.message);
  }
  throw new InternalServerError(
    'Vault operation failed',
    error instanceof Error ? error : undefined
  );
}

function checkOriginAndRateLimit(
  context: VaultRequestContext,
  scope: 'setup' | 'unlock'
): void {
  if (
    !isOriginAllowed(context.origin, [
      config.server.corsOrigin,
      `http://${config.server.host}:${config.server.port}`,
      `http://localhost:${config.server.port}`,
    ])
  ) {
    throw new ForbiddenError('Request origin is not allowed');
  }
  const decision = getVaultManager().checkUnlockAttempt(
    `${scope}:${context.clientIp}`
  );
  if (!decision.allowed) {
    throw new TooManyRequestsError('Too many attempts; slow down', {
      retryAfterMs: decision.retryAfterMs,
    });
  }
}

export async function setupVaultService(
  password: string,
  context: VaultRequestContext
): Promise<{ token: string }> {
  checkOriginAndRateLimit(context, 'setup');
  try {
    const result = await getVaultManager().setup(password);
    getVaultManager().resetUnlockAttempts(`setup:${context.clientIp}`);
    return result;
  } catch (error) {
    mapVaultError(error);
  }
}

export async function unlockVaultService(
  password: string,
  context: VaultRequestContext
): Promise<{ token: string }> {
  checkOriginAndRateLimit(context, 'unlock');
  try {
    const result = await getVaultManager().unlock(password);
    getVaultManager().resetUnlockAttempts(`unlock:${context.clientIp}`);
    return result;
  } catch (error) {
    mapVaultError(error);
  }
}

export async function lockVaultService(): Promise<void> {
  try {
    await getVaultManager().lock();
  } catch (error) {
    mapVaultError(error);
  }
}

export async function changeVaultPasswordService(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  try {
    await getVaultManager().changePassword(oldPassword, newPassword);
  } catch (error) {
    mapVaultError(error);
  }
}
