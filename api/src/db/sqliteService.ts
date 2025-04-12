import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

// TODO move all to /services
const dbFilePath = config.db.sqlitePath;
const dbDir = path.dirname(dbFilePath);

if (!fs.existsSync(dbDir)) {
    console.log(`Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[db]: Initializing SQLite database at: ${dbFilePath}`);

let dbInstance: Database.Database;
try {
    dbInstance = new Database(dbFilePath, {
        verbose: config.server.isProduction ? undefined : console.log
    });
} catch (error) {
    console.error(`[db]: Failed to open database at ${dbFilePath}:`, error);
    process.exit(1);
}

export const db: Database.Database = dbInstance;

try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    console.log('[db]: WAL mode enabled.');
} catch (error) {
    console.error('[db]: Failed to set WAL mode:', error);
}

const schema = `
    -- Sessions Table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
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
        id INTEGER PRIMARY KEY,
        sessionId INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        name TEXT,
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    -- Messages Table
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        chatId INTEGER NOT NULL,
        sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);
`;

try {
    db.transaction(() => { db.exec(schema); })();
    console.log('[db]: Database schema initialized successfully.');
} catch (error) {
    console.error('[db]: Error initializing database schema:', error);
    process.exit(1);
}

const closeDb = () => {
    if (db && db.open) {
        console.log('[db]: Closing database connection...');
        db.close();
        console.log('[db]: Database connection closed.');
    }
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
