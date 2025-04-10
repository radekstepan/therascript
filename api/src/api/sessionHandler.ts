// src/api/sessionHandler.ts
import path from 'path';
// --- Corrected Relative Imports ---
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
// --- Other Imports ---
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
import { transcribeAudio } from '../services/transcriptionService.js';
import { createSessionListDTO, updateParagraphInTranscript, isNodeError } from '../utils/helpers.js';
import type { BackendSession, BackendSessionMetadata, BackendChatSession } from '../types/index.js';
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import config from '../config/index.js';
// No need to import Context

// GET / - List all sessions (metadata only)
// Let Elysia infer context
export const listSessions = ({ set }: any) => {
    try {
        const sessions = sessionRepository.findAll();
        // Ensure the DTO matches the SessionListResponseItemSchema (which includes transcriptPath)
        const sessionDTOs = sessions.map(s => ({
            id: s.id,
            fileName: s.fileName,
            clientName: s.clientName,
            sessionName: s.sessionName,
            date: s.date,
            sessionType: s.sessionType,
            therapy: s.therapy,
            transcriptPath: s.transcriptPath, // Include transcriptPath
        }));
        set.status = 200;
        return sessionDTOs;
    } catch (error) {
        console.error("[API Error] listSessions:", error);
        throw new InternalServerError('Failed to fetch sessions', error instanceof Error ? error : undefined);
    }
};

// POST /upload handler remains commented as the logic is inline in routes

// GET /:sessionId - Get session metadata and list of chat metadata
// Let Elysia infer context (will include sessionData)
export const getSessionDetails = ({ sessionData, set }: any) => {
    try {
        const chats = chatRepository.findChatsBySessionId(sessionData.id);
        const chatMetadata = chats.map(chat => ({
            id: chat.id, sessionId: chat.sessionId, timestamp: chat.timestamp, name: chat.name
        }));

        set.status = 200;
        // Ensure the returned object matches SessionWithChatsMetadataResponseSchema
        // It expects the full session metadata + chat metadata array
        return {
             id: sessionData.id,
             fileName: sessionData.fileName,
             clientName: sessionData.clientName,
             sessionName: sessionData.sessionName,
             date: sessionData.date,
             sessionType: sessionData.sessionType,
             therapy: sessionData.therapy,
             transcriptPath: sessionData.transcriptPath, // Include transcriptPath
             chats: chatMetadata
        };
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${sessionData?.id}):`, error);
        throw new InternalServerError('Failed to get session details', error instanceof Error ? error : undefined);
    }
};

// PUT /:sessionId/metadata - Update metadata
// Let Elysia infer context (will include sessionData and validated body)
export const updateSessionMetadata = ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const updatedMetadata = body; // Body is already validated partial metadata

    if (Object.keys(updatedMetadata).length === 0) {
         throw new BadRequestError('No metadata provided for update.');
    }

    try {
        const updatedSession = sessionRepository.updateMetadata(sessionId, updatedMetadata);
        if (!updatedSession) {
            throw new NotFoundError(`Session with ID ${sessionId} not found during update attempt.`);
        }
        console.log(`[API] Updated metadata for session ${sessionId}`);
        set.status = 200;
        // Return the updated session metadata (ensure it matches SessionMetadataResponseSchema)
        return {
            id: updatedSession.id,
            fileName: updatedSession.fileName,
            clientName: updatedSession.clientName,
            sessionName: updatedSession.sessionName,
            date: updatedSession.date,
            sessionType: updatedSession.sessionType,
            therapy: updatedSession.therapy,
            transcriptPath: updatedSession.transcriptPath, // Include transcriptPath
        };
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update session metadata', error instanceof Error ? error : undefined);
    }
};

// GET /:sessionId/transcript - Get transcript content only
// Let Elysia infer context (will include sessionData)
export const getTranscript = async ({ sessionData, set }: any) => {
    const sessionId = sessionData.id;
    try {
        const transcriptContent = await loadTranscriptContent(sessionId);
        set.status = 200;
        return { transcriptContent }; // Matches TranscriptResponseSchema
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        throw new InternalServerError('Failed to load transcript', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph
// Let Elysia infer context (will include sessionData and validated body)
export const updateTranscriptParagraph = async ({ sessionData, body, set }: any) => {
    const sessionId = sessionData.id;
    const { paragraphIndex, newText } = body; // Body validated by schema

    try {
        const currentTranscript = await loadTranscriptContent(sessionId);
        if (currentTranscript === null || currentTranscript === undefined) {
             throw new NotFoundError(`Transcript for session ${sessionId} couldn't be loaded properly.`);
        }

        const updatedTranscript = updateParagraphInTranscript(currentTranscript, paragraphIndex, newText);

        if (updatedTranscript !== currentTranscript) {
            await saveTranscriptContent(sessionId, updatedTranscript);
            console.log(`[API] Updated paragraph ${paragraphIndex} for session ${sessionId}`);
        } else {
             console.log(`[API] No change needed for paragraph ${paragraphIndex} in session ${sessionId} (content identical).`);
        }

        set.status = 200;
        return { transcriptContent: updatedTranscript }; // Matches TranscriptResponseSchema
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update transcript paragraph', error instanceof Error ? error : undefined);
    }
};
