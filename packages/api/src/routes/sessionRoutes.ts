// packages/api/src/routes/sessionRoutes.ts
import { Elysia, t, type Static } from 'elysia';
import path from 'node:path';
import fs from 'node:fs/promises';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    listSessions, getSessionDetails, updateSessionMetadata,
    getTranscript, updateTranscriptParagraph
} from '../api/sessionHandler.js';
import {
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
import { transcribeAudio } from '../services/transcriptionService.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError } from '../errors.js';
import config from '../config/index.js'; // Keep config import

// --- Schemas ---
const SessionIdParamSchema = t.Object({
    sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" })
});
const ParagraphUpdateBodySchema = t.Object({
    paragraphIndex: t.Numeric({ minimum: 0, error: "Paragraph index must be 0 or greater" }),
    newText: t.String()
});
const SessionMetadataUpdateBodySchema = t.Partial(t.Object({
    clientName: t.Optional(t.String({ minLength: 1 })),
    sessionName: t.Optional(t.String({ minLength: 1 })),
    date: t.Optional(t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD" })),
    sessionType: t.Optional(t.String({ minLength: 1 })),
    therapy: t.Optional(t.String({ minLength: 1 })),
    fileName: t.Optional(t.String()),
    transcriptPath: t.Optional(t.String()),
}));
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(),
    fileName: t.String(),
    clientName: t.String(),
    sessionName: t.String(),
    date: t.String(),
    sessionType: t.String(),
    therapy: t.String(),
    transcriptPath: t.String(),
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema;

const ChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Number(),
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});
const SessionWithChatsMetadataResponseSchema = t.Intersect([
    SessionMetadataResponseSchema,
    t.Object({
        chats: t.Array(ChatMetadataResponseSchema)
    })
]);
const TranscriptResponseSchema = t.Object({ transcriptContent: t.String() });

// Define UploadBodySchema with a generic File type for now
const UploadBodySchema = t.Object({
    // Use a generic File type, validation will happen in beforeHandle
    audioFile: t.File({ error: "Audio file is required." }),
    // Keep other metadata fields
    clientName: t.String({ minLength: 1, error: "Client name required." }),
    sessionName: t.String({ minLength: 1, error: "Session name required." }),
    date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD." }),
    sessionType: t.String({ minLength: 1, error: "Session type required." }),
    therapy: t.String({ minLength: 1, error: "Therapy type required." }),
});

// Helper to parse human-readable size string (e.g., '100m') into bytes
const parseSize = (sizeStr: string): number => {
    const lowerStr = sizeStr.toLowerCase();
    const value = parseFloat(lowerStr);
    if (isNaN(value)) return 0;

    if (lowerStr.endsWith('g') || lowerStr.endsWith('gb')) {
        return value * 1024 * 1024 * 1024;
    } else if (lowerStr.endsWith('m') || lowerStr.endsWith('mb')) {
        return value * 1024 * 1024;
    } else if (lowerStr.endsWith('k') || lowerStr.endsWith('kb')) {
        return value * 1024;
    }
    return value; // Assume bytes if no unit
};

