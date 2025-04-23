// File: packages/api/src/db/sqliteService.ts
import crypto from 'node:crypto'; // <-- Import crypto
import Database, { type Database as DB, type Statement, type RunResult } from 'better-sqlite3';
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

// --- Schema Definition (Updated) ---
// Defines tables and ensures cascading deletes using FOREIGN KEY constraints.
// Changed chats.sessionId to be NULLABLE for standalone chats.
const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        date TEXT NOT NULL, -- ISO 8601 timestamp string
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        transcriptPath TEXT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        whisperJobId TEXT NULL,
        audioPath TEXT NULL, -- Added column for the path/identifier to the original audio file
        transcriptTokenCount INTEGER NULL -- Added column for transcript token count
    );
    -- Chats Table (sessionId is now NULLABLE)
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NULL, -- Session ID is optional for standalone chats
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
        name TEXT,
        -- Ensures that deleting a session automatically deletes its associated session chats
        -- Standalone chats (sessionId IS NULL) are unaffected by session deletion.
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp); -- Added index for chat sorting

    -- Messages Table (Updated)
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
        promptTokens INTEGER,
        completionTokens INTEGER,
        -- Ensures that deleting a chat automatically deletes its associated messages
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);

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
function calculateSchemaHash(schemaString: string): string {
    return crypto.createHash('md5').update(schemaString).digest('hex');
}

