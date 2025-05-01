// packages/api/src/db/sqliteService.ts
import crypto from 'node:crypto'; // <-- Import crypto
import Database, {
  type Database as DB,
  type Statement,
  type RunResult,
} from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

const isDev = !config.server.isProduction;
const dbFilePath = config.db.sqlitePath;
const dbDir = path.dirname(dbFilePath);
const SCHEMA_HASH_KEY = 'schema_md5'; // <-- Key for storing the hash

// --- Ensure Directory Exists ---
if (!fs.existsSync(dbDir)) {
  console.log(`[db]: Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

// --- Schema Definition (Updated with FTS Table and Triggers) ---
// *** ADDED 'export' ***
export const schema = `
    -- Sessions Table (Removed transcriptPath)
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        date TEXT NOT NULL, -- ISO 8601 timestamp string
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        whisperJobId TEXT NULL,
        audioPath TEXT NULL, -- Added column for the path/identifier to the original audio file
        transcriptTokenCount INTEGER NULL -- Added column for transcript token count
    );

    -- Transcript Paragraphs Table Definition
    CREATE TABLE IF NOT EXISTS transcript_paragraphs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NOT NULL,
        paragraphIndex INTEGER NOT NULL, -- Order of the paragraph within the session transcript
        timestampMs INTEGER NOT NULL, -- Original timestamp in milliseconds from Whisper
        text TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE -- Delete paragraphs when session is deleted
    );
    CREATE INDEX IF NOT EXISTS idx_paragraph_session ON transcript_paragraphs (sessionId);
    CREATE INDEX IF NOT EXISTS idx_paragraph_session_index ON transcript_paragraphs (sessionId, paragraphIndex); -- For fetching in order

    -- Chats Table (sessionId is now NULLABLE)
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NULL, -- Session ID is optional for standalone chats
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
        name TEXT,
        tags TEXT NULL, -- Added tags column
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp); -- Added index for chat sorting

    -- Messages Table (Updated with Starred Fields)
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
        promptTokens INTEGER,
        completionTokens INTEGER,
        starred INTEGER DEFAULT 0, -- 0 = false, 1 = true
        starredName TEXT NULL,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);
    -- Optional index for starred messages if performance becomes an issue
    -- CREATE INDEX IF NOT EXISTS idx_message_starred ON messages (starred);

    -- Messages FTS5 Table
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, -- Column in FTS table to store the text
        content='messages', -- Link to original table 'messages'
        content_rowid='id', -- Link FTS rowid to the original 'id' column
        tokenize='porter unicode61' -- Use Porter stemmer with Unicode support
    );

    -- Triggers to keep messages_fts synchronized
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.text);
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.text);
    END;

    -- *** ADDED: Transcript Paragraphs FTS5 Table ***
    CREATE VIRTUAL TABLE IF NOT EXISTS transcript_paragraphs_fts USING fts5(
        content, -- Column in FTS table to store the text
        content='transcript_paragraphs', -- Link to original table
        content_rowid='id', -- Link FTS rowid to the original 'id' column
        tokenize='porter unicode61' -- Use Porter stemmer with Unicode support
    );

    -- *** ADDED: Triggers to keep transcript_paragraphs_fts synchronized ***
    CREATE TRIGGER IF NOT EXISTS transcript_paragraphs_ai AFTER INSERT ON transcript_paragraphs BEGIN
        INSERT INTO transcript_paragraphs_fts (rowid, content) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS transcript_paragraphs_ad AFTER DELETE ON transcript_paragraphs BEGIN
        INSERT INTO transcript_paragraphs_fts (transcript_paragraphs_fts, rowid, content) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS transcript_paragraphs_au AFTER UPDATE ON transcript_paragraphs BEGIN
        INSERT INTO transcript_paragraphs_fts (transcript_paragraphs_fts, rowid, content) VALUES ('delete', old.id, old.text);
        INSERT INTO transcript_paragraphs_fts (rowid, content) VALUES (new.id, new.text);
    END;
    -- *** END FTS Additions ***

    -- Schema Metadata Table (New)
    CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`;

// --- Database Instance ---
let db: DB;

// --- Close Function ---
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

// --- Helper Function: Calculate MD5 Hash ---
// *** ADDED 'export' ***
export function calculateSchemaHash(schemaString: string): string {
  return crypto.createHash('md5').update(schemaString).digest('hex');
}

// --- Helper Function: Verify Schema Version ---
// *** ADDED 'export' ***
export function verifySchemaVersion(
  dbInstance: DB,
  currentSchemaDefinition: string
) {
  console.log('[db Schema Check]: Verifying schema version...');
  const currentSchemaHash = calculateSchemaHash(currentSchemaDefinition); // Use exported hash function
  console.log(
    `[db Schema Check]: Current schema definition hash: ${currentSchemaHash}`
  );

  let storedSchemaHash: string | undefined;
  try {
    // Ensure schema_metadata table exists before querying it
    dbInstance.exec(`
            CREATE TABLE IF NOT EXISTS schema_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    const row = dbInstance
      .prepare('SELECT value FROM schema_metadata WHERE key = ?')
      .get(SCHEMA_HASH_KEY) as { value: string } | undefined;
    storedSchemaHash = row?.value;
  } catch (error) {
    console.warn(
      `[db Schema Check]: Could not read stored schema hash (Table might not exist yet?):`,
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
        '  > The schema defined in sqliteService.ts has changed since the'
      );
      console.error('  > database file was last initialized or verified.');
      console.error('  > To resolve:');
      console.error(
        '  >   1. Ensure all intended schema changes are in sqliteService.ts.'
      );
      console.error(`  >   2. Backup your database file (${dbFilePath}).`);
      console.error(
        '  >   3. Delete the database file to allow re-initialization with the new schema,'
      );
      console.error('  >      OR implement a proper migration strategy.');
      console.error(
        '---------------------------------------------------------------------'
      );
      closeDb(); // Use local closeDb
      process.exit(1);
    }
  } else {
    console.log(
      '[db Schema Check]: No stored schema hash found. Assuming first run or new database.'
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
      closeDb(); // Use local closeDb
      process.exit(1);
    }
  }
}

