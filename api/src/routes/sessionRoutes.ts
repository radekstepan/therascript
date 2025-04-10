// src/routes/sessionRoutes.ts
import { Elysia, t, type Static } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import path from 'path';
import fs from 'fs/promises';
import { sessionRepository } from '../repositories/sessionRepository.js'; // ADDED .js
import { chatRepository } from '../repositories/chatRepository.js';       // ADDED .js
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService.js'; // ADDED .js
import { transcribeAudio } from '../services/transcriptionService.js'; // ADDED .js
import { createSessionListDTO, updateParagraphInTranscript } from '../utils/helpers.js'; // ADDED .js
import type { BackendSession, BackendSessionMetadata } from '../types/index.js'; // ADDED .js
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js'; // ADDED .js
import config from '../config/index.js'; // ADDED .js

// --- Define TypeBox Schemas ---
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
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema;

const ChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Number(),
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});
const FullSessionResponseSchema = t.Intersect([
    SessionMetadataResponseSchema,
    t.Object({
        transcriptContent: t.String(),
        chats: t.Array(ChatMetadataResponseSchema)
    })
]);
const TranscriptResponseSchema = t.Object({ transcriptContent: t.String() });
const UploadBodySchema = t.Object({
    audioFile: t.File({
         type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/aac'],
         maxSize: '100m',
         error: "Invalid audio file."
    }),
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
    .model({ // Define models for reuse by name
        sessionIdParam: SessionIdParamSchema,
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        fullSessionResponse: FullSessionResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
    })
    .group('', { detail: { tags: ['Session'] } }, (app) => app
        // GET /api/sessions - List sessions
        .get('/', ({ set }) => {
            try {
                const sessions = sessionRepository.findAll();
                const sessionDTOs = sessions.map(createSessionListDTO) as SessionListItem[];
                set.status = 200;
                return sessionDTOs;
            } catch (dbError) {
                throw new InternalServerError('Failed to fetch sessions', dbError as Error);
            }
        }, {
            // Use the schema variable directly
            response: { 200: t.Array(SessionListResponseItemSchema) },
            detail: { summary: 'List all sessions (metadata only)' }
        })

        // POST /api/sessions/upload - Upload session
        .post('/upload', async ({ body, set }) => {
            const { audioFile, ...metadata } = body;

            let newSession: BackendSession | null = null;
            let tempAudioPath: string | null = null;
            let savedTranscriptPath: string | null = null;

            try {
                // 1. Save uploaded file temporarily
                const tempFileName = `upload-${Date.now()}-${audioFile.name}`;
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer));

                // 2. Transcribe Audio
                const transcriptContent = await transcribeAudio(tempAudioPath);

                // 3. Create Session in DB
                const tempDbTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.txt`);
                newSession = sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, tempDbTranscriptPath);
                 if (!newSession) throw new InternalServerError('Failed to create session record.');

                const sessionId = newSession.id;
                const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.txt`);

                // 4. Save transcript content
                savedTranscriptPath = await saveTranscriptContent(sessionId, transcriptContent);

                // 5. Update session record with final transcript path
                const sessionAfterUpdate = sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath });
                if (!sessionAfterUpdate) throw new InternalServerError(`Failed to update transcript path for session ${sessionId}.`);
                newSession = sessionAfterUpdate;

                // 6. Create initial chat
                const initialChat = chatRepository.createChat(sessionId);
                chatRepository.addMessage(initialChat.id, 'ai', `Session "${metadata.sessionName}" (${metadata.date}) transcribed.`);

                // 7. Fetch final state for response
                const finalSessionState = sessionRepository.findById(sessionId);
                if (!finalSessionState) throw new InternalServerError(`Failed to fetch final state for session ${sessionId}`);
                const chats = chatRepository.findChatsBySessionId(sessionId);
                const responseSession = { ...finalSessionState, chats: chats.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name})) };

                set.status = 201;
                return responseSession;

            } catch (error) {
                 console.error('[API Error] Error during session upload processing:', error);
                 if (newSession?.id) {
                     try { await deleteTranscriptFile(newSession.id); sessionRepository.deleteById(newSession.id); }
                     catch (cleanupError) { console.error(`Cleanup Error:`, cleanupError); }
                 }
                  if (error instanceof ApiError) throw error;
                  throw new InternalServerError('Session upload failed.', error as Error);
            } finally {
                 if (tempAudioPath) await deleteUploadedFile(tempAudioPath);
            }
        }, {
            body: 'uploadBody', // Reference model name by string
            response: { 201: 'fullSessionResponse', 400: t.Any(), 500: t.Any() }, // Reference model name by string
            detail: { summary: 'Upload session audio & metadata' }
            // No 'type' property needed here
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app // Reference model name by string
             .derive(({ params }) => {
                 const session = sessionRepository.findById(params.sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${params.sessionId}`);
                 return { sessionData: session };
             })
             // GET /:sessionId
             .get('/:sessionId', async ({ sessionData }) => {
                 const transcriptContent = await loadTranscriptContent(sessionData.id);
                 const chats = chatRepository.findChatsBySessionId(sessionData.id);
                 const chatMetadata = chats.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                 return { ...sessionData, transcriptContent, chats: chatMetadata };
             }, {
                 response: { 200: 'fullSessionResponse' }, // Reference model name by string
                 detail: { summary: 'Get full session details' }
             })
             // PUT /:sessionId/metadata
             .put('/:sessionId/metadata', ({ sessionData, body, set }) => {
                  const updatedSession = sessionRepository.updateMetadata(sessionData.id, body);
                  if (!updatedSession) throw new NotFoundError(`Session during update`);
                  set.status = 200;
                  return updatedSession;
             }, {
                 body: 'metadataUpdateBody', // Reference model name by string
                 response: { 200: 'sessionMetadataResponse' }, // Reference model name by string
                 detail: { summary: 'Update session metadata' }
             })
             // GET /:sessionId/transcript
             .get('/:sessionId/transcript', async ({ sessionData }) => {
                 const transcriptContent = await loadTranscriptContent(sessionData.id);
                 return { transcriptContent };
             }, {
                 response: { 200: 'transcriptResponse' }, // Reference model name by string
                 detail: { summary: 'Get transcript content' }
             })
             // PATCH /:sessionId/transcript
             .patch('/:sessionId/transcript', async ({ sessionData, body, set }) => {
                  const { paragraphIndex, newText } = body;
                  const currentTranscript = await loadTranscriptContent(sessionData.id);
                  if (currentTranscript === null || currentTranscript === undefined) throw new NotFoundError(`Transcript for session ${sessionData.id}`);
                  const updatedTranscript = updateParagraphInTranscript(currentTranscript, paragraphIndex, newText);
                  if (updatedTranscript !== currentTranscript) {
                      await saveTranscriptContent(sessionData.id, updatedTranscript);
                  }
                  set.status = 200;
                  return { transcriptContent: updatedTranscript };
             }, {
                 body: 'paragraphUpdateBody', // Reference model name by string
                 response: { 200: 'transcriptResponse' }, // Reference model name by string
                 detail: { summary: 'Update transcript paragraph' }
             })
         ) // End guard
    ) // End group
    