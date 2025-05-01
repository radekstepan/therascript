// File: packages/api/src/preloadDb.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises'; // <-- Use fs.promises for async operations
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { calculateTokenCount } from './services/fileService.js';
// *** Import schema and init/verify functions from sqliteService ***
import {
    schema, // Import the schema string
    initializeDatabase, // Import the initialization logic
    // No need to import verifySchemaVersion or calculateSchemaHash directly
    // as they are called by the imported initializeDatabase
} from './db/sqliteService.js';
// --- Import type for DB paragraph structure ---
import type { BackendTranscriptParagraph } from './types/index.js';

// Determine paths relative to *this file's* location
const __filename = fileURLToPath(import.meta.url);
// Adjust path based on build output location (e.g., 'dist/')
// If preloadDb.js is in `dist/`, navigate up twice to get to `packages/api`
const packageApiDir = path.resolve(__filename, '../../');

// --- Read DB_PATH from environment (loaded by --env-file) ---
// Fallback needed if run directly without --env-file for some reason
const dbPathFromEnv = process.env.DB_PATH || './data/therapy-analyzer-dev.sqlite';
if (!process.env.DB_PATH) {
    console.warn(`[Preload] WARN: DB_PATH not found in environment variables. Falling back to default: ${dbPathFromEnv}`);
} else {
    console.log(`[Preload] Read DB_PATH from environment: ${process.env.DB_PATH}`);
}
// --- Resolve the target DB path relative to the API package directory ---
const targetDbPath = path.resolve(packageApiDir, dbPathFromEnv);
const targetDataDir = path.dirname(targetDbPath); // Get the directory from the resolved path

