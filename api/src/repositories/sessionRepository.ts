// src/repositories/sessionRepository.ts
import { db } from '../db/sqliteService.js'; // ADDED .js
import type { BackendSession, BackendSessionMetadata } from '../types/index.js'; // ADDED .js
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements
const insertSessionStmt = prepareStmt('INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath) VALUES (?, ?, ?, ?, ?, ?, ?)');
const selectAllSessionsStmt = prepareStmt('SELECT * FROM sessions ORDER BY date DESC, id DESC');
const selectSessionByIdStmt = prepareStmt('SELECT * FROM sessions WHERE id = ?');
const updateSessionMetadataStmt = prepareStmt(
    `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, transcriptPath = ? WHERE id = ?`
);
const deleteSessionStmt = prepareStmt('DELETE FROM sessions WHERE id = ?');
const findSessionByTranscriptPathStmt = prepareStmt('SELECT * FROM sessions WHERE transcriptPath = ?');


export const sessionRepository = {
    create: (
        metadata: BackendSessionMetadata,
        fileName: string,
        transcriptPath: string
    ): BackendSession => {
        try {
             const existing = findSessionByTranscriptPathStmt.get(transcriptPath);
             if (existing) throw new Error(`Transcript path ${transcriptPath} already linked.`);

            const info: RunResult = insertSessionStmt.run(
                fileName, metadata.clientName, metadata.sessionName, metadata.date,
                metadata.sessionType, metadata.therapy, transcriptPath
            );
            const newId = info.lastInsertRowid as number;
            const newSession = sessionRepository.findById(newId);
            if (!newSession) throw new Error(`Failed retrieve session ${newId}`);
            return newSession;
        } catch (error) { throw new Error(`DB error creating session: ${error}`); }
    },

    findAll: (): BackendSession[] => {
        try { return selectAllSessionsStmt.all() as BackendSession[]; }
        catch (error) { throw new Error(`DB error fetching sessions: ${error}`); }
    },

    findById: (id: number): BackendSession | null => {
         try {
            const session = selectSessionByIdStmt.get(id) as BackendSession | undefined;
            return session ?? null;
        } catch (error) { throw new Error(`DB error fetching session: ${error}`); }
    },

    updateMetadata: (
        id: number,
        metadataUpdate: Partial<BackendSessionMetadata & { fileName?: string; transcriptPath?: string }>
    ): BackendSession | null => {
         try {
            const existingSession = sessionRepository.findById(id);
            if (!existingSession) return null; // Not found

            const updatedData = { ...existingSession, ...metadataUpdate };

             if (metadataUpdate.transcriptPath && metadataUpdate.transcriptPath !== existingSession.transcriptPath) {
                 const existingPath = findSessionByTranscriptPathStmt.get(metadataUpdate.transcriptPath);
                 if (existingPath && (existingPath as BackendSession).id !== id) { // Check it's not the same session
                      throw new Error(`Transcript path ${metadataUpdate.transcriptPath} conflict.`);
                 }
             }

            const info: RunResult = updateSessionMetadataStmt.run(
                updatedData.clientName, updatedData.sessionName, updatedData.date,
                updatedData.sessionType, updatedData.therapy, updatedData.fileName,
                updatedData.transcriptPath, id
            );
            // Refetch to return the updated record, even if changes = 0
            return sessionRepository.findById(id);
        } catch (error) { throw new Error(`DB error updating metadata: ${error}`); }
    },

    deleteById: (id: number): boolean => {
        try {
            const info: RunResult = deleteSessionStmt.run(id);
             return info.changes > 0;
        } catch (error) { throw new Error(`DB error deleting session: ${error}`); }
    },
};
