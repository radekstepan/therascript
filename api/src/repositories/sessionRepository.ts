// src/repositories/sessionRepository.ts
import { db } from '../db/sqliteService'; // Relative
import type { BackendSession, BackendSessionMetadata } from '../types'; // Relative
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try {
        return db.prepare(sql);
    } catch (error) {
        console.error(`[db]: Failed to prepare statement: ${sql}`, error);
        throw new Error('Database statement preparation failed.');
    }
};


// Prepare statements
const insertSessionStmt = prepareStmt(
    'INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const selectAllSessionsStmt = prepareStmt('SELECT * FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT * FROM sessions WHERE id = ?');
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions
     SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, transcriptPath = ?
     WHERE id = ?` // Also allow updating fileName and transcriptPath if needed, though less common for metadata update
);
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');


export const sessionRepository = {
    // Use transaction for creation if multiple steps were involved
    create: (
        metadata: BackendSessionMetadata,
        fileName: string,
        transcriptPath: string
    ): BackendSession => {
        try {
            // Check if transcriptPath already exists (UNIQUE constraint)
             const existing = findSessionByTranscriptPathStmt.get(transcriptPath);
             if (existing) {
                 throw new Error(`Transcript path ${transcriptPath} is already linked to session ID ${ (existing as BackendSession).id }. Cannot create duplicate.`);
             }

            const info: RunResult = insertSessionStmt.run(
                fileName,
                metadata.clientName,
                metadata.sessionName,
                metadata.date,
                metadata.sessionType,
                metadata.therapy,
                transcriptPath
            );
            const newId = info.lastInsertRowid as number;
            const newSession = sessionRepository.findById(newId);
            if (!newSession) {
                 throw new Error(`Failed to retrieve session immediately after creation (ID: ${newId})`);
            }
            console.log(`[db]: Created session ${newId}`);
            return newSession;
        } catch (error) {
            console.error('[db]: Error creating session:', error);
            throw new Error('Database error during session creation.'); // More specific error
        }
    },

    findAll: (): BackendSession[] => {
        try {
            return selectAllSessionsStmt.all() as BackendSession[];
        } catch (error) {
             console.error('[db]: Error finding all sessions:', error);
             throw new Error('Database error fetching sessions.');
        }
    },

    findById: (id: number): BackendSession | null => {
         try {
            const session = selectSessionByIdStmt.get(id) as BackendSession | undefined;
            return session ?? null;
        } catch (error) {
             console.error(`[db]: Error finding session by ID ${id}:`, error);
             throw new Error('Database error fetching session.');
        }
    },

    // Update function remains complex due to merging partial data
    updateMetadata: (
        id: number,
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; transcriptPath?: string }>
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) {
                console.warn(`[db]: Session ${id} not found for metadata update.`);
                return null;
            }

            // Merge updates with existing data
            const updatedData = { ...existingSession, ...metadataUpdate };

             // Check for transcriptPath uniqueness if it's being updated
             if (metadataUpdate.transcriptPath && metadataUpdate.transcriptPath !== existingSession.transcriptPath) {
                 const existing = findSessionByTranscriptPathStmt.get(metadataUpdate.transcriptPath);
                 if (existing) {
                     throw new Error(`Transcript path ${metadataUpdate.transcriptPath} is already linked to session ID ${ (existing as BackendSession).id }. Cannot update.`);
                 }
             }


            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName,
                updatedData.sessionName,
                updatedData.date,
                updatedData.sessionType,
                updatedData.therapy,
                updatedData.fileName, // Include filename
                updatedData.transcriptPath, // Include transcriptPath
                id
            );

            if (info.changes > 0) {
                console.log(`[db]: Updated metadata for session ${id}`);
                // Return the newly fetched data to confirm update
                return sessionRepository.findById(id);
            } else {
                console.warn(`[db]: No changes made when updating metadata for session ${id}.`);
                return existingSession; // Return existing if no DB changes occurred
            }
        } catch (error) {
             console.error(`[db]: Error updating metadata for session ${id}:`, error);
             throw new Error('Database error during metadata update.');
        }
    },

    deleteById: (id: number): boolean => {
        try {
            // Note: ON DELETE CASCADE handles chats and messages deletion in SQLite
            const info: RunResult = deleteSessionStmt.run(id);
             if (info.changes > 0) {
                 console.log(`[db]: Deleted session ${id} and associated chats/messages.`);
                 return true;
             } else {
                 console.warn(`[db]: Session ${id} not found for deletion.`);
                 return false;
             }
        } catch (error) {
             console.error(`[db]: Error deleting session ${id}:`, error);
             throw new Error('Database error during session deletion.');
        }
    },
};
