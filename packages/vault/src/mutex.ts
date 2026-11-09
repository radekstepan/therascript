// packages/vault/src/mutex.ts
//
// Serializes vault transitions (setup, unlock, lock, restore, upgrade) so
// two of them can never interleave inside one process. Callers that must
// fail fast (HTTP handlers) pass `{ ifBusy: 'throw' }` and translate the
// resulting VaultBusyError into a 409.
import { VaultBusyError } from './errors.js';

let tail: Promise<void> = Promise.resolve();
let active = false;
/**
 * Holders + queued waiters. Incremented synchronously on entry (before
 * the first await) so a second `ifBusy: 'throw'` caller always observes
 * the first, even if the first has not resumed from its queue wait yet.
 */
let queued = 0;

export function isVaultTransitionActive(): boolean {
  return active || queued > 0;
}

export interface ExclusiveTransitionOptions {
  ifBusy?: 'queue' | 'throw';
}

export async function withExclusiveVaultTransition<T>(
  fn: () => Promise<T>,
  options: ExclusiveTransitionOptions = {}
): Promise<T> {
  if (options.ifBusy === 'throw' && (active || queued > 0)) {
    throw new VaultBusyError();
  }
  queued += 1;
  const previous = tail;
  let release: () => void = () => {};
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    active = true;
    try {
      return await fn();
    } finally {
      active = false;
    }
  } finally {
    queued -= 1;
    release();
  }
}
