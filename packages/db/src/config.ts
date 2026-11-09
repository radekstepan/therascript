// packages/db/src/config.ts

/** How the global `db` handle opens its connection. */
export type DbOpenMode =
  /** Fail closed: `db` throws VaultLockedError until attachUnlockedDb(). */
  | 'vault'
  /** Pre-migration behavior: lazily open the plaintext file on first use. */
  | 'legacy-plaintext';

let dbPath: string | null = null;
let isDev: boolean = false;
let mode: DbOpenMode = 'vault';

interface DbConfig {
  dbPath: string;
  isDev: boolean;
  /**
   * Defaults to 'vault' (locked until explicitly attached). Pass
   * 'legacy-plaintext' only for pre-migration installs, maintenance
   * scripts, and tests that exercise the legacy open path.
   */
  mode?: DbOpenMode;
}

export function configureDb(config: DbConfig) {
  if (dbPath) {
    // This allows re-configuration, which can be useful in some testing scenarios
    // or for scripts like preloadDb that might run in the same process space.
    // console.warn('[db config] Database already configured. Re-configuring...');
  }
  dbPath = config.dbPath;
  isDev = config.isDev;
  mode = config.mode ?? 'vault';
}

export const getConfig = (): {
  dbPath: string;
  isDev: boolean;
  mode: DbOpenMode;
} => {
  if (!dbPath) {
    throw new Error(
      'Database has not been configured. Call configureDb() from the main application entry point.'
    );
  }
  return { dbPath, isDev, mode };
};
