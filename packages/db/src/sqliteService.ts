// packages/db/src/sqliteService.ts
import crypto from 'node:crypto';
import Database, {
  type Database as DB,
  type Statement,
  type RunResult,
  type Transaction,
} from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { getConfig } from './config.js';
import type { DbRunResult, DbStatement } from './types.js';

// MODIFIED: We will no longer hash this entire block.
// It now represents the initial state of the database schema (Version 1).
export const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        date TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        whisperJobId TEXT NULL,
        audioPath TEXT NULL,
        transcriptTokenCount INTEGER NULL
    );

    -- Transcript Paragraphs Table Definition
    CREATE TABLE IF NOT EXISTS transcript_paragraphs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NOT NULL,
        paragraphIndex INTEGER NOT NULL,
        timestampMs INTEGER NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_paragraph_session ON transcript_paragraphs (sessionId);
    CREATE INDEX IF NOT EXISTS idx_paragraph_session_index ON transcript_paragraphs (sessionId, paragraphIndex);

    -- Chats Table
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NULL,
        timestamp INTEGER NOT NULL,
        name TEXT,
        tags TEXT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);

    -- Messages Table
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        promptTokens INTEGER,
        completionTokens INTEGER,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);

    -- Templates Table
    CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_template_created_at ON templates (createdAt);

    -- REMOVED: schema_metadata table creation is now handled by the migration logic
