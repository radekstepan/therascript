// packages/api/src/routes/sessionRoutes.ts
import { Elysia, t, type Static, type Context as ElysiaContext, type Cookie } from 'elysia'; // Ensure Cookie and ElysiaContext are imported
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs'; // Sync version for stat check
import { Readable } from 'node:stream';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    listSessions, getSessionDetails, updateSessionMetadata, // <-- Ensure these are imported
    getTranscript, updateTranscriptParagraph,                 // <-- Ensure these are imported
    deleteSessionAudioHandler // <-- Import new handler
} from '../api/sessionHandler.js'; // <-- Import fixed
import {
    saveTranscriptContent,
    deleteTranscriptFile,
    // *** Import renamed function ***
    deleteUploadedAudioFile,
    saveUploadedAudio, // *** Import save function ***
    getAudioAbsolutePath, // *** Import helper ***
    calculateTokenCount, // <-- Import token calculation helper
} from '../services/fileService.js';
import {
    startTranscriptionJob, // Keep this
    getTranscriptionStatus,
    getStructuredTranscriptionResult,
    // ensureWhisperReady, // <-- Remove this import
    // stopWhisperService // <-- Remove this import
} from '../services/transcriptionService.js';
import type {
    BackendSession,
    BackendSessionMetadata,
    StructuredTranscript,
    TranscriptParagraphData,
    WhisperJobStatus
} from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError, ConflictError } from '../errors.js';
import config from '../config/index.js';

// --- Schemas (add transcriptTokenCount to responses) ---
const SessionIdParamSchema = t.Object({
    sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" })
});
const JobIdParamSchema = t.Object({
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
    status: t.Optional(t.Union([ t.Literal('pending'), t.Literal('transcribing'), t.Literal('completed'), t.Literal('failed') ])),
    whisperJobId: t.Optional(t.Union([t.String(), t.Null()])),
    audioPath: t.Optional(t.Union([t.String(), t.Null()])), // audioPath can be updated/set to null
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])), // <-- Added transcriptTokenCount
}));
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(),
    fileName: t.String(),
    clientName: t.String(),
    sessionName: t.String(),
    date: t.String(),
    sessionType: t.String(),
    therapy: t.String(),
    transcriptPath: t.Union([t.String(), t.Null()]),
    audioPath: t.Union([t.String(), t.Null()]), // Added audioPath
    status: t.String(),
    whisperJobId: t.Union([t.String(), t.Null()]),
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])), // <-- Added transcriptTokenCount
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

