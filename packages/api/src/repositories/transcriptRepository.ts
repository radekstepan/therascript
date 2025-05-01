import { db, all, run, get, transaction } from '../db/sqliteService.js';
// Import types for transcript data structures
import type { StructuredTranscript, BackendTranscriptParagraph, TranscriptParagraphData } from '../types/index.js';
// Import better-sqlite3 types for statement handling
import { Statement } from 'better-sqlite3';

// --- SQL Statements ---
const selectParagraphsBySessionIdSql = `
    SELECT id, paragraphIndex, timestampMs, text
    FROM transcript_paragraphs
    WHERE sessionId = ?
    ORDER BY paragraphIndex ASC
`;
const insertParagraphSql = `
    INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text)
    VALUES (?, ?, ?, ?)
`;
const updateParagraphTextSql = `
    UPDATE transcript_paragraphs SET text = ?
    WHERE sessionId = ? AND paragraphIndex = ?
`;
// Note: Usually not needed due to ON DELETE CASCADE constraint on the foreign key in chats table
const deleteParagraphsBySessionIdSql = `
    DELETE FROM transcript_paragraphs WHERE sessionId = ?
`;
// --- End SQL Statements ---

// --- Prepared Statements Cache ---
// Prepare statements once for better performance and safety against SQL injection
let selectParagraphsStmt: Statement | null = null;
let insertParagraphStmt: Statement | null = null;
let updateParagraphStmt: Statement | null = null;
let deleteParagraphsStmt: Statement | null = null;

try {
    selectParagraphsStmt = db.prepare(selectParagraphsBySessionIdSql);
    insertParagraphStmt = db.prepare(insertParagraphSql);
    updateParagraphStmt = db.prepare(updateParagraphTextSql);
    deleteParagraphsStmt = db.prepare(deleteParagraphsBySessionIdSql);
} catch (e) {
    console.error("FATAL: Failed to prepare transcript repository statements:", e);
    // Decide how to handle this - maybe re-throw or exit, as the repo is unusable without statements
    throw new Error("Failed to prepare database transcript statements.");
}
// --- End Prepared Statements Cache ---

