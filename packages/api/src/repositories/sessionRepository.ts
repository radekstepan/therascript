/* packages/api/src/repositories/sessionRepository.ts */
// (Content is the same as the previous correct version - with added logging)
import { db } from '../db/sqliteService.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements
// Statement for initial creation (transcriptPath can be null)
const insertSessionStmt = prepareStmt('INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath) VALUES (?, ?, ?, ?, ?, ?, ?)');
const selectAllSessionsStmt = prepareStmt('SELECT * FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT * FROM sessions WHERE id = ?');
// Update statement includes all potentially updatable fields
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, transcriptPath = ?, status = ?, whisperJobId = ? WHERE id = ?`
);
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');


export const sessionRepository = {
    create: (
        metadata: BackendSessionMetadata,
        fileName: string,
        // transcriptPath is expected to be potentially null on creation
        transcriptPath: string | null
    ): BackendSession => {
        // *** ADDED LOG ***
        console.log(`[SessionRepo:create] Attempting insert with fileName: ${fileName}, transcriptPath: ${transcriptPath === null ? 'NULL' : transcriptPath}`);
        try {
             // Allow creation even if path is null initially
             if (transcriptPath) {
                 const existing = findSessionByTranscriptPathStmt.get(transcriptPath);
                 if (existing) throw new Error(`Transcript path ${transcriptPath} already linked.`);
             }

             // Insert with default 'pending' status and null jobId initially from schema
             // Pass transcriptPath (which is allowed to be null by the schema now)
            const info: RunResult = insertSessionStmt.run(
                fileName, metadata.clientName, metadata.sessionName, metadata.date,
                metadata.sessionType, metadata.therapy, transcriptPath // Pass null if needed
                // Status and whisperJobId will use table defaults (pending, NULL)
            );
            const newId = info.lastInsertRowid as number;
            console.log(`[SessionRepo:create] Insert successful. New ID: ${newId}`); // *** ADDED LOG ***
            // Fetch the newly created session to return the full object including defaults
            const newSession = sessionRepository.findById(newId);
            if (!newSession) throw new Error(`Failed retrieve session ${newId} immediately after creation.`);
            return newSession;
        } catch (error) {
            // Log the specific error before throwing a general one
            console.error(`[SessionRepo] Error in create: ${error}`);
            // Check if it's the constraint error specifically (this will trigger if the DB file isn't updated)
            if (error instanceof Error && error.message.includes('NOT NULL constraint failed: sessions.transcriptPath')) {
                 console.error("[SessionRepo] CRITICAL: Still encountered NOT NULL constraint for transcriptPath despite schema change attempt.");
                 throw new Error(`DB error creating session: transcriptPath constraint issue persists. ${error}`);
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
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; transcriptPath?: string | null; status?: 'pending' | 'transcribing' | 'completed' | 'failed'; whisperJobId?: string | null }>
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) return null;

            // Merge updates, ensuring defaults from existingSession are kept if not provided in metadataUpdate
            const updatedData = { ...existingSession, ...metadataUpdate };

             // Check for transcript path conflicts only if a non-null path is being set
             if (updatedData.transcriptPath && updatedData.transcriptPath !== existingSession.transcriptPath) {
                 const existingPath = findSessionByTranscriptPathStmt.get(updatedData.transcriptPath);
                 if (existingPath && (existingPath as BackendSession).id !== id) {
                      throw new Error(`Transcript path ${updatedData.transcriptPath} conflict.`);
                 }
             }

            // Execute the update using all fields from the merged object
            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName, updatedData.sessionName, updatedData.date,
                updatedData.sessionType, updatedData.therapy, updatedData.fileName,
                updatedData.transcriptPath, // Can be null
                updatedData.status,         // Pass status
                updatedData.whisperJobId,   // Pass whisperJobId
                id
            );
            // Re-fetch to return the updated session data
            return sessionRepository.findById(id);
        } catch (error) { throw new Error(`DB error updating metadata for session ${id}: ${error}`); }
    },

    deleteById: (id: number): boolean => {
        try {
            // TODO: Also delete associated transcript file? Maybe in the handler/service layer. (Handled in sessionRoutes delete handler)
            const info: RunResult = deleteSessionStmt.run(id);
             return info.changes > 0;
        } catch (error) { throw new Error(`DB error deleting session ${id}: ${error}`); }
    },
};