// Sample data interfaces (remain the same)
interface SessionVerificationData {
    id: number;
    status: string;
    date: string;
    transcriptTokenCount: number | null;
}
const createIsoTimestamp = (dateStr: string, offsetMinutes: number = 0): string => { const d=new Date(`${dateStr}T12:00:00Z`); d.setMinutes(d.getMinutes()+offsetMinutes); return d.toISOString(); };
interface SampleChatMessage { sender: 'user' | 'ai'; text: string; starred?: boolean; starredName?: string; }
const sampleSessions = [
  { localIdRef: 1, fileName: 'session1.mp3', clientName: 'Jane Doe', sessionName: 'Initial Consultation', date: createIsoTimestamp('2025-04-01', 0), sessionType: 'Individual', therapy: 'CBT', transcriptContent: [ { id: 0, timestamp: 0, text: "T: Let's start by discussing what brought you in today." }, { id: 1, timestamp: 6500, text: "J: Well, I've been feeling really overwhelmed with work lately. It's constant pressure." }, { id: 2, timestamp: 12300, text: "T: Tell me more about that pressure. What does it feel like?" }, { id: 3, timestamp: 18800, text: "J: Like I can never catch up. My thoughts race, and I find it hard to focus on one task." }, { id: 4, timestamp: 25000, text: "T: That sounds exhausting. We can explore some CBT techniques to manage those racing thoughts." } ], status: 'completed', whisperJobId: null, chats: [ { name: 'Work Stress Discussion', tags: ['stress', 'work'], messages: [ { sender: 'user', text: 'What did Jane say about work?', starred: true, starredName: 'Jane Work Stress Quote' }, { sender: 'ai', text: "Jane mentioned feeling really overwhelmed with work, describing it as constant pressure and feeling like she can never catch up. She also noted that her thoughts race and she finds it hard to focus." } ] as SampleChatMessage[] }, { name: 'CBT Concepts Introduced', tags: ['cbt', 'introduction'], messages: [ { sender: 'user', text: 'Did the therapist explain CBT?' }, { sender: 'ai', text: 'Yes, the therapist mentioned exploring CBT techniques to manage Jane\'s racing thoughts, indicating an introduction to the therapy modality.' } ] as SampleChatMessage[] }, ] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
  { localIdRef: 2, fileName: 'session2.mp3', clientName: 'John Smith', sessionName: 'Follow-up Session', date: createIsoTimestamp('2025-04-02', 0), sessionType: 'Individual', therapy: 'Mindfulness', transcriptContent: [ { id: 0, timestamp: 0, text: "T: Welcome back, John. How has your week been since our last mindfulness practice?" }, { id: 1, timestamp: 7100, text: "J: Better in some ways. I noticed my anxiety creeping up during a meeting, but I tried the breathing exercise." }, { id: 2, timestamp: 14500, text: "T: That's great self-awareness. How did the breathing exercise feel in that moment?" }, { id: 3, timestamp: 21200, text: "J: It helped ground me a bit, but the physical sensations were still strong." }, { id: 4, timestamp: 27800, text: "T: Okay, let's work on acknowledging those physical sensations without judgment. That's a key part of mindfulness." } ], status: 'completed', whisperJobId: null, chats: [ { name: 'Mindfulness Check-in', tags: ['anxiety', 'check-in', 'mindfulness'], messages: [ { sender: 'user', text: 'How’s John doing with anxiety?' }, { sender: 'ai', text: 'John reported that his week was better in some ways. He noticed his anxiety during a meeting and used a breathing exercise, which helped ground him, although the physical sensations remained strong.' } ] as SampleChatMessage[] }, { name: undefined, tags: ['anxiety', 'trigger'], messages: [ { sender: 'user', text: 'What triggers John\'s anxiety?', starred: true, starredName: 'John Triggers' }, { sender: 'ai', text: 'The session explicitly mentioned John experiencing anxiety during a meeting.' } ] as SampleChatMessage[] }, { name: 'Therapist Techniques', tags: ['mindfulness', 'reframing', 'technique'], messages: [ { sender: 'user', text: 'What techniques did the therapist suggest?' }, { sender: 'ai', text: 'The therapist acknowledged John\'s use of a breathing exercise and suggested working on acknowledging physical sensations without judgment as a key part of mindfulness.' } ] as SampleChatMessage[] }, ] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
  { localIdRef: 3, fileName: 'session3.mp3', clientName: 'Jane Doe', sessionName: 'Follow-up CBT', date: createIsoTimestamp('2025-04-01', 60), sessionType: 'Individual', therapy: 'CBT', transcriptContent: [ { id: 0, timestamp: 0, text: "T: Last time we talked about identifying automatic negative thoughts. Have you noticed any this week?" }, { id: 1, timestamp: 8000, text: "J: Yes, definitely. When my boss gave feedback, I immediately thought, 'I'm going to get fired.'" }, { id: 2, timestamp: 15500, text: "T: That's a perfect example of catastrophizing. Let's challenge that thought. What's the evidence for and against it?" } ], status: 'completed', whisperJobId: null, chats: [] as { name?: string; tags?: string[]; messages: SampleChatMessage[] }[], },
];

async function preloadDatabase() {
    console.log(`[Preload] Target DB Path (from env or default): ${targetDbPath}`);
    console.log(`[Preload] Target Data Directory: ${targetDataDir}`);

    // *** START DELETION LOGIC ***
    // Delete the entire 'data' directory if it exists
    let deletionAttempted = false;
    try {
        await fs.access(targetDataDir); // Check if the directory exists
        console.log(`[Preload] Existing data directory found at ${targetDataDir}. Attempting deletion...`);
        deletionAttempted = true;
        // Use fs.rm to recursively delete the directory
        await fs.rm(targetDataDir, { recursive: true, force: true });
        console.log(`[Preload] Successfully deleted directory: ${targetDataDir}`);
        // Optional: Add a small delay to allow the file system to catch up
        await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            // ENOENT means the directory didn't exist, which is fine
            console.log(`[Preload] Data directory not found at ${targetDataDir}. No deletion needed.`);
        } else {
            // Other errors during deletion are problematic
            console.error(`[Preload] Error deleting data directory ${targetDataDir}:`, err);
            // If deletion was attempted but failed, it's critical - exit.
            if (deletionAttempted) {
                 console.error(`[Preload] FATAL: Failed to delete existing data directory. Check permissions or file locks.`);
                 process.exit(1);
            }
        }
    }
    // *** END DELETION LOGIC ***


    try {
        // Create the data directory AFTER deleting it
        console.log(`[Preload] Creating data directory: ${targetDataDir}`);
        await fs.mkdir(targetDataDir, { recursive: true });
        // Also ensure uploads dir exists within the target data dir
        // Read UPLOADS_DIR from env, resolve relative to API package dir
        const uploadsDirRelative = process.env.DB_UPLOADS_DIR || './data/uploads';
        const targetUploadsDir = path.resolve(packageApiDir, uploadsDirRelative);
        console.log(`[Preload] Creating uploads directory: ${targetUploadsDir}`);
        await fs.mkdir(targetUploadsDir, { recursive: true });
    }
    catch (err) { console.error(`[Preload] Failed create data/uploads directory:`, err); process.exit(1); }

    let db: Database.Database | null = null;
    let success = false;
    const sessionsToVerify: { name: string; expectedDate: string; expectedTokenCount: number | null; expectedParagraphCount: number }[] = [];

    try {
        // Connect AFTER ensuring deletion and recreation, using the correct target path
        console.log(`[Preload] Connecting to database: ${targetDbPath}`);
        db = new Database(targetDbPath, { verbose: console.log });

        // *** Call the imported initializeDatabase function ***
        // This will execute the schema, run migrations (if any apply to new db), and verify the hash
        initializeDatabase(db);

        // --- Add Debug Check Here ---
        console.log('[Preload] Checking if transcript_paragraphs exists before prepare...');
        try {
            const checkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_paragraphs';").get();
            if (checkTable) {
                console.log('[Preload] transcript_paragraphs table FOUND before prepare.');
            } else {
                // If this logs, the explicit creation in initializeDatabase also failed.
                console.error('[Preload] CRITICAL: transcript_paragraphs table NOT FOUND before prepare!');
                throw new Error('transcript_paragraphs table missing after initialization.');
            }
        } catch (e) {
             console.error('[Preload] Error checking for transcript_paragraphs table:', e);
             throw e; // Re-throw check error
        }
        // --- End Debug Check ---

        // Prepare statements using the now-initialized db instance
        const insertSession = db.prepare(/* SQL */ `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (@fileName, @clientName, @sessionName, @date, @sessionType, @therapy, @audioPath, @status, @whisperJobId, @transcriptTokenCount)`);
        const insertChat = db.prepare(/* SQL */ `INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)`);
        const insertMessage = db.prepare(/* SQL */ `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertParagraph = db.prepare(/* SQL */ `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text) VALUES (?, ?, ?, ?)`); // <-- New statement

        console.log('[Preload] Starting DB transaction for sample data...');
        db.transaction(() => {
            for (const session of sampleSessions) {
                const fullTranscriptText = session.transcriptContent.map(p => p.text).join('\n\n');
                const tokenCount = calculateTokenCount(fullTranscriptText);
                // Use a relative path for audioPath based on the filename for simplicity in sample data
                const audioIdentifier = session.fileName; // Simple identifier

                // Insert session without transcriptPath, but with audioPath
                const sessionResult = insertSession.run({
                    fileName: session.fileName,
                    clientName: session.clientName,
                    sessionName: session.sessionName,
                    date: session.date,
                    sessionType: session.sessionType,
                    therapy: session.therapy,
                    audioPath: audioIdentifier, // Set audio path here
                    status: session.status,
                    whisperJobId: session.whisperJobId,
                    transcriptTokenCount: tokenCount
                });
                const sessionId = sessionResult.lastInsertRowid as number;

                // --- Insert paragraphs into the new table ---
                for (const paragraph of session.transcriptContent) {
                    insertParagraph.run(sessionId, paragraph.id, paragraph.timestamp, paragraph.text);
                }
                // --- End paragraph insertion ---

                // Store info for verification
                sessionsToVerify.push({
                    name: session.sessionName,
                    expectedDate: session.date,
                    expectedTokenCount: tokenCount,
                    expectedParagraphCount: session.transcriptContent.length
                });

                // Insert chats and messages (unchanged)
                for (const chat of session.chats) {
                    const timestamp = Date.now() + Math.floor(Math.random() * 1000);
                    // Ensure tags are sorted before stringifying (sample data is already sorted)
                    const sortedTags = chat.tags ? [...chat.tags].sort((a, b) => a.localeCompare(b)) : null;
                    const tagsJson = (sortedTags && sortedTags.length > 0) ? JSON.stringify(sortedTags) : null;
                    const chatResult = insertChat.run(sessionId, timestamp, chat.name === undefined ? null : chat.name, tagsJson); // Insert tagsJson
                    const chatId = chatResult.lastInsertRowid as number;
                    for (const message of chat.messages) {
                        const messageTimestamp = timestamp + Math.floor(Math.random() * 100);
                        insertMessage.run(chatId, message.sender, message.text, messageTimestamp, null, null, message.starred ? 1 : 0, message.starredName || null);
                    }
                }
            }
        })(); // End transaction

        console.log('[Preload] Sample data DB transaction committed.');
        success = true;


    } catch (error) { console.error('[Preload] Error during preload execution:', error); success = false; }
    finally {
        // Verification logic updated
         if (success && db && db.open) {
            console.log('[Preload Verification] Checking database entries...');
            try {
                // Verify session table data (excluding transcriptPath)
                const verifySessionStmt = db.prepare('SELECT id, status, date, transcriptTokenCount FROM sessions WHERE sessionName = ?');
                // Verify paragraph count
                const verifyParagraphCountStmt = db.prepare('SELECT COUNT(*) as count FROM transcript_paragraphs WHERE sessionId = ?');

                let verificationPassed = true;
                for (const sessionToVerify of sessionsToVerify) {
                    const dbSession: SessionVerificationData | undefined = verifySessionStmt.get(sessionToVerify.name) as SessionVerificationData | undefined;
                    if (!dbSession) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' not found!`); verificationPassed = false; continue; }

                    // Verify session fields
                    if (dbSession.status !== 'completed') { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) status '${dbSession.status}' != 'completed'.`); verificationPassed = false; }
                    if (dbSession.date !== sessionToVerify.expectedDate) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) date '${dbSession.date}' != '${sessionToVerify.expectedDate}'.`); verificationPassed = false; }
                    if (dbSession.transcriptTokenCount !== sessionToVerify.expectedTokenCount) { console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) token count '${dbSession.transcriptTokenCount}' != '${sessionToVerify.expectedTokenCount}'.`); verificationPassed = false; }

                    // Verify paragraph count
                    const paraCountResult = verifyParagraphCountStmt.get(dbSession.id) as { count: number } | undefined;
                    if (!paraCountResult || paraCountResult.count !== sessionToVerify.expectedParagraphCount) {
                        console.error(`[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) paragraph count mismatch. Found: ${paraCountResult?.count}, Expected: ${sessionToVerify.expectedParagraphCount}.`);
                        verificationPassed = false;
                    }
                }
                if(verificationPassed) console.log('[Preload Verification] All DB entries/counts look OK.'); else { console.error('[PV] FAILED.'); success = false; }
            } catch(verifyError) { console.error('[PV] Error:', verifyError); success = false; }
        } else if (!db) { console.error('[Preload] DB connection not established during verification.'); success = false; }
        if (db && db.open) { db.close(); console.log('[Preload] DB closed.'); }
        if (success) console.log('[Preload] Success!'); else { console.error('[Preload] FAILED.'); process.exitCode = 1; }
    }
}

preloadDatabase().catch(err => { console.error('[Preload] Fatal error:', err); process.exit(1); });
