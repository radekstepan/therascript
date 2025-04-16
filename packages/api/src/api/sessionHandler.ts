import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
import type { BackendSession, BackendSessionMetadata, StructuredTranscript, TranscriptParagraphData } from '../types/index.js';
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import config from '../config/index.js';

// GET / - List all sessions (metadata only)
export const listSessions = ({ set }: any) => {
    try {
        const sessions = sessionRepository.findAll();
        // Map to DTO, ensuring all fields from SessionListResponseItemSchema are present
        const sessionDTOs = sessions.map(s => ({
            id: s.id,
            fileName: s.fileName,
            clientName: s.clientName,
            sessionName: s.sessionName,
            date: s.date,
            sessionType: s.sessionType,
            therapy: s.therapy,
            transcriptPath: s.transcriptPath,
            status: s.status,         // --- FIX: Add status ---
            whisperJobId: s.whisperJobId, // --- FIX: Add whisperJobId ---
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
export const getSessionDetails = ({ sessionData, set }: any) => {
    try {
        const chats = chatRepository.findChatsBySessionId(sessionData.id);
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
             status: sessionData.status,         // --- FIX: Add status ---
             whisperJobId: sessionData.whisperJobId, // --- FIX: Add whisperJobId ---
             chats: chatMetadata
        };
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${sessionData?.id}):`, error);
        throw new InternalServerError('Failed to get session details', error instanceof Error ? error : undefined);
    }
};

// PUT /:sessionId/metadata - Update metadata
export const updateSessionMetadata = ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    // The body schema already allows status and whisperJobId for internal updates
    const updatedMetadata = body;

    if (Object.keys(updatedMetadata).length === 0) {
         throw new BadRequestError('No metadata provided for update.');
    }

    try {
        // Pass the full update object to the repository
        const updatedSession = sessionRepository.updateMetadata(sessionId, updatedMetadata);
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
            status: updatedSession.status,         // --- FIX: Add status ---
            whisperJobId: updatedSession.whisperJobId, // --- FIX: Add whisperJobId ---
        };
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update session metadata', error instanceof Error ? error : undefined);
    }
};

// GET /:sessionId/transcript - Get structured transcript content
export const getTranscript = async ({ sessionData, set }: any) => {
    const sessionId = sessionData.id;
    // --- FIX: Check status before attempting to load transcript ---
    if (sessionData.status !== 'completed' || !sessionData.transcriptPath) {
         console.warn(`[API getTranscript] Transcript requested for session ${sessionId} but status is ${sessionData.status} or path is missing.`);
         // Return empty array if not completed or path is null
         set.status = 200; // Still a valid request, just no content
         return [];
    }
    // --- END FIX ---
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

// PATCH /:sessionId/transcript - Update a specific paragraph in the structured transcript
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body;

    // --- FIX: Check status before attempting to update transcript ---
     if (sessionData.status !== 'completed' || !sessionData.transcriptPath) {
          throw new BadRequestError(`Cannot update transcript for session ${sessionId}: Status is ${sessionData.status} or transcript path is missing.`);
     }
    // --- END FIX ---

    try {
        const currentTranscript: StructuredTranscript = await loadTranscriptContent(sessionId);

        if (paragraphIndex < 0 || paragraphIndex >= currentTranscript.length) {
            throw new BadRequestError(`Invalid paragraph index: ${paragraphIndex}. Must be between 0 and ${currentTranscript.length - 1}.`);
        }

        const trimmedNewText = newText.trim();
        const originalText = currentTranscript[paragraphIndex].text;
        const originalTrimmedText = originalText.trim();

        if (trimmedNewText === originalTrimmedText) {
             console.log(`[API] No change needed for paragraph ${paragraphIndex}. Text is identical.`);
             set.status = 200;
             return currentTranscript;
        }

        const updatedTranscript = currentTranscript.map((paragraph, index) => {
             if (index === paragraphIndex) {
                 return { ...paragraph, text: trimmedNewText };
             }
             return paragraph;
        });

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
