// @vitest-environment node
// packages/vault/src/mutex.test.ts
import { describe, it, expect } from 'vitest';
import {
  withExclusiveVaultTransition,
  isVaultTransitionActive,
} from './mutex.js';
import { VaultBusyError } from './errors.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('withExclusiveVaultTransition', () => {
  it('serializes concurrent transitions', async () => {
    const order: string[] = [];
    const slow = withExclusiveVaultTransition(async () => {
      order.push('slow-start');
      expect(isVaultTransitionActive()).toBe(true);
      await tick();
      await tick();
      order.push('slow-end');
      return 'slow';
    });
    const fast = withExclusiveVaultTransition(async () => {
      order.push('fast');
      return 'fast';
    });
    await expect(Promise.all([slow, fast])).resolves.toEqual(['slow', 'fast']);
    expect(order).toEqual(['slow-start', 'slow-end', 'fast']);
    expect(isVaultTransitionActive()).toBe(false);
  });

  it('releases the lock when the transition throws', async () => {
    await expect(
      withExclusiveVaultTransition(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(isVaultTransitionActive()).toBe(false);
    await expect(withExclusiveVaultTransition(async () => 'ok')).resolves.toBe(
      'ok'
    );
  });

  it('fails fast with ifBusy: throw', async () => {
    const holder = withExclusiveVaultTransition(async () => {
      await tick();
      await tick();
      return 'held';
    });
    await tick();
    await expect(
      withExclusiveVaultTransition(async () => 'nope', { ifBusy: 'throw' })
    ).rejects.toBeInstanceOf(VaultBusyError);
    await expect(holder).resolves.toBe('held');
  });

  it('fails fast even before the first transition resumes', async () => {
    // Back-to-back synchronous entries: the second must observe the
    // first's queue slot, not slip in while the first awaits the chain.
    const first = withExclusiveVaultTransition(async () => {
      await tick();
      return 'first';
    });
    await expect(
      withExclusiveVaultTransition(async () => 'nope', { ifBusy: 'throw' })
    ).rejects.toBeInstanceOf(VaultBusyError);
    await expect(first).resolves.toBe('first');
    expect(isVaultTransitionActive()).toBe(false);
  });
});
