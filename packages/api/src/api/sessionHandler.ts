import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js'; // <-- Import Transcript Repo
import {
    // --- REMOVED loadTranscriptContent, saveTranscriptContent ---
    calculateTokenCount, // <-- Import token calculation helper
    deleteUploadedAudioFile, // <-- Import audio file delete helper
} from '../services/fileService.js';
// --- NEW: Import reload function ---
import { reloadActiveModelContext } from '../services/ollamaService.js';
// --- END NEW ---
import type { BackendSession, StructuredTranscript } from '../types/index.js'; // <-- Ensure StructuredTranscript is imported
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';

// Helper to convert YYYY-MM-DD to ISO 8601 using Noon UTC
// TODO move to helpers or utils
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
// FIX: Add audioPath and transcriptTokenCount to the returned DTO, Remove transcriptPath
export const listSessions = ({ set }: any) => {
    try {
        const sessions = sessionRepository.findAll();
        // Ensure audioPath and transcriptTokenCount are included in the response DTO
        const sessionDTOs = sessions.map(s => ({
            id: s.id,
            fileName: s.fileName,
            clientName: s.clientName,
            sessionName: s.sessionName,
            date: s.date,
            sessionType: s.sessionType,
            therapy: s.therapy,
            // transcriptPath: s.transcriptPath, // Removed
            audioPath: s.audioPath, // <-- Included audioPath
            status: s.status,
            whisperJobId: s.whisperJobId,
            transcriptTokenCount: s.transcriptTokenCount, // <-- Included token count
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
// FIX: Add audioPath and transcriptTokenCount to the returned DTO, Remove transcriptPath
export const getSessionDetails = ({ sessionData, set }: any) => {
    try {
        const chats = chatRepository.findChatsBySessionId(sessionData.id);
        const chatMetadata = chats.map(chat => ({
            id: chat.id, sessionId: chat.sessionId, timestamp: chat.timestamp, name: chat.name
        }));

        set.status = 200;
        // Ensure audioPath and transcriptTokenCount are included in the response DTO
        return {
             id: sessionData.id,
             fileName: sessionData.fileName,
             clientName: sessionData.clientName,
             sessionName: sessionData.sessionName,
             date: sessionData.date,
             sessionType: sessionData.sessionType,
             therapy: sessionData.therapy,
             // transcriptPath: sessionData.transcriptPath, // Removed
             audioPath: sessionData.audioPath, // <-- Included audioPath
             status: sessionData.status,
             whisperJobId: sessionData.whisperJobId,
             transcriptTokenCount: sessionData.transcriptTokenCount, // <-- Included token count
             chats: chatMetadata
        };
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${sessionData?.id}):`, error);
        throw new InternalServerError('Failed to get session details', error instanceof Error ? error : undefined);
    }
};

// PUT /:sessionId/metadata - Update metadata
// FIX: Add audioPath and transcriptTokenCount to the returned DTO, Remove transcriptPath
export const updateSessionMetadata = ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const { date: dateInput, ...restOfBody } = body; // Separate date input
    // Explicitly define type allowing audioPath update, remove transcriptPath
    const metadataUpdate: Partial<BackendSession> = { ...restOfBody };
     // --- REMOVED: delete metadataUpdate.transcriptPath; (property no longer exists) ---

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
        // Ensure audioPath and transcriptTokenCount are included in the response DTO
        return {
            id: updatedSession.id,
            fileName: updatedSession.fileName,
            clientName: updatedSession.clientName,
            sessionName: updatedSession.sessionName,
            date: updatedSession.date,
            sessionType: updatedSession.sessionType,
            therapy: updatedSession.therapy,
            // transcriptPath: updatedSession.transcriptPath, // Removed
            audioPath: updatedSession.audioPath, // <-- Included audioPath
            status: updatedSession.status,
            whisperJobId: updatedSession.whisperJobId,
            transcriptTokenCount: updatedSession.transcriptTokenCount, // <-- Included token count
        };
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update session metadata', error instanceof Error ? error : undefined);
    }
};

// GET /:sessionId/transcript - Get structured transcript content (fetch from DB)
export const getTranscript = async ({ sessionData, set }: any): Promise<StructuredTranscript> => { // <-- Added Promise<StructuredTranscript> return type hint
    const sessionId = sessionData.id;
    // Check status, but transcriptPath is no longer relevant
    if (sessionData.status !== 'completed') {
         console.warn(`[API getTranscript] Transcript requested for session ${sessionId} but status is ${sessionData.status}.`);
         // Decide if returning empty is correct, or maybe a 409 Conflict if not completed?
         // Let's return empty for now, mirroring previous behavior for missing file.
         set.status = 200;
         return [];
    }
    try {
        // Use transcriptRepository to fetch paragraphs
        const structuredTranscript: StructuredTranscript = transcriptRepository.findParagraphsBySessionId(sessionId);
        set.status = 200;
        return structuredTranscript;
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to load transcript from database', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph in the DB
// FIX: Use transcriptRepository, Recalculate token count, trigger model reload
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any): Promise<StructuredTranscript> => { // <-- Added Promise<StructuredTranscript> return type hint
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body;

    // Check status, transcriptPath no longer relevant
    if (sessionData.status !== 'completed') {
          throw new BadRequestError(`Cannot update transcript for session ${sessionId}: Status is ${sessionData.status}.`);
    }

    try {
        // Fetch current transcript from DB to check index validity and no-change case
        // --- FIX: Explicitly type currentTranscript ---
        const currentTranscript: StructuredTranscript = transcriptRepository.findParagraphsBySessionId(sessionId);

        if (paragraphIndex < 0 || paragraphIndex >= currentTranscript.length) {
            throw new BadRequestError(`Invalid paragraph index: ${paragraphIndex}. Transcript has ${currentTranscript.length} paragraphs.`);
        }

        const trimmedNewText = newText.trim();
        // Ensure currentTranscript[paragraphIndex] exists before accessing .text
        if (currentTranscript[paragraphIndex] && trimmedNewText === currentTranscript[paragraphIndex].text.trim()) {
             console.log(`[API updateTranscriptParagraph] No change needed for paragraph ${paragraphIndex}.`);
             set.status = 200;
             return currentTranscript; // Return the original transcript
        }

        // Update the specific paragraph in the database
        const updateSuccess = transcriptRepository.updateParagraphText(sessionId, paragraphIndex, trimmedNewText);
        if (!updateSuccess) {
            // This might happen if the paragraph was deleted between fetch and update, unlikely but possible
            throw new InternalServerError(`Failed to update paragraph ${paragraphIndex} for session ${sessionId} in the database.`);
        }

        // Fetch the *entire* updated transcript from the DB after the update
        // --- FIX: Explicitly type updatedTranscript ---
        const updatedTranscript: StructuredTranscript = transcriptRepository.findParagraphsBySessionId(sessionId);
        if (updatedTranscript.length !== currentTranscript.length) {
             console.warn(`[API updateTranscriptParagraph] Transcript length changed after update for session ${sessionId}. This is unexpected.`);
        }

        // Recalculate token count based on the updated transcript text from DB
        const fullText = updatedTranscript.map(p => p.text).join('\n\n');
        const tokenCount = calculateTokenCount(fullText);

        // Update the token count in the session metadata
        sessionRepository.updateMetadata(sessionId, { transcriptTokenCount: tokenCount });

        console.log(`[API updateTranscriptParagraph] Updated paragraph ${paragraphIndex} for session ${sessionId}. New token count: ${tokenCount ?? 'N/A'}`);

        // --- NEW: Trigger model context reload ---
        try {
            console.log(`[API updateTranscriptParagraph] Triggering Ollama model context reload after transcript update...`);
            await reloadActiveModelContext();
            console.log(`[API updateTranscriptParagraph] Ollama model context reload triggered successfully.`);
        } catch (reloadError) {
            console.error(`[API updateTranscriptParagraph] WARNING: Failed to trigger Ollama model context reload after update (Chat might use stale context):`, reloadError);
            // Do not fail the request if reload fails, just log the warning.
        }
        // --- END NEW ---

        set.status = 200;
        return updatedTranscript; // Return the updated transcript content from the DB
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update transcript paragraph', error instanceof Error ? error : undefined);
    }
};


// --- DELETE /:sessionId/audio ---
// Handler performs a hard delete of the audio file and updates the DB record.
export const deleteSessionAudioHandler = async ({ sessionData, set }: any) => {
    const sessionId = sessionData.id;
    const audioIdentifier = sessionData.audioPath;

    console.log(`[API Delete Audio] Request for session ${sessionId}. Current audio identifier: ${audioIdentifier}`);

    if (!audioIdentifier) {
        throw new NotFoundError(`No audio file associated with session ${sessionId} to delete.`);
    }

    try {
        // 1. Delete the audio file from the filesystem
        await deleteUploadedAudioFile(audioIdentifier);
        console.log(`[API Delete Audio] Successfully deleted audio file for identifier: ${audioIdentifier}`);

        // 2. Update the session record in the database to remove the reference
        const updatedSession = sessionRepository.updateMetadata(sessionId, { audioPath: null });
        if (!updatedSession) {
            // This shouldn't happen if sessionData existed, but handle defensively
            throw new InternalServerError(`Failed to update session ${sessionId} after deleting audio file.`);
        }
        console.log(`[API Delete Audio] Successfully removed audioPath reference from session ${sessionId} record.`);

        set.status = 200;
        return { message: `Original audio file for session ${sessionId} deleted successfully.` };
    } catch (error) {
        console.error(`[API Error] deleteSessionAudio (ID: ${sessionId}, Identifier: ${audioIdentifier}):`, error);
        if (error instanceof ApiError) throw error; // Handle NotFoundError from file deletion etc.
        throw new InternalServerError('Failed to delete session audio file', error instanceof Error ? error : undefined);
    }
};
// --- END DELETE /:sessionId/audio ---
