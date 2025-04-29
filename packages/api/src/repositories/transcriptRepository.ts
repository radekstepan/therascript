import { db, all, run, get, transaction } from '../db/sqliteService.js';
import type { StructuredTranscript, BackendTranscriptParagraph, TranscriptParagraphData } from '../types/index.js'; // Added TranscriptParagraphData
import { Statement } from 'better-sqlite3';

// --- SQL Statements ---
const selectParagraphsBySessionIdSql = 'SELECT id, paragraphIndex, timestampMs, text FROM transcript_paragraphs WHERE sessionId = ? ORDER BY paragraphIndex ASC';
const insertParagraphSql = 'INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text) VALUES (?, ?, ?, ?)';
const updateParagraphTextSql = 'UPDATE transcript_paragraphs SET text = ? WHERE sessionId = ? AND paragraphIndex = ?';
const deleteParagraphsBySessionIdSql = 'DELETE FROM transcript_paragraphs WHERE sessionId = ?'; // Optional, CASCADE handles it

// Prepare statements once
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
    // Decide how to handle this - maybe re-throw or exit
    throw new Error("Failed to prepare database transcript statements.");
}

export const transcriptRepository = {
    /**
     * Finds all transcript paragraphs for a given session ID, ordered by paragraph index.
     * @param sessionId The ID of the session.
     * @returns An array of StructuredTranscript items (matching {id, timestamp, text} structure for API).
     */
     // --- FIX: Correct return type to StructuredTranscript ---
    findParagraphsBySessionId: (sessionId: number): StructuredTranscript => {
        if (!selectParagraphsStmt) throw new Error("Select paragraphs statement not prepared.");
        try {
            const rows = selectParagraphsStmt.all(sessionId) as BackendTranscriptParagraph[];
            // Map DB structure to API/internal structure ({id, timestamp, text})
            return rows.map(row => ({
                id: row.paragraphIndex, // Use paragraphIndex as the logical ID for the API
                timestamp: row.timestampMs,
                text: row.text
            }));
        } catch (error) {
            console.error(`[TranscriptRepo] Error fetching paragraphs for session ${sessionId}:`, error);
            throw new Error(`Database error fetching transcript paragraphs for session ${sessionId}.`);
        }
    },

    /**
     * Inserts multiple transcript paragraphs for a session within a transaction.
     * Assumes existing paragraphs for the session are deleted or handled beforehand if needed.
     * @param sessionId The ID of the session.
     * @param paragraphs An array of StructuredTranscript items to insert.
     */
     // --- FIX: Correct parameter type to StructuredTranscript ---
    insertParagraphs: transaction((sessionId: number, paragraphs: StructuredTranscript): void => {
        if (!insertParagraphStmt) throw new Error("Insert paragraph statement not prepared.");
        if (!paragraphs || paragraphs.length === 0) {
            console.warn(`[TranscriptRepo] Attempted to insert empty paragraphs for session ${sessionId}.`);
            return;
        }
        try {
            // The input paragraphs use 'id' for the paragraphIndex and 'timestamp' for timestampMs
            // --- FIX: loop variable `para` is now TranscriptParagraphData ---
            for (const para of paragraphs) { // para is now TranscriptParagraphData
                insertParagraphStmt.run(sessionId, para.id, para.timestamp, para.text);
            }
            console.log(`[TranscriptRepo] Inserted ${paragraphs.length} paragraphs for session ${sessionId}.`);
        } catch (error) {
            console.error(`[TranscriptRepo] Error inserting paragraphs for session ${sessionId}:`, error);
            // Transaction automatically rolls back on error
            throw new Error(`Database error inserting transcript paragraphs for session ${sessionId}.`);
        }
    }),

    /**
     * Updates the text of a specific paragraph within a session.
     * @param sessionId The ID of the session.
     * @param paragraphIndex The index of the paragraph to update.
     * @param newText The new text content for the paragraph.
     * @returns True if the update was successful (affected 1 row), false otherwise.
     */
    updateParagraphText: (sessionId: number, paragraphIndex: number, newText: string): boolean => {
        if (!updateParagraphStmt) throw new Error("Update paragraph statement not prepared.");
        try {
            const info = updateParagraphStmt.run(newText, sessionId, paragraphIndex);
            const success = info.changes > 0;
            if (success) {
                console.log(`[TranscriptRepo] Updated paragraph ${paragraphIndex} for session ${sessionId}.`);
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
     * Retrieves the concatenated text of all paragraphs for a session.
     * @param sessionId The ID of the session.
     * @returns A single string containing the full transcript text, paragraphs separated by double newlines.
     */
    getTranscriptTextForSession: (sessionId: number): string => {
        if (!selectParagraphsStmt) throw new Error("Select paragraphs statement not prepared.");
        try {
            const rows = selectParagraphsStmt.all(sessionId) as BackendTranscriptParagraph[];
            return rows.map(p => p.text).join('\n\n');
        } catch (error) {
            console.error(`[TranscriptRepo] Error fetching transcript text for session ${sessionId}:`, error);
            throw new Error(`Database error fetching transcript text for session ${sessionId}.`);
        }
    },

    /**
     * Deletes all transcript paragraphs associated with a specific session ID.
     * NOTE: Usually not required if ON DELETE CASCADE is set on the foreign key.
     * @param sessionId The ID of the session whose paragraphs should be deleted.
     * @returns True if any rows were deleted, false otherwise.
     */
    deleteParagraphsBySessionId: (sessionId: number): boolean => {
        if (!deleteParagraphsStmt) throw new Error("Delete paragraphs statement not prepared.");
        try {
            const info = deleteParagraphsStmt.run(sessionId);
            console.log(`[TranscriptRepo] Deleted ${info.changes} paragraphs for session ${sessionId}.`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[TranscriptRepo] Error deleting paragraphs for session ${sessionId}:`, error);
            throw new Error(`Database error deleting transcript paragraphs for session ${sessionId}.`);
        }
    },
};