export const transcriptRepository = {
    /**
     * Finds all transcript paragraphs for a given session ID, ordered by paragraph index.
     *
     * @param sessionId The ID of the session.
     * @returns An array of StructuredTranscript items (matching {id, timestamp, text} structure for API).
     * @throws If the select statement wasn't prepared or a DB error occurs.
     */
    findParagraphsBySessionId: (sessionId: number): StructuredTranscript => {
        if (!selectParagraphsStmt) throw new Error("Select paragraphs statement not prepared.");
        try {
            // Fetch rows matching the BackendTranscriptParagraph structure
            const rows = selectParagraphsStmt.all(sessionId) as BackendTranscriptParagraph[];
            // Map DB structure to API/internal structure ({id, timestamp, text})
            // Note: Uses paragraphIndex from DB as the logical 'id' for the API response.
            return rows.map(row => ({
                id: row.paragraphIndex,
                timestamp: row.timestampMs,
                text: row.text
            }));
        } catch (error) {
            console.error(`[TranscriptRepo] Error fetching paragraphs for session ${sessionId}:`, error);
            throw new Error(`Database error fetching transcript paragraphs for session ${sessionId}.`);
        }
    },

    /**
     * Inserts multiple transcript paragraphs for a session within a single database transaction.
     * Assumes existing paragraphs for the session are deleted or handled beforehand if needed.
     * Uses the structured format {id, timestamp, text} where 'id' maps to paragraphIndex
     * and 'timestamp' maps to timestampMs.
     *
     * @param sessionId The ID of the session.
     * @param paragraphs An array of StructuredTranscript items (containing id, timestamp, text) to insert.
     * @throws If the insert statement wasn't prepared, or a DB error occurs (transaction will rollback).
     */
    insertParagraphs: transaction((sessionId: number, paragraphs: StructuredTranscript): void => {
        if (!insertParagraphStmt) throw new Error("Insert paragraph statement not prepared.");
        if (!paragraphs || paragraphs.length === 0) {
            console.warn(`[TranscriptRepo] Attempted to insert empty paragraphs for session ${sessionId}.`);
            return; // Do nothing if the array is empty
        }
        try {
            // Input paragraphs use 'id' for paragraphIndex and 'timestamp' for timestampMs
            for (const para of paragraphs) { // para is of type TranscriptParagraphData
                // Execute the prepared insert statement with mapped values
                insertParagraphStmt.run(sessionId, para.id, para.timestamp, para.text);
            }
            console.log(`[TranscriptRepo] Inserted ${paragraphs.length} paragraphs for session ${sessionId}.`);
        } catch (error) {
            console.error(`[TranscriptRepo] Error inserting paragraphs for session ${sessionId}:`, error);
            // Transaction automatically rolls back on error, no explicit rollback needed here
            throw new Error(`Database error inserting transcript paragraphs for session ${sessionId}.`);
        }
    }),

    /**
     * Updates the text content of a specific paragraph within a session.
     * Identified by sessionId and paragraphIndex.
     *
     * @param sessionId The ID of the session.
     * @param paragraphIndex The index of the paragraph to update (maps to paragraphIndex column).
     * @param newText The new text content for the paragraph.
     * @returns True if the update was successful (affected 1 row), false otherwise (e.g., paragraph not found).
     * @throws If the update statement wasn't prepared or a DB error occurs.
     */
    updateParagraphText: (sessionId: number, paragraphIndex: number, newText: string): boolean => {
        if (!updateParagraphStmt) throw new Error("Update paragraph statement not prepared.");
        try {
            // Execute the prepared update statement
            const info = updateParagraphStmt.run(newText, sessionId, paragraphIndex);
            const success = info.changes > 0; // Check if any rows were affected
            if (success) {
                console.log(`[TranscriptRepo] Updated paragraph ${paragraphIndex} for session ${sessionId}. FTS trigger should have fired.`);
            } else {
                 console.warn(`[TranscriptRepo] No paragraph found to update for session ${sessionId}, index ${paragraphIndex}.`);
            }
            return success;
        } catch (error) {
            console.error(`[TranscriptRepo] Error updating paragraph ${paragraphIndex} for session ${sessionId}:`, error);
            throw new Error(`Database error updating transcript paragraph ${paragraphIndex} for session ${sessionId}.`);
        }
    },

    /**
     * Retrieves the concatenated text of all paragraphs for a session, ordered by paragraph index.
     * Paragraphs are joined by double newlines.
     *
     * @param sessionId The ID of the session.
     * @returns A single string containing the full transcript text.
     * @throws If the select statement wasn't prepared or a DB error occurs.
     */
    getTranscriptTextForSession: (sessionId: number): string => {
        if (!selectParagraphsStmt) throw new Error("Select paragraphs statement not prepared.");
        try {
            // Fetch all paragraphs for the session
            const rows = selectParagraphsStmt.all(sessionId) as BackendTranscriptParagraph[];
            // Map to get only the text and join with double newlines
            return rows.map(p => p.text).join('\n\n');
        } catch (error) {
            console.error(`[TranscriptRepo] Error fetching transcript text for session ${sessionId}:`, error);
            throw new Error(`Database error fetching transcript text for session ${sessionId}.`);
        }
    },

    /**
     * Deletes all transcript paragraphs associated with a specific session ID.
     * NOTE: This is generally **not required** if the `ON DELETE CASCADE` constraint
     * is correctly set on the `transcript_paragraphs.sessionId` foreign key, as SQLite
     * will handle the deletion automatically when the parent session is deleted.
     *
     * @param sessionId The ID of the session whose paragraphs should be deleted.
     * @returns True if any rows were deleted, false otherwise.
     * @throws If the delete statement wasn't prepared or a DB error occurs.
     */
    deleteParagraphsBySessionId: (sessionId: number): boolean => {
        if (!deleteParagraphsStmt) throw new Error("Delete paragraphs statement not prepared.");
        try {
            // Execute the prepared delete statement
            const info = deleteParagraphsStmt.run(sessionId);
            console.log(`[TranscriptRepo] Deleted ${info.changes} paragraphs for session ${sessionId}.`);
            return info.changes > 0; // Return true if deletion occurred
        } catch (error) {
            console.error(`[TranscriptRepo] Error deleting paragraphs for session ${sessionId}:`, error);
            throw new Error(`Database error deleting transcript paragraphs for session ${sessionId}.`);
        }
    },
};
