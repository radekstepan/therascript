import { Elysia, t, type Static, type Context as ElysiaContext, type Cookie } from 'elysia'; // Ensure Cookie and ElysiaContext are imported
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs'; // Sync version for stat check
import { Readable } from 'node:stream';
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
    WhisperJobStatus
} from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError, ConflictError } from '../errors.js';
import config from '../config/index.js';

// --- Schemas (remain the same) ---
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
    audioPath: t.Optional(t.Union([t.String(), t.Null()]))
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
    audioPath: t.Union([t.String(), t.Null()]),
    status: t.String(),
    whisperJobId: t.Union([t.String(), t.Null()]),
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

// --- Helper to get absolute audio path from stored relative/filename ---
// --- MODIFIED HELPER ---
const getAbsoluteAudioPath = (storedPathOrFilename: string | null): string | null => {
    const uploadsDir = config.db.uploadsDir; // Ensure config is accessible here
    if (!storedPathOrFilename) {
        console.warn("[getAbsoluteAudioPath] Received null or empty path/filename.");
        return null;
    }

    // If it somehow *is* absolute (e.g., old data), log a warning and check existence.
    if (path.isAbsolute(storedPathOrFilename)) {
         console.warn(`[getAbsoluteAudioPath] WARNING: Received an absolute path '${storedPathOrFilename}' from DB. This indicates old data or an issue saving relative paths. Checking if it exists...`);
         // Check if this absolute path actually exists, otherwise it's definitely wrong.
         if (fsSync.existsSync(storedPathOrFilename)) {
             console.log(`[getAbsoluteAudioPath] Absolute path from DB exists. Using it directly.`);
            return storedPathOrFilename;
         } else {
            console.error(`[getAbsoluteAudioPath] The absolute path '${storedPathOrFilename}' from DB does not exist. Cannot resolve audio.`);
            // Returning null will cause a 404 in the audio handler
            return null;
         }
    }

    // If it's relative (expected case for new data), join it with the configured uploads directory.
    const absolutePath = path.join(uploadsDir, storedPathOrFilename);
    console.log(`[getAbsoluteAudioPath] Resolved relative identifier '${storedPathOrFilename}' to absolute path: ${absolutePath}`);
    return absolutePath;
};
// --- END MODIFIED HELPER ---