const TranscriptionStatusResponseSchema = t.Object({
    job_id: t.String(),
    status: t.Union([
        t.Literal("queued"), t.Literal("processing"), t.Literal("completed"),
        t.Literal("failed"), t.Literal("canceled"),
    ]),
    progress: t.Optional(t.Number()),
    error: t.Optional(t.Union([t.String(), t.Null()])),
    duration: t.Optional(t.Union([t.Number(), t.Null()])),
});
// Schema for the general delete response
const DeleteResponseSchema = t.Object({
    message: t.String()
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
const sessionRoutesInstance = new Elysia({ prefix: '/api' })
    .model({
        sessionIdParam: SessionIdParamSchema,
        jobIdParam: JobIdParamSchema,
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
        transcriptionStatusResponse: TranscriptionStatusResponseSchema,
        deleteResponse: DeleteResponseSchema, // Use general delete response schema
    })
    // --- Transcription Status Endpoint ---
    .group('/transcription', { detail: { tags: ['Transcription'] } }, (app) => app
        .get('/status/:jobId', async ({ params }) => {
            const { jobId } = params;
            try {
                const status: WhisperJobStatus = await getTranscriptionStatus(jobId);
                return {
                    job_id: status.job_id, status: status.status, progress: status.progress,
                    error: status.error, duration: status.duration,
                };
            } catch (error) {
                 console.error(`[API Error] Transcription Status (Job ID: ${jobId}):`, error);
                 if (error instanceof ApiError) throw error;
                 throw new InternalServerError(`Failed to get transcription status for job ${jobId}`, error instanceof Error ? error : undefined);
            }
         }, {
            params: 'jobIdParam',
            response: { 200: 'transcriptionStatusResponse' },
            detail: { summary: 'Get transcription job status and progress' }
        })
    )
    // --- Session Endpoints ---
    .group('/sessions', { detail: { tags: ['Session'] } }, (app) => app
        .get('/', listSessions, {
            response: { 200: t.Array(SessionListResponseItemSchema) },
            detail: { summary: 'List all sessions (metadata only)' }
        })
        .post('/upload', async ({ body, set }) => {
            const { audioFile, date, ...metadata } = body;
            let savedAudioIdentifier: string | null = null; // This will hold the RELATIVE filename
            let newSession: BackendSession | null = null;
            let tempSavedAudioPathForTranscription: string | null = null; // Absolute path for Whisper

            try {
                // 1. Create initial DB record to get ID
                const creationTimestamp = new Date().toISOString();
                console.log('[API Upload] Creating initial DB record...');
                newSession = sessionRepository.create(
                    { ...metadata, date },
                    audioFile.name,
                    null, // No transcript path yet
                    null, // No audio path yet
                    creationTimestamp
                );
                if (!newSession) throw new InternalServerError('Failed to create initial session record.');
                const sessionId = newSession.id;
                console.log(`[API Upload] Initial DB record created (ID: ${sessionId})`);

                // 2. Save the audio file using the session ID
                const audioBuffer = await audioFile.arrayBuffer();
                // saveUploadedAudio returns the relative filename (e.g., '123-timestamp.mp3')
                console.log(`[API Upload] Saving audio file for session ${sessionId}...`);
                savedAudioIdentifier = await saveUploadedAudio(sessionId, audioFile.name, Buffer.from(audioBuffer));
                console.log(`[API Upload] Audio saved successfully. Identifier: ${savedAudioIdentifier}`);

                // 3. Update the session record with the relative audio path
                console.log(`[API Upload] Updating DB record with audioPath: ${savedAudioIdentifier}`);
                const updatedSessionWithAudioPath = sessionRepository.updateMetadata(sessionId, {
                    audioPath: savedAudioIdentifier
                });
                if (!updatedSessionWithAudioPath) throw new InternalServerError(`Failed to update session ${sessionId} with audio path.`);
                console.log(`[API Upload] DB record updated with audioPath.`);

                // 4. Resolve the absolute path *only* for sending to Whisper
                tempSavedAudioPathForTranscription = getAudioAbsolutePath(savedAudioIdentifier);
                if (!tempSavedAudioPathForTranscription) {
                    // This indicates an issue with resolving the path we just saved, serious problem
                    throw new InternalServerError(`Could not resolve absolute path for saved audio identifier: ${savedAudioIdentifier}`);
                }
                console.log(`[API Upload] Resolved absolute path for transcription: ${tempSavedAudioPathForTranscription}`);

                // 5. Start transcription job using the absolute path (this now includes the health check)
                console.log(`[API Upload] Starting transcription job...`);
                const jobId = await startTranscriptionJob(tempSavedAudioPathForTranscription); // Health check happens inside
                console.log(`[API Upload] Transcription job started for session ${sessionId}. Job ID: ${jobId}`);

                // 6. Update session status and job ID in DB
                 console.log(`[API Upload] Updating DB record status to 'transcribing' and jobId ${jobId}...`);
                 const finalUpdatedSession = sessionRepository.updateMetadata(sessionId, {
                    status: 'transcribing', whisperJobId: jobId,
                 });
                 if (!finalUpdatedSession) throw new InternalServerError(`Failed to update status/jobId for session ${sessionId}.`);
                 console.log(`[API Upload] DB record update complete. Session ${sessionId} is now 'transcribing'.`);

                set.status = 202;
                return { sessionId: finalUpdatedSession.id, jobId: jobId, message: "Upload successful, transcription started." };

            } catch (error) {
                 const originalError = error instanceof Error ? error : new Error(String(error));
                 console.error('[API Error] Error during session upload processing:', originalError.message);
                 if (!(error instanceof ApiError)) { // Log stack for unexpected errors
                    console.error(originalError.stack);
                 }

                 // --- Refined Cleanup Logic for Hard Delete on Failure ---
                 if (newSession?.id) {
                     const sessionIdForCleanup = newSession.id;
                     console.log(`[API Upload Cleanup] Initiating HARD DELETE cleanup for session ${sessionIdForCleanup} due to processing error.`);
                     try {
                         const currentSessionState = sessionRepository.findById(sessionIdForCleanup);
                         if (currentSessionState) {
                             // Attempt to delete audio file if it was saved
                             if (savedAudioIdentifier) {
                                 console.log(`[API Upload Cleanup] Attempting to delete potentially saved audio file: ${savedAudioIdentifier}`);
                                 try { await deleteUploadedAudioFile(savedAudioIdentifier); } catch (audioDelErr) { console.error(`[API Upload Cleanup] Failed to delete audio file ${savedAudioIdentifier} during cleanup:`, audioDelErr); }
                             } else {
                                console.log(`[API Upload Cleanup] No audio file identifier recorded, skipping audio delete.`);
                             }
                             // Delete the database record (this should cascade to chats/messages)
                             console.log(`[API Upload Cleanup] Deleting incomplete/failed DB record for session ${sessionIdForCleanup}.`);
                             sessionRepository.deleteById(sessionIdForCleanup);
                         } else {
                             console.log(`[API Upload Cleanup] Session ${sessionIdForCleanup} not found in DB for cleanup.`);
                         }
                     } catch (cleanupError) {
                         console.error(`[API Upload Cleanup] Error during HARD DELETE cleanup for session ${sessionIdForCleanup}:`, cleanupError);
                     }
                 } else {
                     console.log("[API Upload Cleanup] No session ID available, skipping specific cleanup.");
                 }
                 // --- End Hard Delete Cleanup Logic ---

                 // Re-throw the original error to be handled by the global error handler
                 if (error instanceof ApiError) throw error;
                 const errorMessage = error instanceof Error ? error.message : 'Unknown error during upload';
                 throw new InternalServerError(`Session upload failed: ${errorMessage}`, error instanceof Error ? error : undefined);
             }
        }, {
             beforeHandle: ({ body, set }) => {
                const file = body.audioFile;
                const maxSizeInBytes = parseSize(config.upload.maxFileSize);
                if (!config.upload.allowedMimeTypes.includes(file.type)) { throw new BadRequestError(`Invalid file type: ${file.type}. Allowed: ${config.upload.allowedMimeTypes.join(', ')}`); }
                if (file.size > maxSizeInBytes) { throw new BadRequestError(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${config.upload.maxFileSize}.`); }
                if (file.size === 0) { throw new BadRequestError('Uploaded audio file cannot be empty.'); }
            },
            body: 'uploadBody',
            response: {
                202: t.Object({ sessionId: t.Number(), jobId: t.String(), message: t.String() }),
                // Add specific error schemas
                400: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }), // BadRequestError
                500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }), // InternalServerError
                503: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) })  // ServiceUnavailableError
             },
            detail: { summary: 'Upload session audio & metadata, start transcription' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(({ params }) => {
                 const sessionId = parseInt(params.sessionId, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID format');
                 const session = sessionRepository.findById(sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
                 return { sessionData: session };
              })
             .get('/:sessionId', ({ sessionData, set }) => getSessionDetails({ sessionData, set }), {
                 response: { 200: 'sessionWithChatsMetadataResponse' },
                 detail: { summary: 'Get session metadata & chat list' }
             })
             .put('/:sessionId/metadata', ({ sessionData, body, set }) => updateSessionMetadata({ sessionData, body, set }), {
                 body: 'metadataUpdateBody',
                 response: { 200: 'sessionMetadataResponse' },
                 detail: { summary: 'Update session metadata' }
             })
             .get('/:sessionId/transcript', ({ sessionData, set }) => getTranscript({ sessionData, set }), {
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Get structured transcript content (if completed)' }
             })
             .patch('/:sessionId/transcript', ({ sessionData, body, set }) => updateTranscriptParagraph({ sessionData, body, set }), {
                 body: 'paragraphUpdateBody',
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Update transcript paragraph (if completed)' }
             })

             // *** GET /:sessionId/audio Endpoint ***
             .get('/:sessionId/audio', (
                 context: {
                     params: Static<typeof SessionIdParamSchema>,
                     request: Request,
                     set: ElysiaContext['set'],
                     sessionData: BackendSession // Use derived session data
                     // Add other context properties if needed by Elysia v1+
                     query: Record<string, string | undefined>,
                     body: unknown,
                     cookie: Record<string, Cookie<any>>, // Add cookie type
                     path: string, // Add path type
                     store: ElysiaContext['store'] // Add store type
                 }
             ) => {
                const { params, request, set, sessionData } = context;
                const sessionId = sessionData.id;
                // Use the helper service function with the relative path from DB
                const absoluteAudioPath = getAudioAbsolutePath(sessionData.audioPath);

                console.log(`[API Audio] Request for audio for session ${sessionId}. Stored Identifier: ${sessionData.audioPath}, Resolved Path: ${absoluteAudioPath}`);

                // Check existence using the resolved absolute path
                if (!absoluteAudioPath || !fsSync.existsSync(absoluteAudioPath)) {
                    console.error(`[API Audio] Audio file not found for session ${sessionId} at resolved path: ${absoluteAudioPath}`);
                    throw new NotFoundError(`Audio file for session ${sessionId}`);
                }

                try {
                    const stats = fsSync.statSync(absoluteAudioPath);
                    const fileSize = stats.size;
                    const range = request.headers.get('range');

                    if (range) {
                        // Handle range requests (partial content)
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        // End might be missing for requests like "bytes=100-"
                        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                        const chunksize = (end - start) + 1;

                        // Validate range
                        if (start >= fileSize || end >= fileSize || start > end) {
                            set.status = 416; // Range Not Satisfiable
                            set.headers['Content-Range'] = `bytes */${fileSize}`;
                            return "Range Not Satisfiable";
                        }

                        const fileStream = fsSync.createReadStream(absoluteAudioPath, { start, end });
                        set.status = 206; // Partial Content
                        set.headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
                        set.headers['Accept-Ranges'] = 'bytes';
                        set.headers['Content-Length'] = chunksize.toString();
                        // Determine Content-Type based on file extension
                        const ext = path.extname(absoluteAudioPath).toLowerCase();
                        const mimeTypes: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', };
                        set.headers['Content-Type'] = mimeTypes[ext] || 'application/octet-stream';

                        console.log(`[API Audio] Serving range ${start}-${end}/${fileSize}`);
                        // Use Response with ReadableStream for Elysia v1+
                        return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>);

                    } else {
                        // Serve the whole file
                        set.status = 200; // OK
                        set.headers['Content-Length'] = fileSize.toString();
                         // Determine Content-Type based on file extension
                         const ext = path.extname(absoluteAudioPath).toLowerCase();
                         const mimeTypes: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', };
                        set.headers['Content-Type'] = mimeTypes[ext] || 'application/octet-stream';
                        set.headers['Accept-Ranges'] = 'bytes';

                        console.log(`[API Audio] Serving full file (${fileSize} bytes)`);
                        // Use Response with ReadableStream for Elysia v1+
                        return new Response(Readable.toWeb(fsSync.createReadStream(absoluteAudioPath)) as ReadableStream<Uint8Array>);
                    }
                } catch (error) {
                     console.error(`[API Audio] Error streaming audio file for session ${sessionId}:`, error);
                     if (error instanceof ApiError) throw error;
                     throw new InternalServerError('Failed to stream audio file', error instanceof Error ? error : undefined);
                 }
             }, {
                 response: { 200: t.Unknown(), 206: t.Unknown(), 404: t.Any(), 416: t.Any(), 500: t.Any() },
                 detail: { summary: 'Stream the original session audio file' }
             })

             // Finalize and Delete routes need to handle audio file deletion
             .post('/:sessionId/finalize', async ({ params, set, sessionData }) => {
                  const sessionId = sessionData.id;
                  console.log(`[API Finalize] Request received for session ${sessionId}`);
                  if (sessionData.status !== 'transcribing') { throw new ConflictError(`Session ${sessionId} status is '${sessionData.status}', not 'transcribing'.`); }
                  if (!sessionData.whisperJobId) { throw new InternalServerError(`Session ${sessionId} is transcribing but has no Whisper Job ID.`); }
                  const jobId = sessionData.whisperJobId;

                  try {
                      const structuredTranscript = await getStructuredTranscriptionResult(jobId);
                      // Save transcript and get token count
                      const { relativePath: relativeTranscriptPath, tokenCount } = await saveTranscriptContent(sessionId, structuredTranscript);
                      const finalizedSession = sessionRepository.updateMetadata(sessionId, {
                          status: 'completed',
                          transcriptPath: relativeTranscriptPath, // Store relative path
                          transcriptTokenCount: tokenCount, // <-- Store token count
                      });
                      if (!finalizedSession) throw new InternalServerError(`Failed to update session ${sessionId} status to completed.`);
                      const finalSessionState = sessionRepository.findById(sessionId);
                      if (!finalSessionState) throw new InternalServerError(`Failed to retrieve session ${sessionId} after finalizing.`);
                      const existingChats = chatRepository.findChatsBySessionId(sessionId);
                      let initialChat = existingChats.sort((a, b) => a.timestamp - b.timestamp)[0];
                      if (!initialChat) { initialChat = chatRepository.createChat(sessionId); chatRepository.addMessage(initialChat.id, 'ai', `Session "${finalizedSession.sessionName}" uploaded on ${finalizedSession.date.split('T')[0]} has been transcribed...`); console.log(`[API Finalize] Initial chat created (ID: ${initialChat.id}) for session ${sessionId}.`); }
                      const chatsRaw = chatRepository.findChatsBySessionId(sessionId);
                      const chatsMetadata = chatsRaw.map(c => ({id: c.id, sessionId: c.sessionId, timestamp: c.timestamp, name: c.name}));
                      console.log(`[API Finalize] Session ${sessionId} finalized successfully.`);
                      set.status = 200;
                      return { ...finalSessionState, audioPath: finalSessionState.audioPath, chats: chatsMetadata };
                  } catch (error) {
                      console.error(`[API Error] Finalize Session ${sessionId}:`, error);
                      try { sessionRepository.updateMetadata(sessionId, { status: 'failed' }); console.log(`[API Finalize] Marked session ${sessionId} as 'failed'.`); } catch (updateError) { console.error(`[API Finalize] CRITICAL: Failed to mark session ${sessionId} as failed:`, updateError); }
                      if (error instanceof ApiError) throw error;
                      throw new InternalServerError(`Failed to finalize session ${sessionId}`, error instanceof Error ? error : undefined);
                   }
             }, {
                  response: { 200: 'sessionWithChatsMetadataResponse', 409: t.Any(), 500: t.Any() },
                  detail: { summary: 'Finalize session after successful transcription' }
             })
             // Performs a hard delete of the session, associated files, and related DB entries (chats, messages)
             .delete('/:sessionId', async ({ params, set, sessionData }) => {
                 const sessionId = sessionData.id;
                 console.log(`[API Delete Session] Request received for session ${sessionId}`);
                 const transcriptPathToDelete = sessionData.transcriptPath; // Relative path if set
                 const audioIdentifierToDelete = sessionData.audioPath; // Relative filename

                 try {
                     // --- Attempt to delete files FIRST ---
                     if (transcriptPathToDelete) {
                         await deleteTranscriptFile(sessionId);
                     } else { console.log(`[API Delete Session] Session ${sessionId} has no transcript file path in DB.`); }

                     if (audioIdentifierToDelete) {
                        await deleteUploadedAudioFile(audioIdentifierToDelete);
                     } else {
                        console.warn(`[API Delete Session] No audio identifier found for session ${sessionId} to delete.`);
                     }
                     // --- Files deleted (or attempted) ---

                     // Delete the DB record (this will cascade to chats/messages due to schema constraints)
                     const deleted = sessionRepository.deleteById(sessionId);
                     if (!deleted) {
                        // If DB record wasn't found after attempting file deletion, log warning but return success
                        console.warn(`[API Delete Session] Session DB record ${sessionId} not found during deletion attempt (may have been deleted already?).`);
                     } else {
                        console.log(`[API Delete Session] Successfully deleted session DB record ${sessionId}.`);
                     }

                     set.status = 200;
                     return { message: `Session ${sessionId} and associated data deleted successfully.` };
                 } catch (error) {
                     console.error(`[API Error] Delete Session ${sessionId}:`, error);
                     if (error instanceof ApiError) throw error;
                     throw new InternalServerError(`Failed to fully delete session ${sessionId}`, error instanceof Error ? error : undefined);
                  }
             }, {
                 response: { 200: 'deleteResponse' }, // Use general delete response
                 detail: { summary: 'Delete a session, its transcript, associated audio, and chats' }
             })
             // --- DELETE Audio Route ---
             // Performs a hard delete of ONLY the audio file and its DB reference.
             .delete('/:sessionId/audio', ({ sessionData, set }) => deleteSessionAudioHandler({ sessionData, set }), {
                 response: {
                     200: 'deleteResponse', // Use general delete response
                     404: t.Any(), // Session or audio not found
                     500: t.Any()  // Internal error during file delete or DB update
                 },
                 detail: {
                     summary: 'Delete the original audio file for a session',
                     description: 'Deletes the audio file from storage and removes the reference from the session record in the database.'
                 }
             })
             // --- END DELETE Audio Route ---
         ) // End session ID guard
    )
    .get('/api/schema', ({ set }) => {
         set.status = 501; return { message: "API schema definition is not available here. Use /api/docs for Swagger UI." };
     }, { detail: { tags: ['Meta'] } });

export { sessionRoutesInstance as sessionRoutes };
