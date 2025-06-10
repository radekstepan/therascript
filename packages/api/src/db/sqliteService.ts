// packages/api/src/db/sqliteService.ts
import crypto from 'node:crypto';
import Database, {
  type Database as DB,
  type Statement,
  type RunResult,
  type Transaction, // Import Transaction type
} from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

const isDev = !config.server.isProduction;
const dbFilePath = config.db.sqlitePath;
const dbDir = path.dirname(dbFilePath);
const SCHEMA_HASH_KEY = 'schema_md5_v2';

if (!fs.existsSync(dbDir)) {
  console.log(`[db]: Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

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
        starred INTEGER DEFAULT 0,
        starredName TEXT NULL,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);

    CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`;

let db: DB;

const closeDb = (): void => {
  if (db && db.open) {
    console.log('[db]: Closing database connection...');
    try {
      db.close();
      console.log('[db]: Database connection closed.');
    } catch (error) {
      console.error('[db]: Error closing the database connection:', error);
    }
  }
};

export function calculateSchemaHash(schemaString: string): string {
  return crypto.createHash('md5').update(schemaString).digest('hex');
}

export function verifySchemaVersion(
  dbInstance: DB,
  currentSchemaDefinition: string
) {
  console.log('[db Schema Check]: Verifying schema version...');
  const currentSchemaHash = calculateSchemaHash(currentSchemaDefinition);
  console.log(
    `[db Schema Check]: Current schema definition hash: ${currentSchemaHash}`
  );
  let storedSchemaHash: string | undefined;
  try {
    dbInstance.exec(
      `CREATE TABLE IF NOT EXISTS schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
    );
    const row = dbInstance
      .prepare('SELECT value FROM schema_metadata WHERE key = ?')
      .get(SCHEMA_HASH_KEY) as { value: string } | undefined;
    storedSchemaHash = row?.value;
  } catch (error) {
    console.warn(
      `[db Schema Check]: Could not read stored schema hash:`,
      error
    );
    storedSchemaHash = undefined;
  }

  if (storedSchemaHash) {
    console.log(
      `[db Schema Check]: Stored schema hash found: ${storedSchemaHash}`
    );
    if (currentSchemaHash === storedSchemaHash) {
      console.log('[db Schema Check]: Schema version matches stored hash. OK.');
    } else {
      console.error(
        '---------------------------------------------------------------------'
      );
      console.error(
        '[db Schema Check]: FATAL ERROR: Schema definition mismatch!'
      );
      console.error(`  > Current schema hash in code : ${currentSchemaHash}`);
      console.error(`  > Stored schema hash in DB    : ${storedSchemaHash}`);
      console.error(
        '  > To resolve, backup your DB and delete it to allow re-initialization, OR implement a proper migration strategy.'
      );
      console.error(
        '---------------------------------------------------------------------'
      );
      closeDb();
      process.exit(1);
    }
  } else {
    console.log(
      '[db Schema Check]: No stored schema hash found. Assuming first run.'
    );
    try {
      dbInstance
        .prepare(
          'INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)'
        )
        .run(SCHEMA_HASH_KEY, currentSchemaHash);
      console.log(
        `[db Schema Check]: Stored current schema hash (${currentSchemaHash}) in database.`
      );
    } catch (insertError) {
      console.error(
        `[db Schema Check]: FATAL: Failed to store initial schema hash:`,
        insertError
      );
      closeDb();
      process.exit(1);
    }
  }
}

export function initializeDatabase(dbInstance: DB) {
  console.log('[db Init Func]: Attempting to initialize schema...');
  try {
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('foreign_keys = ON');
    console.log('[db Init Func]: WAL mode and foreign keys enabled.');
    dbInstance.exec(schema);
    console.log('[db Init Func]: Main database schema exec command executed.');
    const sessionColumns = dbInstance.pragma('table_info(sessions)') as {
      name: string;
      type: string;
    }[];
    if (!sessionColumns.some((col) => col.name === 'transcriptTokenCount')) {
      console.log('[db Mig]: Adding "transcriptTokenCount" to sessions...');
      dbInstance.exec(
        'ALTER TABLE sessions ADD COLUMN transcriptTokenCount INTEGER NULL'
      );
    }
    if (sessionColumns.some((col) => col.name === 'transcriptPath')) {
      console.warn(
        '[db Mig]: "transcriptPath" column found on sessions table. It is no longer used and can be manually dropped.'
      );
    }
    verifySchemaVersion(dbInstance, schema);
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

console.log(`[db]: Initializing SQLite database connection for: ${dbFilePath}`);
try {
  db = new Database(dbFilePath, { verbose: isDev ? console.log : undefined });
  console.log(`[db]: Successfully connected to database: ${dbFilePath}`);
  initializeDatabase(db);
} catch (err) {
  console.error(
    `[db]: FATAL: Could not connect or initialize database at ${dbFilePath}:`,
    (err as Error).message
  );
  process.exit(1);
}

const statementCache = new Map<string, Statement>();
function prepare(sql: string): Statement {
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

function run(sql: string, ...params: any[]): RunResult {
  return prepare(sql).run(params);
}
function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return prepare(sql).get(params) as T | undefined;
}
function all<T = any>(sql: string, ...params: any[]): T[] {
  return prepare(sql).all(params) as T[];
}
function exec(sql: string): void {
  db.exec(sql);
}
// Correctly type the transaction function
function transaction<F extends (...args: any[]) => any>(fn: F): Transaction<F> {
  return db.transaction(fn);
}

export const checkDatabaseHealth = (): void => {
  db.pragma('quick_check');
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
export { db, run, get, all, exec, transaction, closeDb };
