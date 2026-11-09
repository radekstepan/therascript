#!/usr/bin/env node
// scripts/upgrade-db.js

/**
 * This script explicitly checks and upgrades the application database to the latest schema version.
 * It connects to the database specified in your .env file, which triggers the built-in
 * migration logic in the @therascript/db package.
 * It then verifies that the database version matches the latest version expected by the code.
 */

import { db } from '@therascript/db';
import { LATEST_SCHEMA_VERSION } from '@therascript/db/dist/sqliteService.js';
import config from '../packages/config/dist/index.js';
import { openDatabaseForScript } from './vaultCli.mjs';

async function main() {
  console.log('--- Database Upgrade Check ---');
  console.log(`Code expects database schema version: ${LATEST_SCHEMA_VERSION}`);

  let handle = null;
  try {
    // 1. Open the vault (password via THERASCRIPT_VAULT_PASSWORD[(_FD)] or
    // TTY prompt) or the legacy database. Opening runs migrations.
    handle = await openDatabaseForScript();
    console.log(`\nOpened ${handle.mode} database; migrations ran on open.`);

    // 2. Explicitly verify the final version after migrations have run.
    const finalVersion = db.pragma('user_version', { simple: true });

    console.log(`\n--- Verification ---`);
    console.log(`Database schema version is now: ${finalVersion}`);

    if (finalVersion >= LATEST_SCHEMA_VERSION) {
      console.log('✅ Success! Your database schema is up-to-date.');
    } else {
      throw new Error(
        `Upgrade failed. Expected version ${LATEST_SCHEMA_VERSION} but got ${finalVersion}.`
      );
    }
  } catch (error) {
    console.error(
      '\n❌ An error occurred during the database upgrade process:'
    );
    console.error(error.message);
    process.exit(1);
  } finally {
    // 3. Ensure the database connection is closed and keys are cleared.
    console.log('Closing database connection.');
    handle?.close();
  }
}

main();
