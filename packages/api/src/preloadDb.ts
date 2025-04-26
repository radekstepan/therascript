/* packages/api/src/preloadDb.ts */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { calculateTokenCount } from './services/fileService.js';

// Determine paths relative to *this file's* location
const __filename = fileURLToPath(import.meta.url);
const packageApiDir = path.resolve(__filename, '../../');
const targetDataDir = path.join(packageApiDir, 'data');
const targetDbPath = path.join(targetDataDir, 'therapy-analyzer.sqlite');
const targetTranscriptsDir = path.join(targetDataDir, 'transcripts');

// --- Updated Schema Definition (Must match sqliteService.ts) ---
const SCHEMA_HASH_KEY = 'schema_md5';
const schema = `
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fileName TEXT NOT NULL, clientName TEXT NOT NULL,
        sessionName TEXT NOT NULL, date TEXT NOT NULL, sessionType TEXT NOT NULL, therapy TEXT NOT NULL,
        transcriptPath TEXT NULL, status TEXT NOT NULL DEFAULT 'pending', whisperJobId TEXT NULL,
        audioPath TEXT NULL, transcriptTokenCount INTEGER NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId INTEGER NULL, timestamp INTEGER NOT NULL,
        name TEXT, tags TEXT NULL, -- Added tags column
        FOREIGN KEY (sessionId) REFERENCES sessions (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chats (sessionId);
    CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chatId INTEGER NOT NULL, sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
        text TEXT NOT NULL, timestamp INTEGER NOT NULL, promptTokens INTEGER, completionTokens INTEGER,
        starred INTEGER DEFAULT 0, starredName TEXT NULL,
        FOREIGN KEY (chatId) REFERENCES chats (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_chat ON messages (chatId);
    CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);
    CREATE TABLE IF NOT EXISTS schema_metadata ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
`;
// --- End Schema Definition ---

// --- Schema Verification Logic (Copied - ensure it matches sqliteService) ---
function calculateSchemaHash(schemaString: string): string { return crypto.createHash('md5').update(schemaString).digest('hex'); }
function verifySchemaVersion(dbInstance: Database.Database, currentSchemaDefinition: string) { const currentHash=calculateSchemaHash(currentSchemaDefinition); let storedHash: string|undefined; try { dbInstance.exec(`CREATE TABLE IF NOT EXISTS schema_metadata ( key TEXT PRIMARY KEY, value TEXT NOT NULL );`); const row = dbInstance.prepare('SELECT value FROM schema_metadata WHERE key = ?').get(SCHEMA_HASH_KEY) as { value: string } | undefined; storedHash = row?.value; } catch (e){ console.warn("Could not read stored hash", e); } if(storedHash){ if(currentHash === storedHash){ console.log("[Preload Schema Check]: OK"); } else { console.error("FATAL SCHEMA MISMATCH!"); console.error(` Code: ${currentHash}`); console.error(` DB:   ${storedHash}`); console.error("Backup DB, delete file, restart API."); dbInstance.close(); process.exit(1); } } else { console.log("[Preload Schema Check]: Storing initial hash."); try { dbInstance.prepare('INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)').run(SCHEMA_HASH_KEY, currentHash); } catch(e){ console.error("FATAL: Failed store hash",e); dbInstance.close(); process.exit(1); } } }
// --- End Copied Logic ---

