// packages/vault/src/errors.ts
//
// Vault error taxonomy. Auth failures (wrong password / bad tag) are
// distinct from format failures (corrupt envelope, truncation) so callers
// can map them to 401 vs 400/500 without inspecting messages.

export class VaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The vault database is not attached (locked) or no session is active. */
export class VaultLockedError extends VaultError {
  constructor(message = 'Vault is locked') {
    super('vault_locked', message);
  }
}

/** Wrong password, bad authentication tag, or tampered ciphertext. */
export class VaultAuthError extends VaultError {
  constructor(message = 'Vault authentication failed') {
    super('vault_auth_failed', message);
  }
}

/** Corrupt envelope, unknown version, truncated stream, invalid layout. */
export class VaultFormatError extends VaultError {
  constructor(message: string) {
    super('vault_format', message);
  }
}

/** Illegal lifecycle transition (double unlock, lock while locked, ...). */
export class VaultStateError extends VaultError {
  constructor(message: string) {
    super('vault_state', message);
  }
}

/** A vault transition (setup/unlock/lock/restore) is already running. */
export class VaultBusyError extends VaultError {
  constructor(message = 'A vault transition is already in progress') {
    super('vault_busy', message);
  }
}