// --- Elysia Plugins ---
const sessionRoutesInstance = new Elysia({ prefix: '/api' })
    .model({
        // ... models remain the same ...
        sessionIdParam: SessionIdParamSchema,
        jobIdParam: JobIdParamSchema,
        paragraphUpdateBody: ParagraphUpdateBodySchema,
        metadataUpdateBody: SessionMetadataUpdateBodySchema,
        uploadBody: UploadBodySchema,
        sessionMetadataResponse: SessionMetadataResponseSchema,
        sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
        transcriptResponse: TranscriptResponseSchema,
        transcriptionStatusResponse: TranscriptionStatusResponseSchema,
    })
    // --- Transcription Status Endpoint ---
    .group('/transcription', { detail: { tags: ['Transcription'] } }, (app) => app
        .get('/status/:jobId', async ({ params }) => {
            // ... handler remains the same ...
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
            let absoluteTempAudioPath: string | null = null;
            let savedAudioIdentifier: string | null = null; // This will hold the FILENAME
            let newSession: BackendSession | null = null;

            try {
                const tempFileName = `upload-${Date.now()}-${path.parse(audioFile.name).name}${path.extname(audioFile.name)}`;
                absoluteTempAudioPath = path.resolve(config.db.uploadsDir, tempFileName);
                savedAudioIdentifier = tempFileName; // Store ONLY the filename
                // --- ADDED LOGGING ---
                console.log(`[API Upload] Generated audioIdentifier (relative filename): ${savedAudioIdentifier}`);
                // --- END LOGGING ---

                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(absoluteTempAudioPath, Buffer.from(audioBuffer));
                console.log(`[API Upload] Temporary audio saved to ${absoluteTempAudioPath}`);

                const jobId = await startTranscriptionJob(absoluteTempAudioPath);
                console.log(`[API Upload] Transcription job started. Job ID: ${jobId}`);

                const creationTimestamp = new Date().toISOString();
                // --- ADDED LOGGING ---
                console.log(`[API Upload] Calling sessionRepository.create with audioIdentifier: ${savedAudioIdentifier}`);
                // --- END LOGGING ---
                newSession = sessionRepository.create(
                    { ...metadata, date },
                    audioFile.name, // Keep original filename for metadata if needed
                    null,
                    savedAudioIdentifier, // Pass the relative filename to the repository
                    creationTimestamp
                );
                if (!newSession) throw new InternalServerError('Failed to create initial session record.');

                 const updatedSession = sessionRepository.updateMetadata(newSession.id, {
                    status: 'transcribing', whisperJobId: jobId,
                 });
                 if (!updatedSession) throw new InternalServerError(`Failed to update status for session ${newSession.id}.`);

                console.log(`[API Upload] DB session record created (ID: ${updatedSession.id}). Audio identifier saved: ${savedAudioIdentifier}`);
                set.status = 202;
                return { sessionId: updatedSession.id, jobId: jobId, message: "Upload successful, transcription started." };
            } catch (error) {
                 console.error('[API Error] Error during session upload initiation:', error);
                 if (newSession?.id) {
                     console.log(`[API Upload Cleanup] Attempting cleanup for incomplete session ${newSession.id}...`);
                     try {
                         // Use absolute path for deletion check/call
                         if (absoluteTempAudioPath && fsSync.existsSync(absoluteTempAudioPath)) {
                             await deleteUploadedFile(absoluteTempAudioPath);
                         }
                         sessionRepository.deleteById(newSession.id);
                         console.log(`[API Upload Cleanup] DB record and potentially temp audio deleted.`);
                      }
                     catch (cleanupError) { console.error(`[API Upload Cleanup] Error during cleanup:`, cleanupError); }
                 }
                  if (error instanceof ApiError) throw error;
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error during upload';
                  throw new InternalServerError(`Session upload failed: ${errorMessage}`, error instanceof Error ? error : undefined);
             }
        }, {
             beforeHandle: ({ body, set }) => { /* ... validation ... */
                const file = body.audioFile;
                const maxSizeInBytes = parseSize(config.upload.maxFileSize);
                if (!config.upload.allowedMimeTypes.includes(file.type)) { throw new BadRequestError(`Invalid file type: ${file.type}. Allowed: ${config.upload.allowedMimeTypes.join(', ')}`); }
                if (file.size > maxSizeInBytes) { throw new BadRequestError(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${config.upload.maxFileSize}.`); }
                if (file.size === 0) { throw new BadRequestError('Uploaded audio file cannot be empty.'); }
            },
            body: 'uploadBody',
            response: { 202: t.Object({ sessionId: t.Number(), jobId: t.String(), message: t.String() }), /* ... errors */ },
            detail: { summary: 'Upload session audio & metadata, start transcription' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(({ params }) => {
                 // ... derive logic ...
                 const sessionId = parseInt(params.sessionId, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID format');
                 const session = sessionRepository.findById(sessionId);
                 if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
                 return { sessionData: session };
              })
             // Other session routes remain the same...
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

             // GET audio handler uses the corrected getAbsoluteAudioPath
             .get('/:sessionId/audio', (
                 context: {
                     params: Static<typeof SessionIdParamSchema>,
                     request: Request,
                     set: ElysiaContext['set'],
                     sessionData: BackendSession
                     query: Record<string, string | undefined>,
                     body: unknown,
                 }
             ) => {
                const { params, request, set, sessionData } = context;
                const sessionId = sessionData.id;
                // Call helper with the relative path stored in DB
                const absoluteAudioPath = getAbsoluteAudioPath(sessionData.audioPath);

                console.log(`[API Audio] Request for audio for session ${sessionId}. Stored Identifier: ${sessionData.audioPath}, Resolved Path: ${absoluteAudioPath}`); // Log identifier and resolved path

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
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                        const chunksize = (end - start) + 1;

                        if (start >= fileSize || end >= fileSize || start > end) {
                            set.status = 416;
                            set.headers['Content-Range'] = `bytes */${fileSize}`;
                            return "Range Not Satisfiable";
                        }

                        const fileStream = fsSync.createReadStream(absoluteAudioPath, { start, end });
                        set.status = 206;
                        set.headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
                        set.headers['Accept-Ranges'] = 'bytes';
                        set.headers['Content-Length'] = chunksize.toString();
                        const ext = path.extname(absoluteAudioPath).toLowerCase();
                        const mimeTypes: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', };
                        set.headers['Content-Type'] = mimeTypes[ext] || 'application/octet-stream';

                        console.log(`[API Audio] Serving range ${start}-${end}/${fileSize}`);
                        return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>);

                    } else {
                        set.status = 200;
                        set.headers['Content-Length'] = fileSize.toString();
                         const ext = path.extname(absoluteAudioPath).toLowerCase();
                         const mimeTypes: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', };
                        set.headers['Content-Type'] = mimeTypes[ext] || 'application/octet-stream';
                        set.headers['Accept-Ranges'] = 'bytes';

                        console.log(`[API Audio] Serving full file (${fileSize} bytes)`);
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
             // Finalize and Delete routes remain the same...
             .post('/:sessionId/finalize', async ({ params, set, sessionData }) => { /* ... */
                  const sessionId = sessionData.id;
                  console.log(`[API Finalize] Request received for session ${sessionId}`);
                  if (sessionData.status !== 'transcribing') { throw new ConflictError(`Session ${sessionId} status is '${sessionData.status}', not 'transcribing'.`); }
                  if (!sessionData.whisperJobId) { throw new InternalServerError(`Session ${sessionId} is transcribing but has no Whisper Job ID.`); }
                  const jobId = sessionData.whisperJobId;
                  const audioIdentifierToDelete = sessionData.audioPath; // Relative filename

                  try {
                      const structuredTranscript = await getStructuredTranscriptionResult(jobId);
                      // saveTranscriptContent now returns the relative path
                      const relativeTranscriptPath = await saveTranscriptContent(sessionId, structuredTranscript);
                      const finalizedSession = sessionRepository.updateMetadata(sessionId, { status: 'completed', transcriptPath: relativeTranscriptPath, }); // Store relative path
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
                   } finally {
                       // Resolve path for deletion
                       const absoluteAudioPathToDelete = getAbsoluteAudioPath(audioIdentifierToDelete);
                       if (absoluteAudioPathToDelete) { deleteUploadedFile(absoluteAudioPathToDelete).catch(delErr => { console.error(`[API Finalize Cleanup] Failed to delete uploaded audio file ${absoluteAudioPathToDelete}:`, delErr); }); } else { console.warn(`[API Finalize Cleanup] Could not resolve audio path from identifier '${audioIdentifierToDelete}' for session ${sessionId} to delete.`); }
                   }
             }, {
                  response: { 200: 'sessionWithChatsMetadataResponse', 409: t.Any(), 500: t.Any() },
                  detail: { summary: 'Finalize session after successful transcription' }
             })
             .delete('/:sessionId', async ({ params, set, sessionData }) => { /* ... */
                 const sessionId = sessionData.id;
                 console.log(`[API Delete] Request received for session ${sessionId}`);
                 const transcriptPathToDelete = sessionData.transcriptPath; // Relative path if set
                 const audioIdentifierToDelete = sessionData.audioPath; // Relative filename

                 try {
                     // deleteTranscriptFile expects ID
                     if (transcriptPathToDelete) { await deleteTranscriptFile(sessionId); } else { console.log(`[API Delete] Session ${sessionId} has no transcript file.`); }
                     const deleted = sessionRepository.deleteById(sessionId);
                     if (!deleted) { throw new NotFoundError(`Session ${sessionId} not found during deletion.`); }
                     console.log(`[API Delete] Successfully deleted session DB record ${sessionId}.`);
                     // Resolve path for deletion
                     const absoluteAudioPathToDelete = getAbsoluteAudioPath(audioIdentifierToDelete);
                     if (absoluteAudioPathToDelete) { await deleteUploadedFile(absoluteAudioPathToDelete); } else { console.warn(`[API Delete] Could not resolve audio path from identifier '${audioIdentifierToDelete}' for session ${sessionId} to delete.`); }
                     set.status = 200;
                     return { message: `Session ${sessionId} deleted successfully.` };
                 } catch (error) {
                     console.error(`[API Error] Delete Session ${sessionId}:`, error);
                     if (error instanceof ApiError) throw error;
                     throw new InternalServerError(`Failed to delete session ${sessionId}`, error instanceof Error ? error : undefined);
                  }
             }, {
                 response: { 200: t.Object({ message: t.String() }), 404: t.Any(), 500: t.Any() },
                 detail: { summary: 'Delete a session, its transcript, associated audio, and chats' }
             })
         ) // End session ID guard
    )
    .get('/api/schema', ({ set }) => {
         set.status = 501; return { message: "API schema definition is not available here. Use /api/docs for Swagger UI." };
     }, { detail: { tags: ['Meta'] } });

export { sessionRoutesInstance as sessionRoutes };
