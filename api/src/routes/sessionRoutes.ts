// src/routes/sessionRoutes.ts
import { Elysia, t, type Static } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import path from 'path';
import fs from 'fs/promises';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
// Import the refactored Elysia-native handlers (excluding uploadSession)
import {
    listSessions, getSessionDetails, updateSessionMetadata,
    getTranscript, updateTranscriptParagraph
} from '../api/sessionHandler.js';
import {
    loadTranscriptContent, // Keep for use within handlers
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js';
import { transcribeAudio } from '../services/transcriptionService.js';
import { createSessionListDTO, updateParagraphInTranscript } from '../utils/helpers.js';
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import config from '../config/index.js';

// --- Define TypeBox Schemas (Keep as they are, ensure they match handler returns) ---
const SessionIdParamSchema = t.Object({ sessionId: t.Numeric({ minimum: 1, error: "Session ID must be a positive number" }) });
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
    fileName: t.Optional(t.String()), // These might not be user-updatable usually
    transcriptPath: t.Optional(t.String()), // These might not be user-updatable usually
}));
// Schema for session metadata responses (used by list, update)
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(),
    fileName: t.String(),
    clientName: t.String(),
    sessionName: t.String(),
    date: t.String(),
    sessionType: t.String(),
    therapy: t.String(),
    transcriptPath: t.String(), // Include transcriptPath in metadata response
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema; // List uses full metadata now

const ChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Number(),
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});
// Schema for GET /:sessionId response
const SessionWithChatsMetadataResponseSchema = t.Intersect([
    SessionMetadataResponseSchema, // Includes transcriptPath now
    t.Object({
        chats: t.Array(ChatMetadataResponseSchema)
    })
]);
const TranscriptResponseSchema = t.Object({ transcriptContent: t.String() });
// Schema for POST /upload request body
const UploadBodySchema = t.Object({
    audioFile: t.File({
         type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/aac'],
         maxSize: '100m', // Example max size
         error: "Invalid or missing audio file. Must be audio/* type and under 100MB."
    }),
    // Metadata fields directly in the body alongside the file
    clientName: t.String({ minLength: 1, error: "Client name required." }),
    sessionName: t.String({ minLength: 1, error: "Session name required." }),
    date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD." }),
    sessionType: t.String({ minLength: 1, error: "Session type required." }),
    therapy: t.String({ minLength: 1, error: "Therapy type required." }),
});

// --- Type Alias for Clarity ---
type SessionListItem = Static<typeof SessionListResponseItemSchema>;

