// src/db/sqliteService.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config'; // Relative

const dbFilePath = config.db.sqlitePath; // Use path from config
const dbDir = path.dirname(dbFilePath);

// Ensure data directory exists (already done in config, but double-check)
if (!fs.existsSync(dbDir)) {
    console.log(`Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[db]: Initializing SQLite database at: ${dbFilePath}`);
let dbInstance: Database.Database;

try {
    dbInstance = new Database(dbFilePath, {
        verbose: config.server.isProduction ? undefined : console.log // Enable verbose logging in dev
    });
} catch (error) {
     console.error(`[db]: Failed to open database at ${dbFilePath}:`, error);
     process.exit(1);
}

export const db = dbInstance; // Export the instance

// Enable WAL mode for better concurrency
try {
    db.pragma('journal_mode = WAL');
    // Set synchronous mode to NORMAL for WAL, potentially faster but slightly less durable on power loss
    // db.pragma('synchronous = NORMAL');
    // Set busy_timeout to handle concurrent writes better (e.g., 5 seconds)
    db.pragma('busy_timeout = 5000');
    console.log('[db]: WAL mode enabled.');
} catch (error) {
     console.error('[db]: Failed to set WAL mode:', error);
}


const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY, -- Use AUTOINCREMENT if you need strictly sequential IDs, else INTEGER PRIMARY KEY is fine
        fileName TEXT NOT NULL,
        clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL,
        date TEXT NOT NULL, -- Store as ISO 8601 string (YYYY-MM-DD)
        sessionType TEXT NOT NULL,
        therapy TEXT NOT NULL,
        transcriptPath TEXT NOT NULL UNIQUE -- Path to the transcript file
    );

    -- Chats Table
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY,
        sessionId INTEGER NOT NULL,
        timestamp INTEGER NOT NULL, -- Unix timestamp (ms)
        name TEXT, -- Optional chat name
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE -- Delete chats if session is deleted
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);


    -- Messages Table
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL, -- Unix timestamp (ms)
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE -- Delete messages if chat is deleted
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);

`;

// Apply schema within a transaction
try {
    db.transaction(() => {
        db.exec(schema);
    })();
    console.log('[db]: Database schema initialized successfully.');
} catch (error) {
     console.error('[db]: Error initializing database schema:', error);
     process.exit(1); // Exit if DB schema fails
}

// Graceful shutdown
const closeDb = () => {
    if (db && db.open) {
        console.log('[db]: Closing database connection...');
        db.close();
        console.log('[db]: Database connection closed.');
    }
};

process.on('exit', closeDb);
// Handle signals for graceful shutdown
process.on('SIGHUP', () => process.exit(128 + 1)); // 1
process.on('SIGINT', () => process.exit(128 + 2)); // 2
process.on('SIGTERM', () => process.exit(128 + 15)); // 15

// Handle uncaught exceptions to close DB before exiting
process.on('uncaughtException', (err) => {
    console.error('[db]: Uncaught Exception:', err);
    closeDb();
    process.exit(1);
});
