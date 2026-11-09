// packages/worker/src/standaloneBoot.ts
//
// Boot policy for a worker started without the API's supervised vault pipe.
//
// The API supervises its own worker whenever vault mode is available: it
// sends the data keys over an inherited pipe and only spawns the worker
// after setup/unlock. In that setup a second, independently started worker
// must not open the legacy plaintext database (it could race the vault
// migration or keep an unlinked database open). It has nothing to do, so it
// exits cleanly instead of failing the surrounding dev/prod process group.

export type StandaloneBootDecision =
  | { action: 'legacy' }
  | { action: 'exit'; reason: 'vault-exists' | 'vault-capable' };

export function decideStandaloneBoot(input: {
  vaultExists: boolean;
  cipherSupport: boolean;
}): StandaloneBootDecision {
  // A vault already exists: only the API can unlock it and hand keys to
  // the worker it supervises.
  if (input.vaultExists) {
    return { action: 'exit', reason: 'vault-exists' };
  }
  // No vault yet, but this install can create one. The API boots locked
  // and will supervise the worker after setup, so opening the legacy
  // database here would race that migration.
  if (input.cipherSupport) {
    return { action: 'exit', reason: 'vault-capable' };
  }
  return { action: 'legacy' };
}
