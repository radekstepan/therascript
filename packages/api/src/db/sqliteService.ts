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

// --- Schema Definition (Remove individual export) ---
// *** REMOVE export keyword here ***
const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        -- *** Store date as ISO 8601 timestamp string ***
        date TEXT NOT NULL, -- Changed from DATE to TEXT
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        transcriptPath TEXT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        whisperJobId TEXT NULL
    );
    -- Chats Table
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId INTEGER NOT NULL,
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
        name TEXT,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp); -- Added index for chat sorting

    -- Messages Table
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL, -- UNIX Millis Timestamp for sorting/display
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
// *** END REMOVAL ***

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
// *** Modify to accept dbInstance as argument ***
function verifySchemaVersion(dbInstance: DB, currentSchemaDefinition: string) {
    console.log('[db Schema Check]: Verifying schema version...');
    const currentSchemaHash = calculateSchemaHash(currentSchemaDefinition);
    console.log(`[db Schema Check]: Current schema definition hash: ${currentSchemaHash}`);

    let storedSchemaHash: string | undefined;
    try {
        // Use dbInstance here
        const row = dbInstance.prepare('SELECT value FROM schema_metadata WHERE key = ?').get(SCHEMA_HASH_KEY) as { value: string } | undefined;
        storedSchemaHash = row?.value;
    } catch (error) {
        // This might happen if the table doesn't exist yet (very first run)
        console.warn(`[db Schema Check]: Could not read stored schema hash (Table might not exist yet?):`, error);
        storedSchemaHash = undefined; // Treat as if no hash is stored
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
             // Ensure closeDb uses the correct instance if called from here (though it uses global `db`)
            closeDb(); // Close the main app DB connection if mismatch detected
            process.exit(1); // Exit the application
        }
    } else {
        console.log('[db Schema Check]: No stored schema hash found. Assuming first run or new database.');
        try {
            // Use dbInstance here
            dbInstance.prepare('INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)')
                      .run(SCHEMA_HASH_KEY, currentSchemaHash);
            console.log(`[db Schema Check]: Stored current schema hash (${currentSchemaHash}) in database.`);
        } catch (insertError) {
            console.error(`[db Schema Check]: FATAL: Failed to store initial schema hash:`, insertError);
             // Close the main app DB connection if error occurs
            closeDb();
            process.exit(1);
        }
    }
}


// --- Initialize Function Definition ---
// *** REMOVE export keyword here ***
function initializeDatabase(dbInstance: DB) {
    console.log('[db Init Func]: Attempting to initialize schema...'); // Log entry
    try {
        // Enable PRAGMAs
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('busy_timeout = 5000');
        dbInstance.pragma('foreign_keys = ON');
        console.log('[db Init Func]: WAL mode and foreign keys enabled.');

        // Execute schema creation statements using the schema constant
        dbInstance.exec(schema); // Uses the schema constant
        console.log('[db Init Func]: Database schema exec command executed.');

        // Check and add columns (simple migrations)
        const sessionColumns = dbInstance.pragma("table_info(sessions)") as { name: string; type: string; }[];
        const chatColumns = dbInstance.pragma("table_info(chats)") as { name: string; type: string; }[];

        // --- Session Table Migrations ---
        const hasStatus = sessionColumns.some((col) => col.name === 'status');
        const hasWhisperJobId = sessionColumns.some((col) => col.name === 'whisperJobId');

        if (!hasStatus) {
             console.log('[db Init Func Migration]: Adding "status" column...');
             dbInstance.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
             console.log('[db Init Func Migration]: "status" column added.');
         }
        if (!hasWhisperJobId) {
             console.log('[db Init Func Migration]: Adding "whisperJobId" column...');
             dbInstance.exec("ALTER TABLE sessions ADD COLUMN whisperJobId TEXT NULL");
             console.log('[db Init Func Migration]: "whisperJobId" column added.');
         }
        const dateColumn = sessionColumns.find(col => col.name === 'date');
        if (dateColumn && dateColumn.type.toUpperCase() !== 'TEXT') {
             console.warn(`[db Init Func Migration]: 'date' column type mismatch...`);
         }


        // --- Chat Table Migrations ---
        // Add index for timestamp if not exists
        const chatIndexes = dbInstance.pragma("index_list('chats')") as { name: string }[];
        if (!chatIndexes.some(idx => idx.name === 'idx_chat_timestamp')) {
             console.log('[db Init Func Migration]: Adding chat timestamp index...');
             dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);");
             console.log('[db Init Func Migration]: Chat timestamp index added.');
         }
        // Chat timestamp remains INTEGER (Unix ms)

        // --- Message Table Migrations ---
        // Add index for timestamp if not exists
        const messageIndexes = dbInstance.pragma("index_list('messages')") as { name: string }[];
         if (!messageIndexes.some(idx => idx.name === 'idx_message_timestamp')) {
             console.log('[db Init Func Migration]: Adding message timestamp index...');
             dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);");
             console.log('[db Init Func Migration]: Message timestamp index added.');
         }
        // Message timestamp remains INTEGER (Unix ms)

        // --- Verify Schema Version (AFTER schema exec and migrations) ---
        verifySchemaVersion(dbInstance, schema); // Pass instance and schema constant

    } catch (error) {
        console.error('[db Init Func]: Error initializing database:', error);
        // Close the specific instance passed, if possible (better-sqlite3 handles this internally on error usually)
        if (dbInstance && dbInstance.open) {
             try { dbInstance.close(); } catch (closeErr) { console.error("Error closing DB instance after init error:", closeErr); }
        }
        // Re-throw or exit? Let's re-throw to let the caller handle it.
        throw error;
    }
}
// *** END REMOVAL ***

// --- Database Connection and Initialization (for main app) ---
console.log(`[db]: Initializing SQLite database connection for: ${dbFilePath}`);
try {
    db = new Database(dbFilePath, {
        verbose: isDev ? console.log : undefined,
    });
    console.log(`[db]: Successfully connected to database: ${dbFilePath}`);
    // *** Call the internal function with the global db instance ***
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
            // console.log(`[db]: Preparing statement: ${sql.split('\n')[0]}...`); // Less verbose logging
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

// *** Keep the single export statement at the end ***
export { db, run, get, all, exec, transaction, closeDb, initializeDatabase, schema };
