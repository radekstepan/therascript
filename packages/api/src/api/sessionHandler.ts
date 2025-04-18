// packages/api/src/api/sessionHandler.ts
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    loadTranscriptContent,
    saveTranscriptContent,
} from '../services/fileService.js';
import type { BackendSession, StructuredTranscript } from '../types/index.js';
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';

// Helper to convert YYYY-MM-DD to ISO 8601 using Noon UTC
const dateToIsoString = (dateString: string): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        console.warn(`[dateToIsoString] Invalid date format received: ${dateString}`);
        return null;
    }
    try {
        const dt = new Date(`${dateString}T12:00:00.000Z`);
        if (isNaN(dt.getTime())) {
            throw new Error('Invalid date produced');
        }
        return dt.toISOString();
    } catch (e) {
        console.error(`[dateToIsoString] Error converting date string '${dateString}' to ISO:`, e);
        return null;
    }
};

// GET / - List all sessions (metadata only)
// FIX: Add audioPath to the returned DTO
export const listSessions = ({ set }: any) => {
    try {
        const sessions = sessionRepository.findAll();
        const sessionDTOs = sessions.map(s => ({
            id: s.id,
            fileName: s.fileName,
            clientName: s.clientName,
            sessionName: s.sessionName,
            date: s.date,
            sessionType: s.sessionType,
            therapy: s.therapy,
            transcriptPath: s.transcriptPath,
            audioPath: s.audioPath, // <-- Add audioPath
            status: s.status,
            whisperJobId: s.whisperJobId,
        }));
        set.status = 200;
        return sessionDTOs;
    } catch (error) {
        console.error("[API Error] listSessions:", error);
        throw new InternalServerError('Failed to fetch sessions', error instanceof Error ? error : undefined);
    }
};

// POST /upload handler remains inline in routes and async (uses current time)

// GET /:sessionId - Get session metadata and list of chat metadata
// FIX: Add audioPath to the returned DTO
export const getSessionDetails = ({ sessionData, set }: any) => {
    try {
        const chats = chatRepository.findChatsBySessionId(sessionData.id);
        const chatMetadata = chats.map(chat => ({
            id: chat.id, sessionId: chat.sessionId, timestamp: chat.timestamp, name: chat.name
        }));

        set.status = 200;
        return {
             id: sessionData.id,
             fileName: sessionData.fileName,
             clientName: sessionData.clientName,
             sessionName: sessionData.sessionName,
             date: sessionData.date,
             sessionType: sessionData.sessionType,
             therapy: sessionData.therapy,
             transcriptPath: sessionData.transcriptPath,
             audioPath: sessionData.audioPath, // <-- Add audioPath
             status: sessionData.status,
             whisperJobId: sessionData.whisperJobId,
             chats: chatMetadata
        };
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${sessionData?.id}):`, error);
        throw new InternalServerError('Failed to get session details', error instanceof Error ? error : undefined);
    }
};

// PUT /:sessionId/metadata - Update metadata
// FIX: Add audioPath to the returned DTO
export const updateSessionMetadata = ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const { date: dateInput, ...restOfBody } = body; // Separate date input
    const metadataUpdate: Partial<BackendSession> = { ...restOfBody };

    if (Object.keys(body).length === 0) {
         throw new BadRequestError('No metadata provided for update.');
    }

    if (dateInput) {
        const isoDate = dateToIsoString(dateInput);
        if (!isoDate) {
            throw new BadRequestError(`Invalid date format provided: ${dateInput}. Must be YYYY-MM-DD.`);
        }
        metadataUpdate.date = isoDate;
        console.log(`[API updateSessionMetadata] Converted input date ${dateInput} to ISO ${isoDate} (using T12Z)`);
    }

    try {
        const updatedSession = sessionRepository.updateMetadata(sessionId, metadataUpdate);
        if (!updatedSession) {
            throw new NotFoundError(`Session with ID ${sessionId} not found during update.`);
        }
        console.log(`[API] Updated metadata for session ${sessionId}`);
        set.status = 200;
        return {
            id: updatedSession.id,
            fileName: updatedSession.fileName,
            clientName: updatedSession.clientName,
            sessionName: updatedSession.sessionName,
            date: updatedSession.date,
            sessionType: updatedSession.sessionType,
            therapy: updatedSession.therapy,
            transcriptPath: updatedSession.transcriptPath,
            audioPath: updatedSession.audioPath, // <-- Add audioPath
            status: updatedSession.status,
            whisperJobId: updatedSession.whisperJobId,
        };
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update session metadata', error instanceof Error ? error : undefined);
    }
};

// GET /:sessionId/transcript - Get structured transcript content (no change)
export const getTranscript = async ({ sessionData, set }: any) => {
    const sessionId = sessionData.id;
    if (sessionData.status !== 'completed' || !sessionData.transcriptPath) {
         console.warn(`[API getTranscript] Transcript requested for session ${sessionId} but status is ${sessionData.status} or path is missing.`);
         set.status = 200;
         return [];
    }
    try {
        const structuredTranscript: StructuredTranscript = await loadTranscriptContent(sessionId);
        set.status = 200;
        return structuredTranscript;
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to load transcript', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph (no change)
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body;
     if (sessionData.status !== 'completed' || !sessionData.transcriptPath) {
          throw new BadRequestError(`Cannot update transcript for session ${sessionId}: Status is ${sessionData.status} or transcript path is missing.`);
     }
    try {
        const currentTranscript: StructuredTranscript = await loadTranscriptContent(sessionId);
        if (paragraphIndex < 0 || paragraphIndex >= currentTranscript.length) {
            throw new BadRequestError(`Invalid paragraph index: ${paragraphIndex}.`);
        }
        const trimmedNewText = newText.trim();
        if (trimmedNewText === currentTranscript[paragraphIndex].text.trim()) {
             console.log(`[API] No change needed for paragraph ${paragraphIndex}.`);
             set.status = 200;
             return currentTranscript;
        }
        const updatedTranscript = currentTranscript.map((p, i) => i === paragraphIndex ? { ...p, text: trimmedNewText } : p);
        await saveTranscriptContent(sessionId, updatedTranscript);
        console.log(`[API] Updated paragraph ${paragraphIndex} for session ${sessionId}`);
        set.status = 200;
        return updatedTranscript;
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update transcript paragraph', error instanceof Error ? error : undefined);
    }
};
