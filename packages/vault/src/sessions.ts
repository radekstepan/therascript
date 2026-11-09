// packages/vault/src/sessions.ts
//
// Browser-session and unlock-abuse primitives:
//
//   - Opaque session tokens kept in server memory only (never Redis, never
//     logs). Compared in constant time.
//   - HttpOnly session cookie helpers.
//   - Fixed-window rate limiting for unlock attempts, keyed by client IP.
//   - Origin allowlist check for state-changing vault requests.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const VAULT_SESSION_COOKIE = 'therascript_vault_session';
export const SESSION_TOKEN_BYTES = 32;

/**
 * Browser-session lifetime. The cookie survives a browser restart so
 * closing a tab does not force a vault unlock while the API is still
 * running. The server-side tokens remain memory-only, and the vault always
 * re-locks (and revokes every session) when the API process stops.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** In-memory session registry. All sessions die with the process. */
export class VaultSessionStore {
  private readonly tokens = new Set<string>();

  get size(): number {
    return this.tokens.size;
  }

  issue(): string {
    const token = createSessionToken();
    this.tokens.add(token);
    return token;
  }

  isValid(token: string | null | undefined): boolean {
    if (typeof token !== 'string' || token === '') return false;
    for (const candidate of this.tokens) {
      if (safeEqualHex(candidate, token)) return true;
    }
    return false;
  }

  revoke(token: string): boolean {
    for (const candidate of this.tokens) {
      if (safeEqualHex(candidate, token)) {
        this.tokens.delete(candidate);
        return true;
      }
    }
    return false;
  }

  revokeAll(): void {
    this.tokens.clear();
  }
}

export function buildSessionCookie(
  token: string,
  options: { secure?: boolean; maxAgeSeconds?: number } = {}
): string {
  const parts = [
    `${VAULT_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.secure !== false) parts.push('Secure');
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  return parts.join('; ');
}

export function buildClearSessionCookie(): string {
  return `${VAULT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Extracts the session token from a Cookie header value, if present. */
export function parseSessionCookie(
  cookieHeader: string | null | undefined
): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return null;
  const prefix = `${VAULT_SESSION_COOKIE}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      if (value === '') return null;
      return decodeURIComponentSafe(value);
    }
  }
  return null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// --- Rate limiting --------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

export interface UnlockRateLimiterOptions {
  maxAttempts?: number;
  windowMs?: number;
  now?: () => number;
}

/** Fixed-window per-key limiter for unlock/setup attempts. */
export class UnlockRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: UnlockRateLimiterOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxAttempts) {
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, oldest + this.windowMs - now),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

// --- Origin check ----------------------------------------------------------

/**
 * Exact-match origin allowlist for state-changing vault requests.
 * A missing origin on a state change is rejected (same-origin browser
 * requests always send Origin for POST; curl without Origin is treated as
 * untrusted for unlock/setup/lock).
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (typeof origin !== 'string' || origin === '') return false;
  return allowedOrigins.includes(origin);
}
