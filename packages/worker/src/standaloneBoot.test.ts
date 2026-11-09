// @vitest-environment node
// packages/worker/src/standaloneBoot.test.ts
import { describe, it, expect } from 'vitest';
import { decideStandaloneBoot } from './standaloneBoot.js';

describe('standalone worker boot policy', () => {
  it('runs the legacy worker only when no vault exists and cipher support is missing', () => {
    expect(
      decideStandaloneBoot({ vaultExists: false, cipherSupport: false })
    ).toEqual({ action: 'legacy' });
  });

  it('exits when a vault already exists, even without cipher support', () => {
    expect(
      decideStandaloneBoot({ vaultExists: true, cipherSupport: false })
    ).toEqual({ action: 'exit', reason: 'vault-exists' });
    expect(
      decideStandaloneBoot({ vaultExists: true, cipherSupport: true })
    ).toEqual({ action: 'exit', reason: 'vault-exists' });
  });

  it('exits before setup on a vault-capable install', () => {
    expect(
      decideStandaloneBoot({ vaultExists: false, cipherSupport: true })
    ).toEqual({ action: 'exit', reason: 'vault-capable' });
  });
});
