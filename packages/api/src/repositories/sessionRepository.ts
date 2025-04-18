import { db } from '../db/sqliteService.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { Statement, RunResult } from 'better-sqlite3';
import path from 'node:path'; // Import path for checking

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements (include audioPath)
const insertSessionStmt = prepareStmt('INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, audioPath, status, whisperJobId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const selectAllSessionsStmt = prepareStmt('SELECT * FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT * FROM sessions WHERE id = ?');
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, transcriptPath = ?, audioPath = ?, status = ?, whisperJobId = ? WHERE id = ?`
);
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');

export const sessionRepository = {
    create: (
        metadata: BackendSessionMetadata,
        originalFileName: string, // Changed parameter name for clarity
        transcriptPath: string | null, // Path should be relative or null
        audioIdentifier: string | null, // Changed parameter name - should be relative filename or null
        sessionTimestamp: string // ISO 8601 string
    ): BackendSession => {
        // --- ADDED LOGGING ---
        console.log(`[SessionRepo:create] Received parameters - originalFileName: ${originalFileName}, transcriptPath: ${transcriptPath}, audioIdentifier: ${audioIdentifier}`);
        // --- END LOGGING ---

        // --- ADDED CHECK ---
        // Check if audioIdentifier looks absolute (add a warning/error)
        if (audioIdentifier && path.isAbsolute(audioIdentifier)) {
            console.error(`[SessionRepo:create] FATAL: Received an absolute path for audioIdentifier: ${audioIdentifier}. Attempting to store only filename.`);
            // Attempt to recover by storing only the basename, but this indicates an upstream issue.
            audioIdentifier = path.basename(audioIdentifier);
            console.log(`[SessionRepo:create] Corrected audioIdentifier to (basename only): ${audioIdentifier}`);
            // Alternatively, throw an error:
            // throw new Error(`[SessionRepo:create] FATAL: Received an absolute path for audioIdentifier: ${audioIdentifier}. Expected relative filename.`);
        }
        // Check transcriptPath too
        if (transcriptPath && path.isAbsolute(transcriptPath)) {
             console.error(`[SessionRepo:create] FATAL: Received an absolute path for transcriptPath: ${transcriptPath}. Storing NULL instead.`);
             transcriptPath = null; // Store null if absolute path received
        }
        // --- END CHECK ---


        try {
             if (transcriptPath) {
                 // Check for existing path (should be relative)
                 const existing = findSessionByTranscriptPathStmt.get(transcriptPath);
                 if (existing) throw new Error(`Transcript path ${transcriptPath} already linked.`);
             }
            console.log(`[SessionRepo:create] Executing insert with audioIdentifier: ${audioIdentifier}`); // Log before execution
            const info: RunResult = insertSessionStmt.run(
                originalFileName, // Store original file name for display/reference
                metadata.clientName, metadata.sessionName, sessionTimestamp,
                metadata.sessionType, metadata.therapy, transcriptPath, // Store relative transcript path
                audioIdentifier, // Store relative audio filename/identifier
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
             if (error instanceof Error && error.message.includes('NOT NULL constraint failed')) {
                 console.error("[SessionRepo] CRITICAL: Encountered NOT NULL constraint.");
                 throw new Error(`DB error creating session: NOT NULL constraint failed. ${error}`);
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

    // Update function now accepts the extended partial type including audioPath (relative identifier)
    updateMetadata: (
        id: number,
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; transcriptPath?: string | null; audioPath?: string | null; status?: 'pending' | 'transcribing' | 'completed' | 'failed'; whisperJobId?: string | null; date?: string }>
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) return null;

            // Merge updates
            const updatedData = { ...existingSession, ...metadataUpdate };

             // Ensure paths are relative or null before checking/saving
             if (updatedData.transcriptPath && path.isAbsolute(updatedData.transcriptPath)) {
                 console.warn(`[SessionRepo:update] Attempted to update transcriptPath with absolute path: ${updatedData.transcriptPath}. Storing as NULL.`);
                 updatedData.transcriptPath = null;
             }
             if (updatedData.audioPath && path.isAbsolute(updatedData.audioPath)) {
                 console.warn(`[SessionRepo:update] Attempted to update audioPath with absolute path: ${updatedData.audioPath}. Storing basename only.`);
                 updatedData.audioPath = path.basename(updatedData.audioPath); // Store only filename if absolute path provided
             }

             // Check transcript path conflict (only if path is not null and changed)
             if (updatedData.transcriptPath && updatedData.transcriptPath !== existingSession.transcriptPath) {
                 const existingPath = findSessionByTranscriptPathStmt.get(updatedData.transcriptPath);
                 if (existingPath && (existingPath as BackendSession).id !== id) {
                      throw new Error(`Transcript path ${updatedData.transcriptPath} conflict.`);
                 }
             }

            console.log(`[SessionRepo:update] Executing update for ID ${id} with audioPath: ${updatedData.audioPath}`); // Log before execution
            // Execute the update using all fields, including audioPath (relative identifier)
            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName, updatedData.sessionName, updatedData.date,
                updatedData.sessionType, updatedData.therapy, updatedData.fileName,
                updatedData.transcriptPath, // Relative path or null
                updatedData.audioPath, // Relative filename/identifier or null
                updatedData.status, updatedData.whisperJobId,
                id
            );
            return sessionRepository.findById(id);
        } catch (error) { throw new Error(`DB error updating metadata for session ${id}: ${error}`); }
    },

    deleteById: (id: number): boolean => {
        try {
            // Deletion of associated files handled in sessionRoutes
            const info: RunResult = deleteSessionStmt.run(id);
             return info.changes > 0;
        } catch (error) { throw new Error(`DB error deleting session ${id}: ${error}`); }
    },
};
