import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
import { updateParagraphInTranscript } from '../utils/helpers.js';
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import config from '../config/index.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
// No need for explicit context types here, rely on Elysia's inference

// GET / - List all sessions (metadata only)
// Let Elysia infer context
export const listSessions = ({ set }: any) => { // Using 'any', becomes sync
    try {
        const sessions = sessionRepository.findAll(); // Sync
        const sessionDTOs = sessions.map(s => ({
            id: s.id,
            fileName: s.fileName,
            clientName: s.clientName,
            sessionName: s.sessionName,
            date: s.date,
            sessionType: s.sessionType,
            therapy: s.therapy,
            transcriptPath: s.transcriptPath, // Ensure this matches SessionListResponseItemSchema
        }));
        set.status = 200;
        return sessionDTOs;
    } catch (error) {
        console.error("[API Error] listSessions:", error);
        throw new InternalServerError('Failed to fetch sessions', error instanceof Error ? error : undefined);
    }
};

// POST /upload handler remains inline in routes and async

// GET /:sessionId - Get session metadata and list of chat metadata
// Let Elysia infer context, including 'sessionData'
export const getSessionDetails = ({ sessionData, set }: any) => { // Using 'any', becomes sync
    try {
        // sessionData is available from the derive block
        const chats = chatRepository.findChatsBySessionId(sessionData.id); // Sync
        const chatMetadata = chats.map(chat => ({
            id: chat.id, sessionId: chat.sessionId, timestamp: chat.timestamp, name: chat.name
        }));

        set.status = 200;
        // Return data matching SessionWithChatsMetadataResponseSchema
        return {
             id: sessionData.id,
             fileName: sessionData.fileName,
             clientName: sessionData.clientName,
             sessionName: sessionData.sessionName,
             date: sessionData.date,
             sessionType: sessionData.sessionType,
             therapy: sessionData.therapy,
             transcriptPath: sessionData.transcriptPath,
             chats: chatMetadata // Array of chat metadata
        };
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${sessionData?.id}):`, error);
        throw new InternalServerError('Failed to get session details', error instanceof Error ? error : undefined);
    }
};

// PUT /:sessionId/metadata - Update metadata
// Let Elysia infer context, including 'sessionData', 'body'
export const updateSessionMetadata = ({ sessionData, body, set }: any) => { // Using 'any', becomes sync
    const sessionId = sessionData.id;
    const updatedMetadata = body; // Body is validated partial metadata by schema

    if (Object.keys(updatedMetadata).length === 0) {
         throw new BadRequestError('No metadata provided for update.');
    }

    try {
        const updatedSession = sessionRepository.updateMetadata(sessionId, updatedMetadata); // Sync
        if (!updatedSession) {
            throw new NotFoundError(`Session with ID ${sessionId} not found during update.`);
        }
        console.log(`[API] Updated metadata for session ${sessionId}`);
        set.status = 200;
        // Return data matching SessionMetadataResponseSchema
        return {
            id: updatedSession.id,
            fileName: updatedSession.fileName,
            clientName: updatedSession.clientName,
            sessionName: updatedSession.sessionName,
            date: updatedSession.date,
            sessionType: updatedSession.sessionType,
            therapy: updatedSession.therapy,
            transcriptPath: updatedSession.transcriptPath,
        };
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        // Consider specific error handling for DB constraints if needed
        throw new InternalServerError('Failed to update session metadata', error instanceof Error ? error : undefined);
    }
};

// GET /:sessionId/transcript - Get transcript content only
// Let Elysia infer context, including 'sessionData'
export const getTranscript = async ({ sessionData, set }: any) => { // Using 'any', remains async
    const sessionId = sessionData.id;
    try {
        const transcriptContent = await loadTranscriptContent(sessionId); // Async
        set.status = 200;
        return { transcriptContent }; // Matches TranscriptResponseSchema
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        throw new InternalServerError('Failed to load transcript', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph
// Let Elysia infer context, including 'sessionData', 'body'
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any) => { // Using 'any', remains async
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body; // Body validated by schema

    try {
        const currentTranscript = await loadTranscriptContent(sessionId); // Async
        if (currentTranscript === null || currentTranscript === undefined) {
             throw new InternalServerError(`Transcript for session ${sessionId} could not be loaded.`);
        }

        const updatedTranscript = updateParagraphInTranscript(currentTranscript, paragraphIndex, newText); // Sync

        if (updatedTranscript !== currentTranscript) {
            await saveTranscriptContent(sessionId, updatedTranscript); // Async
            console.log(`[API] Updated paragraph ${paragraphIndex} for session ${sessionId}`);
        } else {
             console.log(`[API] No change needed for paragraph ${paragraphIndex}.`);
        }

        set.status = 200;
        return { transcriptContent: updatedTranscript }; // Matches TranscriptResponseSchema
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update transcript paragraph', error instanceof Error ? error : undefined);
    }
};
