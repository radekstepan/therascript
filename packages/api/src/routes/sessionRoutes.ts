import { Elysia, t, type Static } from 'elysia';
import path from 'node:path';
import fs from 'node:fs/promises'; // Assuming promise fs
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    listSessions, getSessionDetails, updateSessionMetadata,
    getTranscript, updateTranscriptParagraph
} from '../api/sessionHandler.js';
import {
    saveTranscriptContent, // Assuming async
    deleteTranscriptFile, // Assuming async
    deleteUploadedFile // Assuming async
} from '../services/fileService.js';
import { transcribeAudio } from '../services/transcriptionService.js'; // Assuming async
import type { BackendSession, BackendSessionMetadata } from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError } from '../errors.js';
import config from '../config/index.js';

// --- Schemas (no changes needed here) ---
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
    fileName: t.Optional(t.String()), // These might not be user-updatable usually
    transcriptPath: t.Optional(t.String()), // These might not be user-updatable usually
}));
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
const SessionWithChatsMetadataResponseSchema = t.Intersect([
    SessionMetadataResponseSchema, // Includes transcriptPath now
    t.Object({
        chats: t.Array(ChatMetadataResponseSchema)
    })
]);
const TranscriptResponseSchema = t.Object({ transcriptContent: t.String() });
const UploadBodySchema = t.Object({
    audioFile: t.File({
        // TODO make sure we can transcribe these, move to a constants file (preserved)
         type: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/aac'],
         // TODO move max size to constants file (preserved)
         maxSize: '100m',
         error: "Invalid or missing audio file. Must be audio/* type and under 100MB."
    }),
    // Metadata fields directly in the body alongside the file
    clientName: t.String({ minLength: 1, error: "Client name required." }),
    sessionName: t.String({ minLength: 1, error: "Session name required." }),
    date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD." }),
    sessionType: t.String({ minLength: 1, error: "Session type required." }),
    therapy: t.String({ minLength: 1, error: "Therapy type required." }),
});

