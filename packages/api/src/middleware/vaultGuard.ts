// packages/api/src/middleware/vaultGuard.ts
//
// Server-side vault gate. When vault protection is active,
// every protected route — audio, downloads, SSE, settings, admin —
// requires a valid vault session cookie. The vault control path, health,
// and docs stay public. Inactive (legacy fallback boot, tests that never
// enable the manager) the guard passes everything through.
//
// NOTE on Elysia hook propagation (verified against elysia@1.2.25):
// hooks propagate DOWNWARD ONLY — from an instance into route groups
// mounted with .use() afterwards. A hooks-only plugin mounted with
// .use() does NOT gate sibling groups or outer inline routes. So these
// hooks must be registered INLINE on the setupRoutes() instance (and
// mirrored inline in tests), never as a .use(vaultGuardPlugin).
import { parseSessionCookie } from '@therascript/vault';
import { getVaultManager } from '../services/vaultManager.js';
import { UnauthorizedError } from '../errors.js';

const REQUEST_RELEASE = Symbol.for('therascript.vault.requestRelease');

type ReleasableRequest = Request & {
  [REQUEST_RELEASE]?: () => void;
};

function releaseTrackedRequest(request: Request): void {
  const releasable = request as ReleasableRequest;
  const release = releasable[REQUEST_RELEASE];
  if (release) {
    releasable[REQUEST_RELEASE] = undefined;
    release();
  }
}

/** Paths that never require a vault session. */
export function isVaultPublicPath(pathname: string): boolean {
  if (pathname === '/api/health') return true;
  if (pathname === '/api/status/readiness') return true;
  if (pathname === '/api/schema') return true;
  if (pathname === '/api/docs' || pathname.startsWith('/api/docs/')) {
    return true;
  }
  if (pathname === '/api/vault/status') return true;
  if (pathname === '/api/vault/setup') return true;
  if (pathname === '/api/vault/unlock') return true;
  // /api/vault/lock and /api/vault/change-password check the session
  // themselves (so they can clear cookies / report precisely).
  if (pathname === '/api/vault/lock') return true;
  if (pathname === '/api/vault/change-password') return true;
  return false;
}

export function vaultGuardBeforeHandle({
  request,
}: {
  request: Request;
}): void {
  const manager = getVaultManager();
  if (!manager.isProtectionActive()) return;
  const pathname = new URL(request.url).pathname;
  if (isVaultPublicPath(pathname)) return;
  const token = parseSessionCookie(request.headers.get('cookie'));
  if (!manager.isSessionValid(token)) {
    throw new UnauthorizedError('Vault is locked');
  }
  // Tracked for the lock-time drain; released after the response (or
  // on error) below. The control path is never tracked.
  (request as ReleasableRequest)[REQUEST_RELEASE] = manager.trackRequest();
}

export function vaultGuardAfterHandle({ request }: { request: Request }): void {
  releaseTrackedRequest(request);
}

export function vaultGuardOnError({ request }: { request?: Request }): void {
  // Release-only: returning undefined lets other error handlers continue.
  if (request) releaseTrackedRequest(request);
}
