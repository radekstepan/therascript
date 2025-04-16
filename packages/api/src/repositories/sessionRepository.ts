import { db } from '../db/sqliteService.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements
// Date column is TEXT
const insertSessionStmt = prepareStmt('INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, status, whisperJobId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
// Sort by date string (ISO 8601 sorts correctly lexicographically)
const selectAllSessionsStmt = prepareStmt('SELECT * FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT * FROM sessions WHERE id = ?');
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, transcriptPath = ?, status = ?, whisperJobId = ? WHERE id = ?`
);
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');

export const sessionRepository = {
    create: (
        metadata: BackendSessionMetadata,
        fileName: string,
        transcriptPath: string | null,
        // Accept the full timestamp for creation
        sessionTimestamp: string // ISO 8601 string
    ): BackendSession => {
        console.log(`[SessionRepo:create] Attempting insert with fileName: ${fileName}, date: ${sessionTimestamp}`);
        try {
             if (transcriptPath) {
                 const existing = findSessionByTranscriptPathStmt.get(transcriptPath);
                 if (existing) throw new Error(`Transcript path ${transcriptPath} already linked.`);
             }
             // Insert with provided ISO timestamp
            const info: RunResult = insertSessionStmt.run(
                fileName, metadata.clientName, metadata.sessionName, sessionTimestamp, // Use full timestamp
                metadata.sessionType, metadata.therapy, transcriptPath,
                'pending', // Default status
                null       // Default whisperJobId
            );
            const newId = info.lastInsertRowid as number;
            console.log(`[SessionRepo:create] Insert successful. New ID: ${newId}`);
            const newSession = sessionRepository.findById(newId);
            if (!newSession) throw new Error(`Failed retrieve session ${newId} immediately after creation.`);
            return newSession;
        } catch (error) {
            console.error(`[SessionRepo] Error in create: ${error}`);
             if (error instanceof Error && error.message.includes('NOT NULL constraint failed: sessions.transcriptPath')) {
                 console.error("[SessionRepo] CRITICAL: Still encountered NOT NULL constraint for transcriptPath.");
                 throw new Error(`DB error creating session: transcriptPath constraint issue persists. ${error}`);
            }
             if (error instanceof Error && error.message.includes('NOT NULL constraint failed: sessions.date')) {
                 console.error("[SessionRepo] CRITICAL: Encountered NOT NULL constraint for date.");
                 throw new Error(`DB error creating session: date constraint issue. ${error}`);
            }
            throw new Error(`DB error creating session: ${error}`);
        }
    },

    findAll: (): BackendSession[] => {
        try { return selectAllSessionsStmt.all() as BackendSession[]; }
        catch (error) { throw new Error(`DB error fetching sessions: ${error}`); }
    },

    findById: (id: number): BackendSession | null => {
         try {
            const session = selectSessionByIdStmt.get(id) as BackendSession | undefined;
            return session ?? null;
        } catch (error) { throw new Error(`DB error fetching session ${id}: ${error}`); }
    },

    // Update function now accepts the extended partial type
    updateMetadata: (
        id: number,
        // Accept date as string (will be ISO format)
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; transcriptPath?: string | null; status?: 'pending' | 'transcribing' | 'completed' | 'failed'; whisperJobId?: string | null; date?: string }>
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) return null;

            // Merge updates
            const updatedData = { ...existingSession, ...metadataUpdate };

             // Validate transcript path conflict
             if (updatedData.transcriptPath && updatedData.transcriptPath !== existingSession.transcriptPath) {
                 const existingPath = findSessionByTranscriptPathStmt.get(updatedData.transcriptPath);
                 if (existingPath && (existingPath as BackendSession).id !== id) {
                      throw new Error(`Transcript path ${updatedData.transcriptPath} conflict.`);
                 }
             }

            // Execute the update using all fields, including the potentially updated date string
            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName, updatedData.sessionName, updatedData.date, // Pass date string
                updatedData.sessionType, updatedData.therapy, updatedData.fileName,
                updatedData.transcriptPath, updatedData.status, updatedData.whisperJobId,
                id
            );
            return sessionRepository.findById(id);
        } catch (error) { throw new Error(`DB error updating metadata for session ${id}: ${error}`); }
    },

    deleteById: (id: number): boolean => {
        try {
            // TODO: Also delete associated transcript file? (Handled in sessionRoutes)
            const info: RunResult = deleteSessionStmt.run(id);
             return info.changes > 0;
        } catch (error) { throw new Error(`DB error deleting session ${id}: ${error}`); }
    },
};
