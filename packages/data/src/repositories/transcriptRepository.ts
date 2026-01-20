import {
  db,
  all,
  run,
  get,
  transaction,
  type DbStatement,
} from '@therascript/db';
import type {
  StructuredTranscript,
  BackendTranscriptParagraph,
  TranscriptParagraphData,
} from '@therascript/domain';

let _selectParagraphsStmt: DbStatement | null = null;
const selectParagraphsStmt = (): DbStatement => {
  if (!_selectParagraphsStmt) {
    _selectParagraphsStmt = db.prepare(`
      SELECT id, paragraphIndex, timestampMs, text
      FROM transcript_paragraphs
      WHERE sessionId = ?
      ORDER BY paragraphIndex ASC
    `);
  }
  return _selectParagraphsStmt;
};

const selectAllParagraphsStmt = (): DbStatement => {
  return db.prepare(
    'SELECT * FROM transcript_paragraphs ORDER BY sessionId, paragraphIndex ASC'
  );
};

let _insertParagraphStmt: DbStatement | null = null;
const insertParagraphStmt = (): DbStatement => {
  if (!_insertParagraphStmt) {
    _insertParagraphStmt = db.prepare(`
      INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text)
      VALUES (?, ?, ?, ?)
    `);
  }
  return _insertParagraphStmt;
};

let _updateParagraphStmt: DbStatement | null = null;
const updateParagraphStmt = (): DbStatement => {
  if (!_updateParagraphStmt) {
    _updateParagraphStmt = db.prepare(`
      UPDATE transcript_paragraphs SET text = ?
      WHERE sessionId = ? AND paragraphIndex = ?
    `);
  }
  return _updateParagraphStmt;
};

let _deleteParagraphByIndexStmt: DbStatement | null = null;
const deleteParagraphByIndexStmt = (): DbStatement => {
  if (!_deleteParagraphByIndexStmt) {
    _deleteParagraphByIndexStmt = db.prepare(
      `DELETE FROM transcript_paragraphs WHERE sessionId = ? AND paragraphIndex = ?`
    );
  }
  return _deleteParagraphByIndexStmt;
};

let _deleteParagraphsStmt: DbStatement | null = null;
const deleteParagraphsStmt = (): DbStatement => {
  if (!_deleteParagraphsStmt) {
    _deleteParagraphsStmt = db.prepare(
      `DELETE FROM transcript_paragraphs WHERE sessionId = ?`
    );
  }
  return _deleteParagraphsStmt;
};

export const transcriptRepository = {
  findParagraphsBySessionId: (sessionId: number): StructuredTranscript => {
    try {
      const rows = selectParagraphsStmt().all(
        sessionId
      ) as BackendTranscriptParagraph[];
      return rows.map((row) => ({
        id: row.paragraphIndex,
        timestamp: row.timestampMs,
        text: row.text,
      }));
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error fetching paragraphs for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error fetching transcript paragraphs for session ${sessionId}.`
      );
    }
  },

  findAll: (): BackendTranscriptParagraph[] => {
    try {
      return selectAllParagraphsStmt().all() as BackendTranscriptParagraph[];
    } catch (error) {
      console.error(`[TranscriptRepo] Error fetching all paragraphs:`, error);
      throw new Error('Database error fetching all transcript paragraphs.');
    }
  },

  insertParagraphs: (
    sessionId: number,
    paragraphs: StructuredTranscript
  ): void => {
    if (!paragraphs || paragraphs.length === 0) {
      console.warn(
        `[TranscriptRepo] Attempted to insert empty paragraphs for session ${sessionId}.`
      );
      return;
    }
    try {
      const insertTx = db.transaction(
        (items: { sessionId: number; paragraphs: StructuredTranscript }) => {
          const stmt = insertParagraphStmt();
          for (const para of items.paragraphs) {
            stmt.run(items.sessionId, para.id, para.timestamp, para.text);
          }
        }
      );
      insertTx({ sessionId, paragraphs });
      console.log(
        `[TranscriptRepo] Inserted ${paragraphs.length} paragraphs for session ${sessionId}.`
      );
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error inserting paragraphs for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error inserting transcript paragraphs for session ${sessionId}.`
      );
    }
  },

  updateParagraphText: (
    sessionId: number,
    paragraphIndex: number,
    newText: string
  ): boolean => {
    try {
      const info = updateParagraphStmt().run(
        newText,
        sessionId,
        paragraphIndex
      );
      const success = info.changes > 0;
      if (success) {
        console.log(
          `[TranscriptRepo] Updated paragraph ${paragraphIndex} for session ${sessionId}. FTS trigger should have fired.`
        );
      } else {
        console.warn(
          `[TranscriptRepo] No paragraph found to update for session ${sessionId}, index ${paragraphIndex}.`
        );
      }
      return success;
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error updating paragraph ${paragraphIndex} for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error updating transcript paragraph ${paragraphIndex} for session ${sessionId}.`
      );
    }
  },

  deleteParagraphByIndex: (
    sessionId: number,
    paragraphIndex: number
  ): boolean => {
    try {
      const info = deleteParagraphByIndexStmt().run(sessionId, paragraphIndex);
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error deleting paragraph ${paragraphIndex} for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error deleting paragraph ${paragraphIndex} for session ${sessionId}.`
      );
    }
  },

  getTranscriptTextForSession: (sessionId: number): string => {
    try {
      const rows = selectParagraphsStmt().all(
        sessionId
      ) as BackendTranscriptParagraph[];
      return rows.map((p) => p.text).join('\n\n');
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error fetching transcript text for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error fetching transcript text for session ${sessionId}.`
      );
    }
  },

  deleteParagraphsBySessionId: (sessionId: number): boolean => {
    try {
      const info = deleteParagraphsStmt().run(sessionId);
      console.log(
        `[TranscriptRepo] Deleted ${info.changes} paragraphs for session ${sessionId}.`
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[TranscriptRepo] Error deleting paragraphs for session ${sessionId}:`,
        error
      );
      throw new Error(
        `Database error deleting transcript paragraphs for session ${sessionId}.`
      );
    }
  },
};
