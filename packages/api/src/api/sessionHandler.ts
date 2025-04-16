import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
// Removed import of updateParagraphInTranscript from helpers
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import config from '../config/index.js';
import type { BackendSession, BackendSessionMetadata, StructuredTranscript, TranscriptParagraphData } from '../types/index.js'; // Import types
// No need for explicit context types here, rely on Elysia's inference

// GET / - List all sessions (metadata only)
// Let Elysia infer context
export const listSessions = ({ set }: any) => { // Using 'any', becomes sync
    try {
        const sessions = sessionRepository.findAll(); // Sync
        // Convert to DTO, ensuring transcriptPath is included if schema requires it
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

// GET /:sessionId/transcript - Get structured transcript content
// Let Elysia infer context, including 'sessionData'
export const getTranscript = async ({ sessionData, set }: any) => { // Using 'any', remains async
    const sessionId = sessionData.id;
    try {
        // loadTranscriptContent now returns StructuredTranscript
        const structuredTranscript: StructuredTranscript = await loadTranscriptContent(sessionId); // Async
        set.status = 200;
        // Return the structured data directly
        return structuredTranscript; // Matches the updated TranscriptResponseSchema (Array<TranscriptParagraphData>)
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error; // Re-throw known API errors
        throw new InternalServerError('Failed to load transcript', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph in the structured transcript
// Let Elysia infer context, including 'sessionData', 'body'
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any) => { // Using 'any', remains async
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body; // Body validated by schema

    try {
        // Load the current structured transcript
        const currentTranscript: StructuredTranscript = await loadTranscriptContent(sessionId); // Async

        // Validate the index
        if (paragraphIndex < 0 || paragraphIndex >= currentTranscript.length) {
            throw new BadRequestError(`Invalid paragraph index: ${paragraphIndex}. Must be between 0 and ${currentTranscript.length - 1}.`);
        }

        // Check if the text actually changed
        const trimmedNewText = newText.trim();
        const originalText = currentTranscript[paragraphIndex].text;
        const originalTrimmedText = originalText.trim();

        if (trimmedNewText === originalTrimmedText) {
             console.log(`[API] No change needed for paragraph ${paragraphIndex}. Text is identical.`);
             set.status = 200;
             // Return the unmodified transcript
             return currentTranscript; // Matches updated TranscriptResponseSchema
        }

        // Create a modified copy of the transcript array
        const updatedTranscript = currentTranscript.map((paragraph, index) => {
             if (index === paragraphIndex) {
                 // Return a new object for the updated paragraph
                 return { ...paragraph, text: trimmedNewText };
             }
             return paragraph; // Return the original object for unchanged paragraphs
        });

        // Save the entire updated transcript structure back to the file
        await saveTranscriptContent(sessionId, updatedTranscript); // Async
        console.log(`[API] Updated paragraph ${paragraphIndex} for session ${sessionId}`);

        set.status = 200;
        // Return the newly updated transcript structure
        return updatedTranscript; // Matches updated TranscriptResponseSchema
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update transcript paragraph', error instanceof Error ? error : undefined);
    }
};