// --- Initialize Function Definition (Updated for new columns and FTS) ---
// *** ADDED 'export' ***
export function initializeDatabase(dbInstance: DB) {
  console.log('[db Init Func]: Attempting to initialize schema...'); // Log entry
  try {
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('foreign_keys = ON');
    console.log('[db Init Func]: WAL mode and foreign keys enabled.');

    // Execute the main schema (which includes FTS tables and triggers now)
    dbInstance.exec(schema);
    console.log('[db Init Func]: Main database schema exec command executed.');

    // --- Migrations (keep existing ones, remove transcriptPath migration) ---
    // These are less critical for preload (which deletes DB) but vital for running API against existing DB
    const sessionColumns = dbInstance.pragma('table_info(sessions)') as {
      name: string;
      type: string;
    }[];
    const chatColumns = dbInstance.pragma('table_info(chats)') as {
      name: string;
      type: string;
    }[];
    const messageColumns = dbInstance.pragma('table_info(messages)') as {
      name: string;
      type: string;
    }[];

    // Session Table Migrations
    if (!sessionColumns.some((col) => col.name === 'status')) {
      console.log('[db Mig]: Adding "status"...');
      dbInstance.exec(
        "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
      );
    }
    if (!sessionColumns.some((col) => col.name === 'whisperJobId')) {
      console.log('[db Mig]: Adding "whisperJobId"...');
      dbInstance.exec('ALTER TABLE sessions ADD COLUMN whisperJobId TEXT NULL');
    }
    if (!sessionColumns.some((col) => col.name === 'audioPath')) {
      console.log('[db Mig]: Adding "audioPath"...');
      dbInstance.exec('ALTER TABLE sessions ADD COLUMN audioPath TEXT NULL');
    }
    if (!sessionColumns.some((col) => col.name === 'transcriptTokenCount')) {
      console.log('[db Mig]: Adding "transcriptTokenCount"...');
      dbInstance.exec(
        'ALTER TABLE sessions ADD COLUMN transcriptTokenCount INTEGER NULL'
      );
    }
    // Remove migration for transcriptPath if it exists (handled by schema change)
    if (sessionColumns.some((col) => col.name === 'transcriptPath')) {
      console.warn(
        '[db Mig]: "transcriptPath" column found on sessions table. It is no longer used. Consider dropping manually.'
      );
    }

    const dateColumn = sessionColumns.find((col) => col.name === 'date');
    if (dateColumn && dateColumn.type.toUpperCase() !== 'TEXT') {
      console.warn(`[db Mig]: 'date' column type mismatch...`);
    }

    // Chat Table Migrations
    if (!chatColumns.some((col) => col.name === 'tags')) {
      console.log('[db Mig]: Adding "tags" to chats...');
      dbInstance.exec('ALTER TABLE chats ADD COLUMN tags TEXT NULL');
    } // Add tags if missing
    const chatIndexes = dbInstance.pragma("index_list('chats')") as {
      name: string;
    }[];
    if (!chatIndexes.some((idx) => idx.name === 'idx_chat_timestamp')) {
      console.log('[db Mig]: Adding chat timestamp index...');
      dbInstance.exec(
        'CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);'
      );
    }

    // Message Table Migrations
    if (!messageColumns.some((col) => col.name === 'promptTokens')) {
      console.log('[db Mig]: Adding "promptTokens" to messages...');
      dbInstance.exec(
        'ALTER TABLE messages ADD COLUMN promptTokens INTEGER NULL'
      );
    }
    if (!messageColumns.some((col) => col.name === 'completionTokens')) {
      console.log('[db Mig]: Adding "completionTokens" to messages...');
      dbInstance.exec(
        'ALTER TABLE messages ADD COLUMN completionTokens INTEGER NULL'
      );
    }
    if (!messageColumns.some((col) => col.name === 'starred')) {
      console.log('[db Mig]: Adding "starred" to messages...');
      dbInstance.exec(
        'ALTER TABLE messages ADD COLUMN starred INTEGER DEFAULT 0'
      );
    }
    if (!messageColumns.some((col) => col.name === 'starredName')) {
      console.log('[db Mig]: Adding "starredName" to messages...');
      dbInstance.exec('ALTER TABLE messages ADD COLUMN starredName TEXT NULL');
    }

    // Message Timestamp Index
    const messageIndexes = dbInstance.pragma("index_list('messages')") as {
      name: string;
    }[];
    if (!messageIndexes.some((idx) => idx.name === 'idx_message_timestamp')) {
      console.log('[db Mig]: Adding message timestamp index...');
      dbInstance.exec(
        'CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);'
      );
    }
    // --- End Migrations ---

    // --- Verify Schema Version (AFTER schema exec and migrations) ---
    verifySchemaVersion(dbInstance, schema); // Use the local schema constant
  } catch (error) {
    console.error('[db Init Func]: Error initializing database:', error);
    if (dbInstance && dbInstance.open) {
      try {
        dbInstance.close();
      } catch (closeErr) {
        console.error('Error closing DB instance after init error:', closeErr);
      }
    }
    throw error;
  }
}

// --- Database Connection and Initialization (for main app) ---
console.log(`[db]: Initializing SQLite database connection for: ${dbFilePath}`);
try {
  db = new Database(dbFilePath, {
    verbose: isDev ? console.log : undefined,
  });
  console.log(`[db]: Successfully connected to database: ${dbFilePath}`);
  initializeDatabase(db); // Call the initialization logic
} catch (err) {
  console.error(
    `[db]: FATAL: Could not connect or initialize database at ${dbFilePath}:`,
    (err as Error).message
  );
  process.exit(1);
}

// --- Prepared Statements Cache ---
const statementCache = new Map<string, Statement>();

// --- Make prepare function available internally, but also exported helpers ---
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

// --- Synchronous Helper Functions (Exported) ---
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
function transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
  return db.transaction(fn);
}

// --- Health Check (Exported) ---
export const checkDatabaseHealth = (): void => {
  db.pragma('quick_check');
};

// --- Process Event Listeners ---
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

// Export the main instance and helpers
export { db, run, get, all, exec, transaction, closeDb }; // Exclude initializeDatabase, schema, verifySchemaVersion from direct export if they are only meant for internal use and preload