// --- Elysia Plugin for Session Routes ---
export const sessionRoutes = new Elysia({ prefix: '/api/sessions' })
    .model({
        sessionIdParam: SessionIdParamSchema,
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        // Register the schema with the generic File type
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
    })
    .group('', { detail: { tags: ['Session'] } }, (app) => app
        // GET /api/sessions - List sessions
        .get('/', listSessions, {
            response: { 200: t.Array(SessionListResponseItemSchema) },
            detail: { summary: 'List all sessions (metadata only)' }
        })

        // POST /api/sessions/upload - Upload session
        .post('/upload', async ({ body, set }) => {
            // Body is already parsed according to the basic UploadBodySchema
            const { audioFile, ...metadata } = body;

            let newSession: BackendSession | null = null;
            let tempAudioPath: string | null = null;
            let savedTranscriptPath: string | null = null;

            try {
                // 1. Save uploaded file temporarily (Validation happened in beforeHandle)
                const tempFileName = `upload-${Date.now()}-${audioFile.name}`;
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer));
                console.log(`[API Upload] Temporary audio saved to ${tempAudioPath}`);

                // 2. Transcribe Audio
                // TODO expose being able to cancel the task (preserved)
                console.log(`[API Upload] Starting transcription for ${audioFile.name}...`);
                const transcriptContent = await transcribeAudio(tempAudioPath);
                console.log(`[API Upload] Transcription finished.`);

                // 3. Create Session in DB
                const tempDbTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.txt`);
                newSession = await sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, tempDbTranscriptPath);
                if (!newSession) throw new InternalServerError('Failed to create session record.');
                console.log(`[API Upload] DB session record created (ID: ${newSession.id}) with temp path.`);

                const sessionId = newSession.id;
                const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.txt`);

                // 4. Save transcript content
                savedTranscriptPath = await saveTranscriptContent(sessionId, transcriptContent);
                console.log(`[API Upload] Transcript content saved to ${savedTranscriptPath}`);

                // 5. Update session record with final path
                const sessionAfterUpdate = await sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath });
                if (!sessionAfterUpdate) throw new InternalServerError(`Failed to update transcript path for session ${sessionId}.`);
                newSession = sessionAfterUpdate;
                console.log(`[API Upload] DB session record updated with final transcript path: ${finalTranscriptPath}`);

                // 6. Create initial chat
                const initialChat = await chatRepository.createChat(sessionId);
                await chatRepository.addMessage(initialChat.id, 'ai', `Session "${metadata.sessionName}" (${metadata.date}) transcribed.`);
                console.log(`[API Upload] Initial chat created (ID: ${initialChat.id})`);

                // 7. Fetch final state for response
                const finalSessionState = await sessionRepository.findById(sessionId);
                if (!finalSessionState) throw new InternalServerError(`Failed to fetch final state for session ${sessionId}`);
                const chatsRaw = await chatRepository.findChatsBySessionId(sessionId);
                const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                const responseSession = {
                    id: finalSessionState.id,
                    fileName: finalSessionState.fileName,
                    clientName: finalSessionState.clientName,
                    sessionName: finalSessionState.sessionName,
                    date: finalSessionState.date,
                    sessionType: finalSessionState.sessionType,
                    therapy: finalSessionState.therapy,
                    transcriptPath: finalSessionState.transcriptPath,
                    chats: chatsMetadata
                };

                set.status = 201;
                return responseSession;

            } catch (error) {
                 console.error('[API Error] Error during session upload processing:', error);
                 // Cleanup logic
                 if (newSession?.id) {
                     console.log(`[API Upload Cleanup] Attempting cleanup for session ${newSession.id}...`);
                     try {
                        await deleteTranscriptFile(newSession.id);
                        await sessionRepository.deleteById(newSession.id);
                        console.log(`[API Upload Cleanup] DB record and transcript file deleted.`);
                     }
                     catch (cleanupError) { console.error(`[API Upload Cleanup] Error during cleanup:`, cleanupError); }
                 }
                  if (error instanceof ApiError) throw error;
                  throw new InternalServerError('Session upload failed.', error instanceof Error ? error : undefined);
            } finally {
                 if (tempAudioPath) {
                    console.log(`[API Upload Cleanup] Deleting temporary audio file: ${tempAudioPath}`);
                    await deleteUploadedFile(tempAudioPath);
                 }
            }
        }, {
            // Add the beforeHandle hook for detailed validation
            beforeHandle: ({ body, set }) => {
                const file = body.audioFile;
                const maxSizeInBytes = parseSize(config.upload.maxFileSize);

                // Check Type
                if (!config.upload.allowedMimeTypes.includes(file.type)) {
                    throw new BadRequestError(`Invalid file type: ${file.type}. Allowed types: ${config.upload.allowedMimeTypes.join(', ')}`);
                }

                // Check Size
                if (file.size > maxSizeInBytes) {
                     throw new BadRequestError(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the limit of ${config.upload.maxFileSize}.`);
                }
            },
            // Reference the model name defined above
            body: 'uploadBody',
            response: { 201: 'sessionWithChatsMetadataResponse', 400: t.Any(), 500: t.Any() },
            detail: { summary: 'Upload session audio & metadata' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(async ({ params }) => {
                 const sessionId = parseInt(params.sessionId as unknown as string, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');
                 const session = await sessionRepository.findById(sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
                 return { sessionData: session };
             })
             // GET /:sessionId - Get session metadata & chat list
             .get('/:sessionId', getSessionDetails, {
                 response: { 200: 'sessionWithChatsMetadataResponse' },
                 detail: { summary: 'Get session metadata & chat list' }
             })
             // PUT /:sessionId/metadata - Update session metadata
             .put('/:sessionId/metadata', updateSessionMetadata, {
                 body: 'metadataUpdateBody',
                 response: { 200: 'sessionMetadataResponse' },
                 detail: { summary: 'Update session metadata' }
             })
             // GET /:sessionId/transcript - Get transcript content only
             .get('/:sessionId/transcript', getTranscript, {
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Get transcript content' }
             })
             // PATCH /:sessionId/transcript - Update transcript paragraph
             .patch('/:sessionId/transcript', updateTranscriptParagraph, {
                 body: 'paragraphUpdateBody',
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Update transcript paragraph' }
             })
         )
    );