`;

// --- NEW MIGRATION LOGIC ---
export const LATEST_SCHEMA_VERSION = 4;

function runMigrations(dbInstance: DB) {
  // FIX: With { simple: true }, the pragma returns the value directly as a number.
  let currentVersion = dbInstance.pragma('user_version', {
    simple: true,
  }) as number;

  console.log(
    `[db Migrator] Database schema version: ${currentVersion}. Latest version: ${LATEST_SCHEMA_VERSION}.`
  );

  if (currentVersion < LATEST_SCHEMA_VERSION) {
    console.log(
      `[db Migrator] New schema version detected. Running migrations...`
    );
    dbInstance.transaction(() => {
      // Version 1: The initial schema
      if (currentVersion < 1) {
        console.log('[db Migrator] Applying version 1...');
        // The initial `db.exec(schema)` will handle creating the base tables.
        // We ensure all base tables exist here.
        dbInstance.exec(schema);
        // The old logic for adding transcriptTokenCount can be considered part of V1
        const sessionColumns = dbInstance.pragma('table_info(sessions)') as {
          name: string;
          type: string;
        }[];
        if (
          !sessionColumns.some((col) => col.name === 'transcriptTokenCount')
        ) {
          console.log(
            '[db Migrator V1] Adding "transcriptTokenCount" to sessions...'
          );
          dbInstance.exec(
            'ALTER TABLE sessions ADD COLUMN transcriptTokenCount INTEGER NULL'
          );
        }
        dbInstance.pragma(`user_version = 1`);
        currentVersion = 1;
        console.log('[db Migrator] Version 1 applied.');
      }

      // Version 2: Add analysis-related tables
      if (currentVersion < 2) {
        console.log('[db Migrator] Applying version 2...');
        dbInstance.exec(`
          -- Analysis Jobs Table
          CREATE TABLE IF NOT EXISTS analysis_jobs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              original_prompt TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending', -- e.g., pending, mapping, reducing, completed, failed
              final_result TEXT,
              error_message TEXT,
              created_at INTEGER NOT NULL,
              completed_at INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs (status);
          CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON analysis_jobs (created_at);

          -- Join table for Analysis Jobs and Sessions
          CREATE TABLE IF NOT EXISTS analysis_job_sessions (
              analysis_job_id INTEGER NOT NULL,
              session_id INTEGER NOT NULL,
              PRIMARY KEY (analysis_job_id, session_id),
              FOREIGN KEY (analysis_job_id) REFERENCES analysis_jobs (id) ON DELETE CASCADE,
              FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
          );

          -- Intermediate Summaries from the "Map" step
          CREATE TABLE IF NOT EXISTS intermediate_summaries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              analysis_job_id INTEGER NOT NULL,
              session_id INTEGER NOT NULL,
              summary_text TEXT,
              status TEXT NOT NULL DEFAULT 'pending', -- e.g., pending, processing, completed, failed
              error_message TEXT,
              FOREIGN KEY (analysis_job_id) REFERENCES analysis_jobs (id) ON DELETE CASCADE,
              FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_intermediate_summaries_job_id ON intermediate_summaries (analysis_job_id);
        `);
        dbInstance.pragma(`user_version = 2`);
        currentVersion = 2;
        console.log('[db Migrator] Version 2 applied.');
      }

      // Version 3: Add model and context size to analysis jobs
      if (currentVersion < 3) {
        console.log('[db Migrator] Applying version 3...');
        dbInstance.exec('ALTER TABLE analysis_jobs ADD COLUMN model_name TEXT');
        dbInstance.exec(
          'ALTER TABLE analysis_jobs ADD COLUMN context_size INTEGER'
        );
        dbInstance.pragma('user_version = 3');
        currentVersion = 3;
        console.log('[db Migrator] Version 3 applied.');
      }

      // Version 4: Add short_prompt to analysis_jobs
      if (currentVersion < 4) {
        console.log('[db Migrator] Applying version 4...');
        dbInstance.exec(
          "ALTER TABLE analysis_jobs ADD COLUMN short_prompt TEXT NOT NULL DEFAULT 'Analysis Job'"
        );
        dbInstance.pragma('user_version = 4');
        currentVersion = 4;
        console.log('[db Migrator] Version 4 applied.');
      }
    })();
    console.log(
      `[db Migrator] Migrations complete. Database is now at version ${currentVersion}.`
    );
  } else {
    console.log('[db Migrator] Database schema is up to date.');
  }
}
// --- END NEW MIGRATION LOGIC ---

let dbInstance: DB | null = null;
// REMOVED: const SCHEMA_HASH_KEY = 'schema_md5_v2';

const getDb = (): DB => {
  if (dbInstance === null) {
    const { dbPath, isDev } = getConfig();
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      console.log(`[db]: Creating database directory: ${dbDir}`);
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.log(`[db]: Initializing SQLite database connection for: ${dbPath}`);
    try {
      dbInstance = new Database(dbPath, {
        verbose: isDev ? console.log : undefined,
      });
      console.log(`[db]: Successfully connected to database: ${dbPath}`);
      initializeDatabase(dbInstance);
    } catch (err) {
      console.error(
        `[db]: FATAL: Could not connect or initialize database at ${dbPath}:`,
        (err as Error).message
      );
      process.exit(1);
    }
  }
  return dbInstance;
};

const dbProxyHandler: ProxyHandler<DB> = {
  get(target, prop, receiver) {
    const db = getDb();
    const value = Reflect.get(db, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(db);
    }
    return value;
  },
};

export const db: DB = new Proxy({} as DB, dbProxyHandler);

export function closeDb(): void {
  if (dbInstance && dbInstance.open) {
    console.log('[db]: Closing database connection...');
    try {
      dbInstance.close();
      console.log('[db]: Database connection closed.');
      dbInstance = null; // Important to reset
    } catch (error) {
      console.error('[db]: Error closing the database connection:', error);
    }
  }
}

// REMOVED: calculateSchemaHash and verifySchemaVersion functions
// export function calculateSchemaHash(...) { ... }
// export function verifySchemaVersion(...) { ... }

// MODIFIED: initializeDatabase now runs migrations instead of hash check
export function initializeDatabase(dbInstance: DB) {
  console.log('[db Init Func]: Attempting to initialize schema...');
  try {
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('foreign_keys = ON');
    console.log('[db Init Func]: WAL mode and foreign keys enabled.');

    // Run the migration logic
    runMigrations(dbInstance);

    // This part is now handled inside the migration, but we can keep the warning.
    const sessionColumns = dbInstance.pragma('table_info(sessions)') as {
      name: string;
      type: string;
    }[];
    if (sessionColumns.some((col) => col.name === 'transcriptPath')) {
      console.warn(
        '[db Mig]: "transcriptPath" column found on sessions table. It is no longer used and can be manually dropped.'
      );
    }
  } catch (error) {
    console.error('[db Init Func]: Error initializing database:', error);
    if (dbInstance && dbInstance.open) {
      try {
        dbInstance.close();
      } catch (closeErr) {
        console.error('Error closing DB after init error:', closeErr);
      }
    }
    throw error;
  }
}

const statementCache = new Map<string, DbStatement>();
function prepare(sql: string): DbStatement {
  const db = getDb();
  let stmt = statementCache.get(sql);
  if (!stmt) {
    try {
      stmt = db.prepare(sql);
      statementCache.set(sql, stmt);
    } catch (error) {
      console.error(`[db] Error preparing statement: ${sql}`, error);
      throw error;
    }
  }
  return stmt;
}

export function run(sql: string, ...params: any[]): DbRunResult {
  return prepare(sql).run(...params);
}
export function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return prepare(sql).get(...params) as T | undefined;
}
export function all<T = any>(sql: string, ...params: any[]): T[] {
  return prepare(sql).all(...params) as T[];
}
export function exec(sql: string): void {
  getDb().exec(sql);
}
export function transaction<F extends (...args: any[]) => any>(
  fn: F
): Transaction<F> {
  return getDb().transaction(fn);
}

export const checkDatabaseHealth = (): void => {
  getDb().pragma('quick_check');
};
process.on('exit', closeDb);
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));
process.on('uncaughtException', (err) => {
  console.error('[db]: Uncaught Exception:', err);
  closeDb();
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[db]: Unhandled Rejection at:', promise, 'reason:', reason);
  closeDb();
  process.exit(1);
});