// --- Elysia Plugin for Session Routes ---
export const sessionRoutes = new Elysia({ prefix: '/api/sessions' })
    .model({ // Keep model definitions
        sessionIdParam: SessionIdParamSchema,
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
    })
    .group('', { detail: { tags: ['Session'] } }, (app) => app
        // GET /api/sessions - List sessions
        // Pass the handler function directly
        .get('/', listSessions, {
            response: { 200: t.Array(SessionListResponseItemSchema) }, // Ensure this matches handler return
            detail: { summary: 'List all sessions (metadata only)' }
        })

        // POST /api/sessions/upload - Upload session
        // Keep the logic inline here as it uses Elysia's ctx.body.audioFile directly
        .post('/upload', async ({ body, set }) => {
            const { audioFile, ...metadata } = body; // Destructure file and metadata

            let newSession: BackendSession | null = null;
            let tempAudioPath: string | null = null;
            let savedTranscriptPath: string | null = null;

            try {
                // 1. Save uploaded file temporarily
                const tempFileName = `upload-${Date.now()}-${audioFile.name}`;
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer));
                console.log(`[API Upload] Temporary audio saved to ${tempAudioPath}`);

                // 2. Transcribe Audio
                console.log(`[API Upload] Starting transcription for ${audioFile.name}...`);
                const transcriptContent = await transcribeAudio(tempAudioPath);
                console.log(`[API Upload] Transcription finished.`);

                // 3. Create Session in DB (with temporary path initially)
                const tempDbTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.txt`);
                newSession = sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, tempDbTranscriptPath);
                 if (!newSession) throw new InternalServerError('Failed to create session record.');
                console.log(`[API Upload] DB session record created (ID: ${newSession.id}) with temp path.`);

                const sessionId = newSession.id;
                const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.txt`);

                // 4. Save transcript content to its final destination
                savedTranscriptPath = await saveTranscriptContent(sessionId, transcriptContent);
                console.log(`[API Upload] Transcript content saved to ${savedTranscriptPath}`);

                // 5. Update session record with final transcript path
                const sessionAfterUpdate = sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath });
                if (!sessionAfterUpdate) throw new InternalServerError(`Failed to update transcript path for session ${sessionId}.`);
                newSession = sessionAfterUpdate;
                console.log(`[API Upload] DB session record updated with final transcript path: ${finalTranscriptPath}`);

                // 6. Create initial chat
                const initialChat = chatRepository.createChat(sessionId);
                chatRepository.addMessage(initialChat.id, 'ai', `Session "${metadata.sessionName}" (${metadata.date}) transcribed.`);
                console.log(`[API Upload] Initial chat created (ID: ${initialChat.id})`);

                // 7. Fetch final state for response (session + chat metadata)
                const finalSessionState = sessionRepository.findById(sessionId);
                if (!finalSessionState) throw new InternalServerError(`Failed to fetch final state for session ${sessionId}`);
                const chatsRaw = chatRepository.findChatsBySessionId(sessionId);
                const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                // Construct response matching SessionWithChatsMetadataResponseSchema
                const responseSession = {
                    id: finalSessionState.id,
                    fileName: finalSessionState.fileName,
                    clientName: finalSessionState.clientName,
                    sessionName: finalSessionState.sessionName,
                    date: finalSessionState.date,
                    sessionType: finalSessionState.sessionType,
                    therapy: finalSessionState.therapy,
                    transcriptPath: finalSessionState.transcriptPath, // Include path
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
                        sessionRepository.deleteById(newSession.id);
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
            body: 'uploadBody',
            response: { 201: 'sessionWithChatsMetadataResponse', 400: t.Any(), 500: t.Any() }, // Ensure this matches handler return
            detail: { summary: 'Upload session audio & metadata' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app // Keep guard
             .derive(({ params }) => { // Keep derivation
                 const session = sessionRepository.findById(params.sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${params.sessionId}`);
                 return { sessionData: session };
             })
             // GET /:sessionId - Get session metadata & chat list
             // Pass the handler function directly
             .get('/:sessionId', getSessionDetails, {
                 response: { 200: 'sessionWithChatsMetadataResponse' }, // Ensure this matches handler return
                 detail: { summary: 'Get session metadata & chat list' }
             })
             // PUT /:sessionId/metadata - Update session metadata
             // Pass the handler function directly
             .put('/:sessionId/metadata', updateSessionMetadata, {
                 body: 'metadataUpdateBody',
                 response: { 200: 'sessionMetadataResponse' }, // Ensure this matches handler return
                 detail: { summary: 'Update session metadata' }
             })
             // GET /:sessionId/transcript - Get transcript content only
             // Pass the handler function directly
             .get('/:sessionId/transcript', getTranscript, {
                 response: { 200: 'transcriptResponse' }, // Ensure this matches handler return
                 detail: { summary: 'Get transcript content' }
             })
             // PATCH /:sessionId/transcript - Update transcript paragraph
             // Pass the handler function directly
             .patch('/:sessionId/transcript', updateTranscriptParagraph, {
                 body: 'paragraphUpdateBody',
                 response: { 200: 'transcriptResponse' }, // Ensure this matches handler return
                 detail: { summary: 'Update transcript paragraph' }
             })
         ) // End guard
    ) // End group
    