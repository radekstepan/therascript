#!/usr/bin/env node
// scripts/vaultCli.mjs
//
// Shared vault open/close for maintenance scripts: the same
// vault operations as the server (read CURRENT, unwrap keys, open +
// migrate + attach), with the password from THERASCRIPT_VAULT_PASSWORD,
// THERASCRIPT_VAULT_PASSWORD_FD, or a secure TTY prompt — never argv.
import {
  configureDb,
  openVaultDb,
  attachUnlockedDb,
  initializeDatabase,
  closeDb,
} from '@therascript/db';
import {
  readCurrentGenerationId,
  getActiveGeneration,
  readKeysEnvelope,
  unwrapVaultKeys,
  clearVaultKeys,
  readPasswordFromEnvOrFd,
  promptForPassword,
} from '@therascript/vault';
import config from '../packages/config/dist/index.js';

export async function openDatabaseForScript() {
  const activeId = await readCurrentGenerationId(config.vault.dir).catch(
    () => null
  );
  if (!activeId) {
    configureDb({
      dbPath: config.db.sqlitePath,
      isDev: config.server.nodeEnv !== 'production',
      mode: 'legacy-plaintext',
    });
    return {
      mode: 'legacy',
      close: () => closeDb(),
    };
  }

  let password = readPasswordFromEnvOrFd();
  if (!password && process.stdin.isTTY) {
    password = await promptForPassword();
  }
  if (!password) {
    throw new Error(
      'A vault exists but no password was supplied. Set ' +
        'THERASCRIPT_VAULT_PASSWORD (or THERASCRIPT_VAULT_PASSWORD_FD), ' +
        'or run interactively.'
    );
  }
  const active = await getActiveGeneration(config.vault.dir);
  const envelope = await readKeysEnvelope(active.keysPath);
  const keys = await unwrapVaultKeys(envelope, password);
  configureDb({ dbPath: active.dbPath, isDev: false });
  const connection = openVaultDb(active.dbPath, keys.database);
  try {
    initializeDatabase(connection);
    attachUnlockedDb(connection);
  } catch (error) {
    try {
      connection.close();
    } catch {
      // ignore
    }
    clearVaultKeys(keys);
    throw error;
  }
  return {
    mode: 'vault',
    generation: active,
    close: () => {
      closeDb();
      clearVaultKeys(keys);
    },
  };
}

export async function vaultExistsForScript() {
  return (
    (await readCurrentGenerationId(config.vault.dir).catch(() => null)) !==
    null
  );
}
