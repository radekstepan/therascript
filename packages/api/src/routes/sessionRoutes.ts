/* packages/api/src/routes/sessionRoutes.ts */
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
// Import new transcription service functions
import {
    startTranscriptionJob,
    getTranscriptionStatus,
    getStructuredTranscriptionResult
} from '../services/transcriptionService.js';
import type {
    BackendSession,
    BackendSessionMetadata,
    StructuredTranscript,
    TranscriptParagraphData,
    WhisperJobStatus // Import WhisperJobStatus
} from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError, ConflictError } from '../errors.js';
import config from '../config/index.js';
// REMOVED: import { chatRoutes } from './chatRoutes.js'; // No longer needed here

// --- Schemas (Update/Add) ---
const SessionIdParamSchema = t.Object({
    sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" })
});
const JobIdParamSchema = t.Object({ // New schema for job ID
    jobId: t.String({ minLength: 1, error: "Job ID must be provided" })
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
    // Removed transcriptPath from update body - managed internally now
    // transcriptPath: t.Optional(t.String()),
    // Added status and jobId for internal updates
    status: t.Optional(t.Union([ t.Literal('pending'), t.Literal('transcribing'), t.Literal('completed'), t.Literal('failed') ])),
    whisperJobId: t.Optional(t.Union([t.String(), t.Null()]))
}));
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(),
    fileName: t.String(),
    clientName: t.String(),
    sessionName: t.String(),
    date: t.String(),
    sessionType: t.String(),
    therapy: t.String(),
    transcriptPath: t.Union([t.String(), t.Null()]), // Path can be null initially
    status: t.String(), // Add status
    whisperJobId: t.Union([t.String(), t.Null()]), // Add whisperJobId
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema; // List items include status now

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

const TranscriptParagraphSchema = t.Object({
    id: t.Number(),
    timestamp: t.Number(),
    text: t.String()
});
const TranscriptResponseSchema = t.Array(TranscriptParagraphSchema);

const UploadBodySchema = t.Object({
    audioFile: t.File({ error: "Audio file is required." }),
    clientName: t.String({ minLength: 1, error: "Client name required." }),
    sessionName: t.String({ minLength: 1, error: "Session name required." }),
    date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD." }),
    sessionType: t.String({ minLength: 1, error: "Session type required." }),
    therapy: t.String({ minLength: 1, error: "Therapy type required." }),
});

// New Schema for Transcription Status Response
const TranscriptionStatusResponseSchema = t.Object({
    job_id: t.String(),
    status: t.Union([
        t.Literal("queued"),
        t.Literal("processing"),
        t.Literal("completed"),
        t.Literal("failed"),
        t.Literal("canceled"),
    ]),
    progress: t.Optional(t.Number()),
    // *** FIX: Allow error and duration to be explicitly null ***
    error: t.Optional(t.Union([t.String(), t.Null()])),
    duration: t.Optional(t.Union([t.Number(), t.Null()])),
});


// Helper to parse human-readable size string
const parseSize = (sizeStr: string): number => {
    const lowerStr = sizeStr.toLowerCase();
    const value = parseFloat(lowerStr);
    if (isNaN(value)) return 0;
    if (lowerStr.endsWith('g') || lowerStr.endsWith('gb')) return value * 1024 * 1024 * 1024;
    if (lowerStr.endsWith('m') || lowerStr.endsWith('mb')) return value * 1024 * 1024;
    if (lowerStr.endsWith('k') || lowerStr.endsWith('kb')) return value * 1024;
    return value;
};

