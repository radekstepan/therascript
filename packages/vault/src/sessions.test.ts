// @vitest-environment node
// packages/vault/src/sessions.test.ts
import { describe, it, expect } from 'vitest';
import {
  VaultSessionStore,
  UnlockRateLimiter,
  buildSessionCookie,
  buildClearSessionCookie,
  parseSessionCookie,
  isOriginAllowed,
  VAULT_SESSION_COOKIE,
  createSessionToken,
} from './sessions.js';

describe('VaultSessionStore', () => {
  it('issues opaque tokens and validates them', () => {
    const store = new VaultSessionStore();
    const token = store.issue();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
    expect(store.isValid(token)).toBe(true);
    expect(store.isValid('bogus')).toBe(false);
    expect(store.isValid(null)).toBe(false);
    expect(store.isValid(undefined)).toBe(false);
    expect(store.isValid('')).toBe(false);
    expect(store.size).toBe(1);
  });

  it('issues unique tokens', () => {
    const store = new VaultSessionStore();
    expect(store.issue()).not.toBe(store.issue());
    expect(createSessionToken()).not.toBe(createSessionToken());
  });

  it('revokes one session or all sessions', () => {
    const store = new VaultSessionStore();
    const a = store.issue();
    const b = store.issue();
    expect(store.revoke(a)).toBe(true);
    expect(store.isValid(a)).toBe(false);
    expect(store.isValid(b)).toBe(true);
    expect(store.revoke(a)).toBe(false);
    store.revokeAll();
    expect(store.isValid(b)).toBe(false);
    expect(store.size).toBe(0);
  });
});

describe('session cookie helpers', () => {
  it('builds an HttpOnly cookie and parses it back', () => {
    const cookie = buildSessionCookie('tok123', { secure: false });
    expect(cookie).toContain(`${VAULT_SESSION_COOKIE}=tok123`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(
      parseSessionCookie(`other=1; ${VAULT_SESSION_COOKIE}=tok123; x=2`)
    ).toBe('tok123');
  });

  it('sets Secure by default', () => {
    expect(buildSessionCookie('t')).toContain('Secure');
  });

  it('persists the cookie when a max age is supplied', () => {
    const cookie = buildSessionCookie('t', {
      secure: false,
      maxAgeSeconds: 3600,
    });
    expect(cookie).toContain('Max-Age=3600');
  });

  it('clears the cookie and handles missing headers', () => {
    expect(buildClearSessionCookie()).toContain('Max-Age=0');
    expect(parseSessionCookie(null)).toBeNull();
    expect(parseSessionCookie('')).toBeNull();
    expect(parseSessionCookie('other=1')).toBeNull();
    expect(parseSessionCookie(`${VAULT_SESSION_COOKIE}=`)).toBeNull();
  });
});

describe('UnlockRateLimiter', () => {
  it('allows N attempts per window, then blocks with retryAfter', () => {
    let now = 1_000_000;
    const limiter = new UnlockRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      now: () => now,
    });
    expect(limiter.check('1.2.3.4').allowed).toBe(true);
    expect(limiter.check('1.2.3.4').allowed).toBe(true);
    expect(limiter.check('1.2.3.4').allowed).toBe(true);
    const blocked = limiter.check('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // Other clients are unaffected.
    expect(limiter.check('9.9.9.9').allowed).toBe(true);
    // Window expiry restores access.
    now += 60_001;
    expect(limiter.check('1.2.3.4').allowed).toBe(true);
  });

  it('supports manual reset after a successful unlock', () => {
    const limiter = new UnlockRateLimiter({ maxAttempts: 1 });
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);
    limiter.reset('ip');
    expect(limiter.check('ip').allowed).toBe(true);
  });
});

describe('isOriginAllowed', () => {
  it('exact-matches the allowlist and rejects missing origins', () => {
    const allowed = ['http://localhost:3002'];
    expect(isOriginAllowed('http://localhost:3002', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3002/', allowed)).toBe(false);
    expect(isOriginAllowed('http://evil.com', allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
    expect(isOriginAllowed('', allowed)).toBe(false);
  });
});