// --- Initialize Database function ---
function initializeDatabase(dbInstance: Database.Database) {
    console.log('[Preload Init Func]: Initializing schema...');
    try {
        dbInstance.pragma('journal_mode = WAL'); dbInstance.pragma('busy_timeout = 5000'); dbInstance.pragma('foreign_keys = ON');
        dbInstance.exec(schema); console.log('[Preload Init Func]: Schema exec command executed.');
        const sessionCols = dbInstance.pragma("table_info(sessions)") as { name: string }[];
        const chatCols = dbInstance.pragma("table_info(chats)") as { name: string }[];
        const msgCols = dbInstance.pragma("table_info(messages)") as { name: string }[];
        if (!sessionCols.some(c=>c.name==='audioPath')) {dbInstance.exec("ALTER TABLE sessions ADD COLUMN audioPath TEXT NULL"); console.log('[P Mig]: Add sessions.audioPath');}
        if (!sessionCols.some(c=>c.name==='transcriptTokenCount')) {dbInstance.exec("ALTER TABLE sessions ADD COLUMN transcriptTokenCount INTEGER NULL"); console.log('[P Mig]: Add sessions.transcriptTokenCount');}
        if (!chatCols.some(c=>c.name==='tags')) {dbInstance.exec("ALTER TABLE chats ADD COLUMN tags TEXT NULL"); console.log('[P Mig]: Add chats.tags');}
        if (!(dbInstance.pragma("index_list('chats')") as {name:string}[]).some(i=>i.name==='idx_chat_timestamp')) {dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chats (timestamp);"); console.log('[P Mig]: Add chat timestamp index');}
        if (!msgCols.some(c=>c.name==='promptTokens')) {dbInstance.exec("ALTER TABLE messages ADD COLUMN promptTokens INTEGER NULL"); console.log('[P Mig]: Add messages.promptTokens');}
        if (!msgCols.some(c=>c.name==='completionTokens')) {dbInstance.exec("ALTER TABLE messages ADD COLUMN completionTokens INTEGER NULL"); console.log('[P Mig]: Add messages.completionTokens');}
        if (!msgCols.some(c=>c.name==='starred')) {dbInstance.exec("ALTER TABLE messages ADD COLUMN starred INTEGER DEFAULT 0"); console.log('[P Mig]: Add messages.starred');}
        if (!msgCols.some(c=>c.name==='starredName')) {dbInstance.exec("ALTER TABLE messages ADD COLUMN starredName TEXT NULL"); console.log('[P Mig]: Add messages.starredName');}
        if (!(dbInstance.pragma("index_list('messages')") as {name:string}[]).some(i=>i.name==='idx_message_timestamp')) {dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_message_timestamp ON messages (timestamp);"); console.log('[P Mig]: Add message timestamp index');}
        verifySchemaVersion(dbInstance, schema);
        console.log('[Preload Init Func]: Schema init/verify complete.');
    } catch (initError) { console.error('[Preload Init Func]: Error:', initError); if(dbInstance?.open){try{dbInstance.close();}catch{}} throw initError; }
}
// --- END initializeDatabase definition ---


interface SessionVerificationData { id: number; status: string; transcriptPath: string | null; date: string; transcriptTokenCount: number | null; }
const createIsoTimestamp = (dateStr: string, offsetMinutes: number = 0): string => { const d=new Date(`${dateStr}T12:00:00Z`); d.setMinutes(d.getMinutes()+offsetMinutes); return d.toISOString(); };
interface SampleChatMessage { sender: 'user' | 'ai'; text: string; starred?: boolean; starredName?: string; }
// --- Updated Sample Data with Alphabetically Sorted Tags ---
const sampleSessions = [
  { localIdRef: 1, fileName: 'session1.mp3', clientName: 'Jane Doe', sessionName: 'Initial Consultation', date: createIsoTimestamp('2025-04-01', 0), sessionType: 'Individual', therapy: 'CBT', transcriptContent: [ { id: 0, timestamp: 0, text: "T: ..." }, { id: 1, timestamp: 6500, text: "J: ..." }, ], status: 'completed', whisperJobId: null, chats: [ { name: 'Work Stress Discussion', tags: ['stress', 'work'], messages: [ { sender: 'user', text: 'What did Jane say about work?', starred: true, starredName: 'Jane Work Stress Quote' }, { sender: 'ai', text: 'Jane mentioned...' } ] as SampleChatMessage[] }, { name: 'CBT Concepts Introduced', tags: ['cbt', 'introduction'], messages: [ { sender: 'user', text: 'Did the therapist explain CBT?' }, { sender: 'ai', text: 'Yes, the therapist...' } ] as SampleChatMessage[] }, ] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
  { localIdRef: 2, fileName: 'session2.mp3', clientName: 'John Smith', sessionName: 'Follow-up Session', date: createIsoTimestamp('2025-04-02', 0), sessionType: 'Individual', therapy: 'Mindfulness', transcriptContent: [ { id: 0, timestamp: 0, text: "T: ..." }, { id: 1, timestamp: 7100, text: "J: ..." }, ], status: 'completed', whisperJobId: null, chats: [ { name: 'Mindfulness Check-in', tags: ['anxiety', 'check-in', 'mindfulness'], messages: [ { sender: 'user', text: 'How’s John doing with anxiety?' }, { sender: 'ai', text: 'John reported...' } ] as SampleChatMessage[] }, { name: undefined, tags: ['anxiety', 'trigger'], messages: [ { sender: 'user', text: 'What triggers John\'s anxiety?', starred: true, starredName: 'John Triggers' }, { sender: 'ai', text: 'The session identified...' } ] as SampleChatMessage[] }, { name: 'Therapist Techniques', tags: ['mindfulness', 'reframing', 'technique'], messages: [ { sender: 'user', text: 'What techniques did the therapist suggest?' }, { sender: 'ai', text: 'The therapist reinforced...' } ] as SampleChatMessage[] }, ] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
  { localIdRef: 3, fileName: 'session3.mp3', clientName: 'Jane Doe', sessionName: 'Follow-up CBT', date: createIsoTimestamp('2025-04-01', 60), sessionType: 'Individual', therapy: 'CBT', transcriptContent: [ { id: 0, timestamp: 0, text: "T: ..." }, { id: 1, timestamp: 3000, text: "J: ..." } ], status: 'completed', whisperJobId: null, chats: [] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
];
// --- End Sample Data Update ---

async function preloadDatabase() {
    console.log(`[Preload] Database file target: ${targetDbPath}`);
    try { await fs.unlink(targetDbPath); console.log(`[Preload] Deleted existing database file.`); }
    catch (err: any) { if (err.code !== 'ENOENT') console.error(`[Preload] Error deleting DB:`, err); }
    try { await fs.mkdir(targetDataDir, { recursive: true }); await fs.mkdir(targetTranscriptsDir, { recursive: true }); }
    catch (err) { console.error(`[Preload] Failed create dirs:`, err); process.exit(1); }

    let db: Database.Database | null = null;
    let success = false;
    const fileWritePromises: Promise<void>[] = [];
    const sessionsToVerify: { name: string; expectedRelativePath: string; expectedDate: string; expectedTokenCount: number | null }[] = [];

    try {
        db = new Database(targetDbPath, { verbose: console.log });
        initializeDatabase(db); // Initialize and verify schema FIRST

        const insertSession = db.prepare(/* SQL */ `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (@fileName, @clientName, @sessionName, @date, @sessionType, @therapy, NULL, NULL, @status, @whisperJobId, @transcriptTokenCount)`);
        const updateSessionPathAndAudio = db.prepare(/* SQL */ `UPDATE sessions SET transcriptPath = ?, audioPath = ? WHERE id = ?`);
        const insertChat = db.prepare(/* SQL */ `INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)`);
        const insertMessage = db.prepare(/* SQL */ `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

        console.log('[Preload] Starting DB transaction...');
        db.transaction(() => {
            for (const session of sampleSessions) {
                const fullTranscriptText = session.transcriptContent.map(p => p.text).join('\n\n');
                const tokenCount = calculateTokenCount(fullTranscriptText);
                const sessionResult = insertSession.run({ fileName: session.fileName, clientName: session.clientName, sessionName: session.sessionName, date: session.date, sessionType: session.sessionType, therapy: session.therapy, status: session.status, whisperJobId: session.whisperJobId, transcriptTokenCount: tokenCount });
                const sessionId = sessionResult.lastInsertRowid as number;
                const relativeTranscriptPath = `${sessionId}.json`;
                const absoluteTranscriptPath = path.join(targetTranscriptsDir, relativeTranscriptPath);
                const audioIdentifier = `${sessionId}-audio.mp3`;
                updateSessionPathAndAudio.run(relativeTranscriptPath, audioIdentifier, sessionId);
                sessionsToVerify.push({ name: session.sessionName, expectedRelativePath: relativeTranscriptPath, expectedDate: session.date, expectedTokenCount: tokenCount });
                const transcriptJson = JSON.stringify(session.transcriptContent, null, 2);
                fileWritePromises.push(fs.writeFile(absoluteTranscriptPath, transcriptJson, 'utf-8').catch(err => { throw new Error(`Failed write transcript ${sessionId}: ${err}`); }));

                for (const chat of session.chats) {
                    const timestamp = Date.now() + Math.floor(Math.random() * 1000);
                    // Ensure tags are sorted before stringifying (sample data is already sorted)
                    const sortedTags = chat.tags ? [...chat.tags].sort((a, b) => a.localeCompare(b)) : null;
                    const tagsJson = (sortedTags && sortedTags.length > 0) ? JSON.stringify(sortedTags) : null;
                    const chatResult = insertChat.run(sessionId, timestamp, chat.name === undefined ? null : chat.name, tagsJson); // Insert tagsJson
                    const chatId = chatResult.lastInsertRowid;
                    for (const message of chat.messages) {
                        const messageTimestamp = timestamp + Math.floor(Math.random() * 100);
                        insertMessage.run(chatId, message.sender, message.text, messageTimestamp, null, null, message.starred ? 1 : 0, message.starredName || null);
                    }
                }
            }
        })(); // End transaction

        console.log('[Preload] DB transaction committed.');
        await Promise.all(fileWritePromises);
        console.log('[Preload] All transcript files written.');
        success = true;

    } catch (error) { console.error('[Preload] Error:', error); success = false; }
    finally {
        if (success && db && db.open) {
             console.log('[Preload Verification] Checking database entries...');
            try { /* ... Verification Logic ... */
                const verifyStmt = db.prepare('SELECT id, status, transcriptPath, date, transcriptTokenCount FROM sessions WHERE sessionName = ?');
                let verificationPassed = true;
                for (const sessionToVerify of sessionsToVerify) {
                    const dbSession: SessionVerificationData | undefined = verifyStmt.get(sessionToVerify.name) as SessionVerificationData | undefined;
                    if (!dbSession) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' not found!`); verificationPassed = false; continue; }
                    if (dbSession.status !== 'completed') { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) status '${dbSession.status}' != 'completed'.`); verificationPassed = false; }
                    if (dbSession.date !== sessionToVerify.expectedDate) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) date '${dbSession.date}' != '${sessionToVerify.expectedDate}'.`); verificationPassed = false; }
                    if (dbSession.transcriptTokenCount !== sessionToVerify.expectedTokenCount) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) token count '${dbSession.transcriptTokenCount}' != '${sessionToVerify.expectedTokenCount}'.`); verificationPassed = false; }
                    if (!dbSession.transcriptPath || dbSession.transcriptPath !== sessionToVerify.expectedRelativePath) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) path mismatch/missing. Found: '${dbSession.transcriptPath}', Expected: '${sessionToVerify.expectedRelativePath}'.`); verificationPassed = false; }
                    else { const absPath = path.join(targetTranscriptsDir, dbSession.transcriptPath); try { await fs.access(absPath); } catch (fileError) { console.error(`[PV] FAILED: File check failed for '${absPath}'. Error: ${fileError}`); verificationPassed = false; } }
                }
                if(verificationPassed) console.log('[Preload Verification] All DB entries/files look OK.'); else { console.error('[PV] FAILED.'); success = false; }
            } catch(verifyError) { console.error('[PV] Error:', verifyError); success = false; }
        } else if (!db) { console.error('[Preload] DB connection not established.'); success = false; }
        if (db && db.open) { db.close(); console.log('[Preload] DB closed.'); }
        if (success) console.log('[Preload] Success!'); else { console.error('[Preload] FAILED.'); process.exitCode = 1; }
    }
}

preloadDatabase().catch(err => { console.error('[Preload] Fatal error:', err); process.exit(1); });