// --- Helper Function: Verify Schema Version ---
function verifySchemaVersion(dbInstance: DB, currentSchemaDefinition: string) {
    console.log('[db Schema Check]: Verifying schema version...');
    const currentSchemaHash = calculateSchemaHash(currentSchemaDefinition);
    console.log(`[db Schema Check]: Current schema definition hash: ${currentSchemaHash}`);

    let storedSchemaHash: string | undefined;
    try {
        // Ensure schema_metadata table exists before querying it
        dbInstance.exec(`
            CREATE TABLE IF NOT EXISTS schema_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
        const row = dbInstance.prepare('SELECT value FROM schema_metadata WHERE key = ?').get(SCHEMA_HASH_KEY) as { value: string } | undefined;
        storedSchemaHash = row?.value;
    } catch (error) {
        console.warn(`[db Schema Check]: Could not read stored schema hash (Table might not exist yet?):`, error);
        storedSchemaHash = undefined;
    }

    if (storedSchemaHash) {
        console.log(`[db Schema Check]: Stored schema hash found: ${storedSchemaHash}`);
        if (currentSchemaHash === storedSchemaHash) {
            console.log('[db Schema Check]: Schema version matches stored hash. OK.');
        } else {
            console.error('---------------------------------------------------------------------');
            console.error('[db Schema Check]: FATAL ERROR: Schema definition mismatch!');
            console.error(`  > Current schema hash in code : ${currentSchemaHash}`);
            console.error(`  > Stored schema hash in DB    : ${storedSchemaHash}`);
            console.error('  > The schema defined in sqliteService.ts has changed since the');
            console.error('  > database file was last initialized or verified.');
            console.error('  > To resolve:');
            console.error('  >   1. Ensure all intended schema changes are in sqliteService.ts.');
            console.error(`  >   2. Backup your database file (${dbFilePath}).`);
            console.error('  >   3. Delete the database file to allow re-initialization with the new schema,');
            console.error('  >      OR implement a proper migration strategy.');
            console.error('---------------------------------------------------------------------');
            closeDb();
            process.exit(1);
        }
    } else {
        console.log('[db Schema Check]: No stored schema hash found. Assuming first run or new database.');
        try {
            dbInstance.prepare('INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)')
                      .run(SCHEMA_HASH_KEY, currentSchemaHash);
            console.log(`[db Schema Check]: Stored current schema hash (${currentSchemaHash}) in database.`);
        } catch (insertError) {
            console.error(`[db Schema Check]: FATAL: Failed to store initial schema hash:`, insertError);
            closeDb();
            process.exit(1);
        }
    }
}


// --- Initialize Function Definition (Updated for new columns) ---
function initializeDatabase(dbInstance: DB) {
    console.log('[db Init Func]: Attempting to initialize schema...'); // Log entry
    try {
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('busy_timeout = 5000');
        dbInstance.pragma('foreign_keys = ON');
        console.log('[db Init Func]: WAL mode and foreign keys enabled.');

        dbInstance.exec(schema);
        console.log('[db Init Func]: Database schema exec command executed.');

        const sessionColumns = dbInstance.pragma("table_info(sessions)") as { name: string; type: string; }[];
        const chatColumns = dbInstance.pragma("table_info(chats)") as { name: string; type: string; }[];
        const messageColumns = dbInstance.pragma("table_info(messages)") as { name: string; type: string; }[];

        // --- Session Table Migrations ---
        const hasStatus = sessionColumns.some((col) => col.name === 'status');
        const hasWhisperJobId = sessionColumns.some((col) => col.name === 'whisperJobId');
        const hasAudioPath = sessionColumns.some((col) => col.name === 'audioPath'); // Check for new column
        const hasTokenCount = sessionColumns.some((col) => col.name === 'transcriptTokenCount'); // <-- Check for token count

        if (!hasStatus) { console.log('[db Init Func Migration]: Adding "status" column...'); dbInstance.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); console.log('[db Init Func Migration]: "status" column added.'); }
        if (!hasWhisperJobId) { console.log('[db Init Func Migration]: Adding "whisperJobId" column...'); dbInstance.exec("ALTER TABLE sessions ADD COLUMN whisperJobId TEXT NULL"); console.log('[db Init Func Migration]: "whisperJobId" column added.'); }
        if (!hasAudioPath) { console.log('[db Init Func Migration]: Adding "audioPath" column...'); dbInstance.exec("ALTER TABLE sessions ADD COLUMN audioPath TEXT NULL"); console.log('[db Init Func Migration]: "audioPath" column added.'); }
        // *** ADD Migration for transcriptTokenCount ***
        if (!hasTokenCount) { console.log('[db Init Func Migration]: Adding "transcriptTokenCount" column...'); dbInstance.exec("ALTER TABLE sessions ADD COLUMN transcriptTokenCount INTEGER NULL"); console.log('[db Init Func Migration]: "transcriptTokenCount" column added.'); }
        // *** END Migration ***

        const dateColumn = sessionColumns.find(col => col.name === 'date');
        if (dateColumn && dateColumn.type.toUpperCase() !== 'TEXT') { console.warn(`[db Init Func Migration]: 'date' column type mismatch...`); }


        // --- Chat Table Migrations ---
        // No specific migration needed for making sessionId nullable if recreating DB
        const chatIndexes = dbInstance.pragma("index_list('chats')") as { name: string }[];
        if (!chatIndexes.some(idx => idx.name === 'idx_chat_timestamp')) { console.log('[db Init Func Migration]: Adding chat timestamp index...'); dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);"); console.log('[db Init Func Migration]: Chat timestamp index added.'); }

        // --- Message Table Migrations (Added Token Columns) ---
        const hasPromptTokens = messageColumns.some((col) => col.name === 'promptTokens');
        const hasCompletionTokens = messageColumns.some((col) => col.name === 'completionTokens');
        if (!hasPromptTokens) { console.log('[db Init Func Migration]: Adding "promptTokens" column to messages...'); dbInstance.exec("ALTER TABLE messages ADD COLUMN promptTokens INTEGER NULL"); console.log('[db Init Func Migration]: "promptTokens" column added.'); }
        if (!hasCompletionTokens) { console.log('[db Init Func Migration]: Adding "completionTokens" column to messages...'); dbInstance.exec("ALTER TABLE messages ADD COLUMN completionTokens INTEGER NULL"); console.log('[db Init Func Migration]: "completionTokens" column added.'); }

        // --- Message Timestamp Index ---
        const messageIndexes = dbInstance.pragma("index_list('messages')") as { name: string }[];
        if (!messageIndexes.some(idx => idx.name === 'idx_message_timestamp')) { console.log('[db Init Func Migration]: Adding message timestamp index...'); dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);"); console.log('[db Init Func Migration]: Message timestamp index added.'); }

        // --- Verify Schema Version (AFTER schema exec and migrations) ---
        verifySchemaVersion(dbInstance, schema);

    } catch (error) {
        console.error('[db Init Func]: Error initializing database:', error);
        if (dbInstance && dbInstance.open) { try { dbInstance.close(); } catch (closeErr) { console.error("Error closing DB instance after init error:", closeErr); } }
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
    initializeDatabase(db);
} catch (err) {
    console.error(`[db]: FATAL: Could not connect or initialize database at ${dbFilePath}:`, (err as Error).message);
    process.exit(1);
}

// --- Prepared Statements Cache ---
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

// --- Synchronous Helper Functions ---
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

// --- Moved from dbAccess.ts ---
// TODO move to sqliteService
// Simple wrapper to check database health
export const checkDatabaseHealth = (): void => {
  db.pragma('quick_check');
};
// --- End Moved ---

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

export { db, run, get, all, exec, transaction, closeDb, initializeDatabase, schema };
