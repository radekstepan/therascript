import { db } from '../db/sqliteService.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { Statement, RunResult } from 'better-sqlite3';
import path from 'node:path'; // Import path for checking

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements (removed transcriptPath)
const insertSessionStmt = prepareStmt('INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const selectAllSessionsStmt = prepareStmt('SELECT id, fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT id, fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount FROM sessions WHERE id = ?');
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, audioPath = ?, status = ?, whisperJobId = ?, transcriptTokenCount = ? WHERE id = ?`
);
// SQL statement to delete a session by ID. Foreign key constraints handle related chats/messages/paragraphs.
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
// --- Removed findSessionByTranscriptPathStmt ---
// const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');
// *** ADDED Statement to find session by audioPath ***
const findSessionByAudioPathStmt = prepareStmt('SELECT * FROM sessions WHERE audioPath = ?');

export const sessionRepository = {
    create: (
        metadata: BackendSessionMetadata,
        originalFileName: string, // Changed parameter name for clarity
        // --- Removed transcriptPath parameter ---
        // transcriptPath: string | null, // Path should be relative or null
        audioIdentifier: string | null, // Changed parameter name - should be relative filename or null
        sessionTimestamp: string // ISO 8601 string
    ): BackendSession => {
        console.log(`[SessionRepo:create] Received parameters - originalFileName: ${originalFileName}, audioIdentifier: ${audioIdentifier}`);

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
        // --- Removed transcriptPath checks ---
        // --- END CHECK ---


        try {
             // --- Removed transcriptPath existence check ---
             // *** ADDED Check for existing audio path ***
             if (audioIdentifier) {
                 const existingAudio = findSessionByAudioPathStmt.get(audioIdentifier);
                 if (existingAudio) {
                     // This should ideally not happen if identifiers are unique, but good to check.
                     throw new Error(`Audio identifier ${audioIdentifier} already linked to session ${(existingAudio as BackendSession).id}.`);
                 }
             }
            console.log(`[SessionRepo:create] Executing insert with audioIdentifier: ${audioIdentifier}`); // Log before execution
            const info: RunResult = insertSessionStmt.run(
                originalFileName, // Store original file name for display/reference
                metadata.clientName, metadata.sessionName, sessionTimestamp,
                metadata.sessionType, metadata.therapy,
                // --- Removed transcriptPath ---
                audioIdentifier, // Store relative audio filename/identifier
                'pending', // Default status
                null,       // Default whisperJobId
                null        // Default transcriptTokenCount
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

    // Update function now accepts the extended partial type including audioPath (relative identifier) and token count
    // REMOVED transcriptPath from update type
    updateMetadata: (
        id: number,
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; audioPath?: string | null; status?: 'pending' | 'transcribing' | 'completed' | 'failed'; whisperJobId?: string | null; date?: string; transcriptTokenCount?: number | null }> // <-- Added transcriptTokenCount, Removed transcriptPath
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) return null;

            // Merge updates
            const updatedData = { ...existingSession, ...metadataUpdate };

             // Ensure paths are relative or null before checking/saving
             // --- Removed transcriptPath check ---
             if (updatedData.audioPath && path.isAbsolute(updatedData.audioPath)) {
                 console.warn(`[SessionRepo:update] Attempted to update audioPath with absolute path: ${updatedData.audioPath}. Storing basename only.`);
                 updatedData.audioPath = path.basename(updatedData.audioPath); // Store only filename if absolute path provided
             }

             // --- Removed transcriptPath conflict check ---
             // *** ADDED Check for audio path conflict ***
              if (updatedData.audioPath && updatedData.audioPath !== existingSession.audioPath) {
                  const existingAudio = findSessionByAudioPathStmt.get(updatedData.audioPath);
                  if (existingAudio && (existingAudio as BackendSession).id !== id) {
                      throw new Error(`Audio identifier ${updatedData.audioPath} conflict with session ${(existingAudio as BackendSession).id}.`);
                  }
              }

            console.log(`[SessionRepo:update] Executing update for ID ${id} with audioPath: ${updatedData.audioPath}, tokenCount: ${updatedData.transcriptTokenCount ?? 'N/A'}`); // Log before execution
            // Execute the update using all fields, including audioPath (relative identifier) and token count
            // REMOVED transcriptPath from update
            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName, updatedData.sessionName, updatedData.date,
                updatedData.sessionType, updatedData.therapy, updatedData.fileName,
                // --- Removed transcriptPath ---
                updatedData.audioPath, // Relative filename/identifier or null
                updatedData.status, updatedData.whisperJobId,
                updatedData.transcriptTokenCount, // <-- Pass token count
                id
            );
            if (info.changes === 0) {
                console.warn(`[SessionRepo:update] Update for session ${id} resulted in 0 changes.`);
            }
            return sessionRepository.findById(id);
        } catch (error) { throw new Error(`DB error updating metadata for session ${id}: ${error}`); }
    },

    // Performs a hard delete on the session record.
    // Associated audio files should be deleted separately in the service/route layer.
    // Related chat/message/paragraph records are deleted automatically due to `ON DELETE CASCADE`.
    deleteById: (id: number): boolean => {
        try {
            console.log(`[SessionRepo:deleteById] Executing DELETE for session ID: ${id}`);
            const info: RunResult = deleteSessionStmt.run(id);
            console.log(`[SessionRepo:deleteById] Delete result for session ID ${id}: ${info.changes} row(s) affected.`);
            return info.changes > 0;
        } catch (error) {
             console.error(`[SessionRepo:deleteById] Error deleting session ${id}:`, error);
             throw new Error(`DB error deleting session ${id}: ${error}`);
        }
    },
};
