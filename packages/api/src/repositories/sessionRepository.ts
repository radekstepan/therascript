import { db, type DbStatement, type DbRunResult } from '@therascript/db';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import path from 'node:path'; // Import path for checking

// --- Lazy Statement Getters ---
let _insertSessionStmt: DbStatement | null = null;
const insertSessionStmt = (): DbStatement => {
  if (!_insertSessionStmt) {
    _insertSessionStmt = db.prepare(
      'INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
  }
  return _insertSessionStmt;
};

let _selectAllSessionsStmt: DbStatement | null = null;
const selectAllSessionsStmt = (): DbStatement => {
  if (!_selectAllSessionsStmt) {
    _selectAllSessionsStmt = db.prepare(
      'SELECT id, fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount FROM sessions ORDER BY date DESC, id DESC'
    );
  }
  return _selectAllSessionsStmt;
};

let _selectSessionByIdStmt: DbStatement | null = null;
const selectSessionByIdStmt = (): DbStatement => {
  if (!_selectSessionByIdStmt) {
    _selectSessionByIdStmt = db.prepare(
      'SELECT id, fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount FROM sessions WHERE id = ?'
    );
  }
  return _selectSessionByIdStmt;
};

let _updateSessionMetadataStmt: DbStatement | null = null;
const updateSessionMetadataStmt = (): DbStatement => {
  if (!_updateSessionMetadataStmt) {
    _updateSessionMetadataStmt = db.prepare(
      `UPDATE sessions SET clientName = ?, sessionName = ?, date = ?, sessionType = ?, therapy = ?, fileName = ?, audioPath = ?, status = ?, whisperJobId = ?, transcriptTokenCount = ? WHERE id = ?`
    );
  }
  return _updateSessionMetadataStmt;
};

let _deleteSessionStmt: DbStatement | null = null;
const deleteSessionStmt = (): DbStatement => {
  if (!_deleteSessionStmt) {
    _deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  }
  return _deleteSessionStmt;
};

let _findSessionByAudioPathStmt: DbStatement | null = null;
const findSessionByAudioPathStmt = (): DbStatement => {
  if (!_findSessionByAudioPathStmt) {
    _findSessionByAudioPathStmt = db.prepare(
      'SELECT * FROM sessions WHERE audioPath = ?'
    );
  }
  return _findSessionByAudioPathStmt;
};
// --- End Lazy Statement Getters ---

export const sessionRepository = {
  create: (
    metadata: BackendSessionMetadata,
    originalFileName: string,
    audioIdentifier: string | null,
    sessionTimestamp: string
  ): BackendSession => {
    console.log(
      `[SessionRepo:create] Received parameters - originalFileName: ${originalFileName}, audioIdentifier: ${audioIdentifier}`
    );

    if (audioIdentifier && path.isAbsolute(audioIdentifier)) {
      console.error(
        `[SessionRepo:create] FATAL: Received an absolute path for audioIdentifier: ${audioIdentifier}. Attempting to store only filename.`
      );
      audioIdentifier = path.basename(audioIdentifier);
      console.log(
        `[SessionRepo:create] Corrected audioIdentifier to (basename only): ${audioIdentifier}`
      );
    }

    try {
      if (audioIdentifier) {
        const existingAudio = findSessionByAudioPathStmt().get(audioIdentifier);
        if (existingAudio) {
          throw new Error(
            `Audio identifier ${audioIdentifier} already linked to session ${(existingAudio as BackendSession).id}.`
          );
        }
      }
      console.log(
        `[SessionRepo:create] Executing insert with audioIdentifier: ${audioIdentifier}`
      );
      const info: DbRunResult = insertSessionStmt().run(
        originalFileName,
        metadata.clientName,
        metadata.sessionName,
        sessionTimestamp,
        metadata.sessionType,
        metadata.therapy,
        audioIdentifier,
        'pending',
        null,
        null
      );
      const newId = info.lastInsertRowid as number;
      console.log(`[SessionRepo:create] Insert successful. New ID: ${newId}`);
      const newSession = sessionRepository.findById(newId);
      if (!newSession)
        throw new Error(
          `Failed retrieve session ${newId} immediately after creation.`
        );
      return newSession;
    } catch (error) {
      console.error(`[SessionRepo] Error in create: ${error}`);
      if (
        error instanceof Error &&
        error.message.includes('NOT NULL constraint failed')
      ) {
        console.error(
          '[SessionRepo] CRITICAL: Encountered NOT NULL constraint.'
        );
        throw new Error(
          `DB error creating session: NOT NULL constraint failed. ${error}`
        );
      }
      throw new Error(`DB error creating session: ${error}`);
    }
  },

  findAll: (): BackendSession[] => {
    try {
      return selectAllSessionsStmt().all() as BackendSession[];
    } catch (error) {
      throw new Error(`DB error fetching sessions: ${error}`);
    }
  },

  findById: (id: number): BackendSession | null => {
    try {
      const session = selectSessionByIdStmt().get(id) as
        | BackendSession
        | undefined;
      return session ?? null;
    } catch (error) {
      throw new Error(`DB error fetching session ${id}: ${error}`);
    }
  },

  updateMetadata: (
    id: number,
    metadataUpdate: Partial<
      BackendSessionMetadata & {
        fileName?: string;
        audioPath?: string | null;
        status?: 'pending' | 'transcribing' | 'completed' | 'failed';
        whisperJobId?: string | null;
        date?: string;
        transcriptTokenCount?: number | null;
      }
    >
  ): BackendSession | null => {
    try {
      const existingSession = sessionRepository.findById(id);
      if (!existingSession) return null;

      const updatedData = { ...existingSession, ...metadataUpdate };

      if (updatedData.audioPath && path.isAbsolute(updatedData.audioPath)) {
        console.warn(
          `[SessionRepo:update] Attempted to update audioPath with absolute path: ${updatedData.audioPath}. Storing basename only.`
        );
        updatedData.audioPath = path.basename(updatedData.audioPath);
      }

      if (
        updatedData.audioPath &&
        updatedData.audioPath !== existingSession.audioPath
      ) {
        const existingAudio = findSessionByAudioPathStmt().get(
          updatedData.audioPath
        );
        if (existingAudio && (existingAudio as BackendSession).id !== id) {
          throw new Error(
            `Audio identifier ${updatedData.audioPath} conflict with session ${(existingAudio as BackendSession).id}.`
          );
        }
      }

      console.log(
        `[SessionRepo:update] Executing update for ID ${id} with audioPath: ${updatedData.audioPath}, tokenCount: ${updatedData.transcriptTokenCount ?? 'N/A'}`
      );
      const info: DbRunResult = updateSessionMetadataStmt().run(
        updatedData.clientName,
        updatedData.sessionName,
        updatedData.date,
        updatedData.sessionType,
        updatedData.therapy,
        updatedData.fileName,
        updatedData.audioPath,
        updatedData.status,
        updatedData.whisperJobId,
        updatedData.transcriptTokenCount,
        id
      );
      if (info.changes === 0) {
        console.warn(
          `[SessionRepo:update] Update for session ${id} resulted in 0 changes.`
        );
      }
      return sessionRepository.findById(id);
    } catch (error) {
      throw new Error(`DB error updating metadata for session ${id}: ${error}`);
    }
  },

  deleteById: (id: number): boolean => {
    try {
      console.log(
        `[SessionRepo:deleteById] Executing DELETE for session ID: ${id}`
      );
      const info: DbRunResult = deleteSessionStmt().run(id);
      console.log(
        `[SessionRepo:deleteById] Delete result for session ID ${id}: ${info.changes} row(s) affected.`
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[SessionRepo:deleteById] Error deleting session ${id}:`,
        error
      );
      throw new Error(`DB error deleting session ${id}: ${error}`);
    }
  },
};
