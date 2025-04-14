import Database, { type Database as DB, type Statement, type RunResult } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

const isDev = !config.server.isProduction;
const dbFilePath = config.db.sqlitePath;
const dbDir = path.dirname(dbFilePath);

// --- Ensure Directory Exists ---
if (!fs.existsSync(dbDir)) {
    console.log(`[db]: Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
}

// --- Schema Definition (Moved UP) ---
const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        date TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        transcriptPath TEXT NOT NULL UNIQUE
    );
    -- Chats Table
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        name TEXT,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    -- Messages Table
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);
`;

// --- Database Instance (Declare Here, Define in try block) ---
let db: DB;

// --- Close Function Definition (Moved UP) ---
const closeDb = (): void => {
    // Check if db has been initialized and is open
    if (db && db.open) {
        console.log('[db]: Closing database connection...');
        try {
            db.close();
            console.log('[db]: Database connection closed.');
        } catch (error) {
            console.error('[db]: Error closing the database connection:', error);
        }
    } else {
        // Optional: Log if closeDb is called before db is initialized
        // console.log('[db]: closeDb called, but DB not initialized or already closed.');
    }
};


// --- Initialize Function Definition (Uses `schema` and `closeDb`) ---
function initializeDatabase(dbInstance: DB) {
    try {
        // Execute PRAGMAs sequentially using the synchronous pragma method
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('busy_timeout = 5000');
        dbInstance.pragma('foreign_keys = ON'); // Ensure foreign keys are enforced
        console.log('[db]: WAL mode and foreign keys enabled.');

        // Execute schema creation statements using synchronous exec (schema is defined above)
        dbInstance.exec(schema);
        console.log('[db]: Database schema initialized successfully.');

    } catch (error) {
        console.error('[db]: Error initializing database pragmas or schema:', error);
        // Close the faulty connection attempt and exit (closeDb is defined above)
        closeDb();
        process.exit(1);
    }
}

// --- Database Connection and Initialization ---
console.log(`[db]: Initializing SQLite database connection for: ${dbFilePath}`);
try {
    // Define the db instance
    db = new Database(dbFilePath, {
        verbose: isDev ? console.log : undefined, // Log statements in dev
    });
    console.log(`[db]: Successfully connected to database: ${dbFilePath}`);
    initializeDatabase(db); // Initialize synchronously (schema and closeDb are defined above)
} catch (err) {
    console.error(`[db]: FATAL: Could not connect to database at ${dbFilePath}:`, (err as Error).message);
    // closeDb is defined above, so safe to call here if needed (though connection failed)
    // closeDb(); // Optional: attempt close even on connection failure, though likely unnecessary
    process.exit(1);
}

// --- Prepared Statements Cache ---
const statementCache = new Map<string, Statement>();

function prepare(sql: string): Statement {
    let stmt = statementCache.get(sql);
    if (!stmt) {
        try {
            stmt = db.prepare(sql); // db is now guaranteed to be initialized here
            statementCache.set(sql, stmt);
        } catch (error) {
            console.error(`[db] Error preparing statement: ${sql}`, error);
            throw error; // Re-throw after logging
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
    db.exec(sql); // db is initialized
}
function transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return db.transaction(fn); // db is initialized
}


// --- Process Event Listeners (closeDb is defined above) ---
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

// Export the synchronous helper functions
export { db, run, get, all, exec, transaction, closeDb };
