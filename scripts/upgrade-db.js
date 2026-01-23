#!/usr/bin/env node
// scripts/upgrade-db.js

/**
 * This script explicitly checks and upgrades the application database to the latest schema version.
 * It connects to the database specified in your .env file, which triggers the built-in
 * migration logic in the @therascript/db package.
 * It then verifies that the database version matches the latest version expected by the code.
 */

import { configureDb, db, closeDb } from '@therascript/db';
import { LATEST_SCHEMA_VERSION } from '@therascript/db/dist/sqliteService.js';
import config from '../packages/config/dist/index.js';

async function main() {
  console.log('--- Database Upgrade Check ---');
  console.log(`Target database file: ${config.db.sqlitePath}`);
  console.log(`Code expects database schema version: ${LATEST_SCHEMA_VERSION}`);

  try {
    // 1. Configure the database using the path from your .env file.
    // This is a crucial first step.
    configureDb({
      dbPath: config.db.sqlitePath,
      isDev: config.server.nodeEnv !== 'production',
    });

    // 2. Access the 'db' object. The first time it's accessed, it automatically
    // runs the `initializeDatabase` function, which in turn calls `runMigrations`.
    // The migration logs ("Applying version X...") will be printed here.
    console.log('\nConnecting to the database to trigger migration check...');
    const dbInstance = db;

    // 3. Explicitly verify the final version after migrations have run.
    const finalVersion = dbInstance.pragma('user_version', { simple: true });

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
    // 4. Ensure the database connection is closed.
    console.log('Closing database connection.');
    closeDb();
  }
}

main();
