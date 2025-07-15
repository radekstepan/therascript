// packages/db/src/config.ts

let dbPath: string | null = null;
let isDev: boolean = false;

interface DbConfig {
  dbPath: string;
  isDev: boolean;
}

export function configureDb(config: DbConfig) {
  if (dbPath) {
    // This allows re-configuration, which can be useful in some testing scenarios
    // or for scripts like preloadDb that might run in the same process space.
    // console.warn('[db config] Database already configured. Re-configuring...');
  }
  dbPath = config.dbPath;
  isDev = config.isDev;
}

export const getConfig = (): { dbPath: string; isDev: boolean } => {
  if (!dbPath) {
    throw new Error(
      'Database has not been configured. Call configureDb() from the main application entry point.'
    );
  }
  return { dbPath, isDev };
};