// --- Elysia Plugin for Session Routes ---
export const sessionRoutes = new Elysia({ prefix: '/api/sessions' })
    .model({
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
        // listSessions handler is now async
        .get('/', listSessions, {
            response: { 200: t.Array(SessionListResponseItemSchema) },
            detail: { summary: 'List all sessions (metadata only)' }
        })

        // POST /api/sessions/upload - Upload session
        // Handler must be async as it calls async functions
        .post('/upload', async ({ body, set }) => { // Handler is async
            const { audioFile, ...metadata } = body; // Destructure file and metadata

            let newSession: BackendSession | null = null;
            let tempAudioPath: string | null = null;
            let savedTranscriptPath: string | null = null;

            try {
                // 1. Save uploaded file temporarily (Assuming fs.writeFile is async)
                const tempFileName = `upload-${Date.now()}-${audioFile.name}`;
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer(); // Already async
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer)); // Added await
                console.log(`[API Upload] Temporary audio saved to ${tempAudioPath}`);

                // 2. Transcribe Audio (Assuming transcribeAudio is async)
                // TODO expose being able to cancel the task (preserved)
                console.log(`[API Upload] Starting transcription for ${audioFile.name}...`);
                const transcriptContent = await transcribeAudio(tempAudioPath); // Keep await
                console.log(`[API Upload] Transcription finished.`);

                // 3. Create Session in DB (sessionRepository.create is now async)
                const tempDbTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.txt`);
                // Add await for the async repository call
                newSession = await sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, tempDbTranscriptPath); // Added await
                // Check the resolved value
                if (!newSession) throw new InternalServerError('Failed to create session record.');
                // Access id on the resolved newSession
                console.log(`[API Upload] DB session record created (ID: ${newSession.id}) with temp path.`);

                const sessionId = newSession.id; // Get ID from resolved session
                const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.txt`);

                // 4. Save transcript content to its final destination (Assuming saveTranscriptContent is async)
                savedTranscriptPath = await saveTranscriptContent(sessionId, transcriptContent); // Keep await
                console.log(`[API Upload] Transcript content saved to ${savedTranscriptPath}`);

                // 5. Update session record with final transcript path (sessionRepository.updateMetadata is now async)
                // Add await for the async repository call
                const sessionAfterUpdate = await sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath }); // Added await
                // Check the resolved value
                if (!sessionAfterUpdate) throw new InternalServerError(`Failed to update transcript path for session ${sessionId}.`);
                newSession = sessionAfterUpdate; // Assign resolved value
                console.log(`[API Upload] DB session record updated with final transcript path: ${finalTranscriptPath}`);

                // 6. Create initial chat (chatRepository.createChat and addMessage are now async)
                const initialChat = await chatRepository.createChat(sessionId); // Added await
                // Add await for the async repository call
                await chatRepository.addMessage(initialChat.id, 'ai', `Session "${metadata.sessionName}" (${metadata.date}) transcribed.`); // Added await
                // Access id on resolved initialChat
                console.log(`[API Upload] Initial chat created (ID: ${initialChat.id})`);

                // 7. Fetch final state for response (sessionRepository.findById and findChatsBySessionId are now async)
                const finalSessionState = await sessionRepository.findById(sessionId); // Added await
                if (!finalSessionState) throw new InternalServerError(`Failed to fetch final state for session ${sessionId}`);
                const chatsRaw = await chatRepository.findChatsBySessionId(sessionId); // Added await
                // .map runs on the resolved chatsRaw array
                const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                // Access properties on resolved finalSessionState
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
                // Return the constructed object (Elysia handles the promise from the async handler)
                return responseSession;

            } catch (error) {
                 console.error('[API Error] Error during session upload processing:', error);
                 // Cleanup logic
                 if (newSession?.id) { // Check optional chaining on potentially null newSession
                     console.log(`[API Upload Cleanup] Attempting cleanup for session ${newSession.id}...`);
                     try {
                        // Assuming deleteTranscriptFile is async
                        await deleteTranscriptFile(newSession.id); // Added await
                        // sessionRepository.deleteById is now async
                        await sessionRepository.deleteById(newSession.id); // Added await
                        console.log(`[API Upload Cleanup] DB record and transcript file deleted.`);
                     }
                     catch (cleanupError) { console.error(`[API Upload Cleanup] Error during cleanup:`, cleanupError); }
                 }
                  if (error instanceof ApiError) throw error;
                  throw new InternalServerError('Session upload failed.', error instanceof Error ? error : undefined);
            } finally {
                 if (tempAudioPath) {
                    console.log(`[API Upload Cleanup] Deleting temporary audio file: ${tempAudioPath}`);
                    // Assuming deleteUploadedFile is async
                    await deleteUploadedFile(tempAudioPath); // Added await
                 }
            }
        }, {
            body: 'uploadBody',
            response: { 201: 'sessionWithChatsMetadataResponse', 400: t.Any(), 500: t.Any() },
            detail: { summary: 'Upload session audio & metadata' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             // Make derive block async
             .derive(async ({ params }) => { // Added async
                 const sessionId = parseInt(params.sessionId as unknown as string, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');
                 // sessionRepository.findById is now async
                 const session = await sessionRepository.findById(sessionId); // Added await
                 if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
                 // Return resolved session
                 return { sessionData: session };
             })
             // GET /:sessionId - Get session metadata & chat list
             // getSessionDetails handler is already async
             .get('/:sessionId', getSessionDetails, {
                 response: { 200: 'sessionWithChatsMetadataResponse' },
                 detail: { summary: 'Get session metadata & chat list' }
             })
             // PUT /:sessionId/metadata - Update session metadata
             // updateSessionMetadata handler is already async
             .put('/:sessionId/metadata', updateSessionMetadata, {
                 body: 'metadataUpdateBody',
                 response: { 200: 'sessionMetadataResponse' },
                 detail: { summary: 'Update session metadata' }
             })
             // GET /:sessionId/transcript - Get transcript content only
             // getTranscript handler is already async
             .get('/:sessionId/transcript', getTranscript, {
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Get transcript content' }
             })
             // PATCH /:sessionId/transcript - Update transcript paragraph
             // updateTranscriptParagraph handler is already async
             .patch('/:sessionId/transcript', updateTranscriptParagraph, {
                 body: 'paragraphUpdateBody',
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Update transcript paragraph' }
             })
         )
    )
    