// --- Elysia Plugins ---
export const sessionRoutes = new Elysia({ prefix: '/api' }) // Base prefix /api
    .model({
        sessionIdParam: SessionIdParamSchema,
        jobIdParam: JobIdParamSchema, // Add job ID param model
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
        transcriptionStatusResponse: TranscriptionStatusResponseSchema, // Add status response model
    })
    // --- Transcription Status Endpoint ---
    .group('/transcription', { detail: { tags: ['Transcription'] } }, (app) => app
        .get('/status/:jobId', async ({ params }) => {
            const { jobId } = params;
            try {
                const status: WhisperJobStatus = await getTranscriptionStatus(jobId);
                // Map to the response schema (omitting the large 'result' field)
                // This data structure should now match the updated schema
                return {
                    job_id: status.job_id,
                    status: status.status,
                    progress: status.progress,
                    error: status.error, // Can be null
                    duration: status.duration, // Can be null
                };
            } catch (error) {
                 console.error(`[API Error] Transcription Status (Job ID: ${jobId}):`, error);
                 if (error instanceof ApiError) throw error;
                 throw new InternalServerError(`Failed to get transcription status for job ${jobId}`, error instanceof Error ? error : undefined);
            }
        }, {
            params: 'jobIdParam',
            response: { 200: 'transcriptionStatusResponse' }, // Schema now allows nulls
            detail: { summary: 'Get transcription job status and progress' }
        })
    )
    // --- Session Endpoints ---
    .group('/sessions', { detail: { tags: ['Session'] } }, (app) => app
        .get('/', listSessions, {
            response: { 200: t.Array(SessionListResponseItemSchema) },
            detail: { summary: 'List all sessions (metadata only)' }
        })
        // POST /api/sessions/upload (Modified)
        .post('/upload', async ({ body, set }) => {
            const { audioFile, ...metadata } = body;
            let tempAudioPath: string | null = null;
            let newSession: BackendSession | null = null; // Keep track of session if created

            try {
                // 1. Save uploaded file temporarily
                const tempFileName = `upload-${Date.now()}-${path.parse(audioFile.name).name}${path.extname(audioFile.name)}`;
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer));
                console.log(`[API Upload] Temporary audio saved to ${tempAudioPath}`);

                // 2. Start transcription job
                const jobId = await startTranscriptionJob(tempAudioPath);
                console.log(`[API Upload] Transcription job started. Job ID: ${jobId}`);

                // 3. Create Session in DB with NULL transcript path initially
                newSession = await sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, null);
                if (!newSession) throw new InternalServerError('Failed to create initial session record.');

                // 4. Update session status and job ID immediately
                const updatedSession = await sessionRepository.updateMetadata(newSession.id, {
                    status: 'transcribing',
                    whisperJobId: jobId,
                });
                 if (!updatedSession) throw new InternalServerError(`Failed to update status for session ${newSession.id}.`);

                console.log(`[API Upload] DB session record created (ID: ${updatedSession.id}) with status 'transcribing'.`);

                // 5. Return 202 Accepted with session ID and job ID
                set.status = 202; // Accepted
                return {
                    sessionId: updatedSession.id,
                    jobId: jobId,
                    message: "Upload successful, transcription started.",
                };

            } catch (error) {
                 console.error('[API Error] Error during session upload initiation:', error);

                 if (error instanceof Error && error.message.includes('NOT NULL constraint failed: sessions.transcriptPath')) {
                    console.error("[API Upload Error] Encountered unexpected transcriptPath NOT NULL constraint. Check DB schema again.");
                     throw new InternalServerError('Database schema constraint error during session creation.');
                 }

                 // General cleanup logic
                 if (newSession?.id) {
                     console.log(`[API Upload Cleanup] Attempting cleanup for incomplete session ${newSession.id}...`);
                     try {
                         await sessionRepository.deleteById(newSession.id);
                         console.log(`[API Upload Cleanup] DB record deleted.`);
                     } catch (cleanupError) {
                         console.error(`[API Upload Cleanup] Error deleting DB record:`, cleanupError);
                     }
                 }
                  if (error instanceof ApiError) throw error;
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error during upload';
                  throw new InternalServerError(`Session upload failed: ${errorMessage}`, error instanceof Error ? error : undefined);
            } finally {
                 if (tempAudioPath) {
                     console.log(`[API Upload] Temporary audio file ${tempAudioPath} kept for Whisper processing.`);
                 }
            }
        }, {
            beforeHandle: ({ body, set }) => {
                const file = body.audioFile;
                const maxSizeInBytes = parseSize(config.upload.maxFileSize);
                if (!config.upload.allowedMimeTypes.includes(file.type)) {
                    throw new BadRequestError(`Invalid file type: ${file.type}. Allowed: ${config.upload.allowedMimeTypes.join(', ')}`);
                }
                if (file.size > maxSizeInBytes) {
                     throw new BadRequestError(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${config.upload.maxFileSize}.`);
                }
                if (file.size === 0) {
                    throw new BadRequestError('Uploaded audio file cannot be empty.');
                }
            },
            body: 'uploadBody',
            response: {
                202: t.Object({ sessionId: t.Number(), jobId: t.String(), message: t.String() }),
                400: t.Any(), 409: t.Any(), 500: t.Any()
            },
            detail: { summary: 'Upload session audio & metadata, start transcription' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(async ({ params }) => {
                 const sessionId = parseInt(params.sessionId, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID format');
                 const session = await sessionRepository.findById(sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
                 return { sessionData: session };
             })
             .get('/:sessionId', getSessionDetails, {
                 response: { 200: 'sessionWithChatsMetadataResponse' },
                 detail: { summary: 'Get session metadata & chat list' }
             })
             .put('/:sessionId/metadata', updateSessionMetadata, {
                 body: 'metadataUpdateBody',
                 response: { 200: 'sessionMetadataResponse' },
                 detail: { summary: 'Update session metadata (excluding transcript path)' }
             })
             .get('/:sessionId/transcript', getTranscript, {
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Get structured transcript content (if completed)' }
             })
             .patch('/:sessionId/transcript', updateTranscriptParagraph, {
                 body: 'paragraphUpdateBody',
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Update transcript paragraph (if completed)' }
             })
             // POST /api/sessions/{sessionId}/finalize (New)
             .post('/:sessionId/finalize', async ({ params, set, sessionData }) => {
                  const sessionId = sessionData.id;
                  console.log(`[API Finalize] Request received for session ${sessionId}`);

                  if (sessionData.status !== 'transcribing') {
                      console.warn(`[API Finalize] Session ${sessionId} is not in 'transcribing' state (current: ${sessionData.status}).`);
                      if (sessionData.status === 'completed') {
                            const chatsRaw = await chatRepository.findChatsBySessionId(sessionId);
                            const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                            set.status = 200;
                            return { ...sessionData, chats: chatsMetadata };
                      }
                      throw new ConflictError(`Session ${sessionId} cannot be finalized. Status: ${sessionData.status}.`);
                  }
                  if (!sessionData.whisperJobId) {
                      throw new InternalServerError(`Session ${sessionId} is transcribing but has no associated Job ID.`);
                  }

                  const jobId = sessionData.whisperJobId;

                  try {
                      const structuredTranscript = await getStructuredTranscriptionResult(jobId);
                      console.log(`[API Finalize] Successfully retrieved structured transcript for job ${jobId}.`);

                      const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.json`);
                      await saveTranscriptContent(sessionId, structuredTranscript);
                      console.log(`[API Finalize] Structured transcript saved to ${finalTranscriptPath}`);

                      const finalizedSession = await sessionRepository.updateMetadata(sessionId, {
                          status: 'completed',
                          transcriptPath: finalTranscriptPath,
                      });
                      if (!finalizedSession) throw new InternalServerError(`Failed to update final status/path for session ${sessionId}.`);
                      console.log(`[API Finalize] DB session ${sessionId} updated to 'completed'.`);

                      const existingChats = await chatRepository.findChatsBySessionId(sessionId);
                      let initialChat = existingChats.sort((a, b) => a.timestamp - b.timestamp)[0];
                      if (!initialChat) {
                            initialChat = await chatRepository.createChat(sessionId);
                            await chatRepository.addMessage(initialChat.id, 'ai', `Session "${finalizedSession.sessionName}" uploaded on ${finalizedSession.date} has been transcribed and is ready for analysis.`);
                            console.log(`[API Finalize] Initial chat created (ID: ${initialChat.id}) for session ${sessionId}.`);
                      } else {
                           console.log(`[API Finalize] Initial chat already exists (ID: ${initialChat.id}) for session ${sessionId}.`);
                      }

                      const finalSessionState = await sessionRepository.findById(sessionId);
                      if (!finalSessionState) throw new InternalServerError(`Failed to fetch final state for session ${sessionId}`);
                      const chatsRaw = await chatRepository.findChatsBySessionId(sessionId);
                      const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));

                      set.status = 200; // OK
                      return { ...finalSessionState, chats: chatsMetadata };

                  } catch (error) {
                      console.error(`[API Error] Finalize Session ${sessionId}:`, error);
                      try {
                           await sessionRepository.updateMetadata(sessionId, { status: 'failed' });
                           console.log(`[API Finalize] Marked session ${sessionId} as 'failed' due to finalization error.`);
                      } catch (updateError) {
                           console.error(`[API Finalize] CRITICAL: Failed to mark session ${sessionId} as failed after finalization error:`, updateError);
                      }

                      if (error instanceof ApiError) throw error;
                      throw new InternalServerError(`Failed to finalize session ${sessionId}`, error instanceof Error ? error : undefined);
                  } finally {
                      console.warn(`[API Finalize] Cannot reliably determine temp audio path for session ${sessionId} for cleanup. Please implement temp path storage or manual cleanup.`);
                  }
             }, {
                  response: { 200: 'sessionWithChatsMetadataResponse', 409: t.Any(), 500: t.Any() },
                  detail: { summary: 'Finalize session after successful transcription' }
             })
             // Add DELETE route for session
             .delete('/:sessionId', async ({ params, set, sessionData }) => {
                 const sessionId = sessionData.id;
                 console.log(`[API Delete] Request received for session ${sessionId}`);
                 try {
                     if (sessionData.transcriptPath) {
                         await deleteTranscriptFile(sessionId);
                     } else {
                          console.log(`[API Delete] Session ${sessionId} has no transcript file to delete.`);
                     }

                     const deleted = sessionRepository.deleteById(sessionId);
                     if (!deleted) {
                         throw new NotFoundError(`Session with ID ${sessionId} not found during deletion attempt.`);
                     }
                     console.log(`[API Delete] Successfully deleted session ${sessionId} and associated data.`);

                     console.warn(`[API Delete] Cannot reliably determine original uploaded audio path for session ${sessionId} for cleanup. Please implement temp path storage or manual cleanup.`);


                     set.status = 200;
                     return { message: `Session ${sessionId} deleted successfully.` };

                 } catch (error) {
                     console.error(`[API Error] Delete Session ${sessionId}:`, error);
                     if (error instanceof ApiError) throw error;
                     throw new InternalServerError(`Failed to delete session ${sessionId}`, error instanceof Error ? error : undefined);
                 }
             }, {
                 response: { 200: t.Object({ message: t.String() }), 404: t.Any(), 500: t.Any() },
                 detail: { summary: 'Delete a session, its transcript, and associated chats' }
             })
         ) // End session ID guard
    );
