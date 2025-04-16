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
import { transcribeAudio } from '../services/transcriptionService.js'; // Uses the updated service
// Import the new types
import type { BackendSession, BackendSessionMetadata, StructuredTranscript, TranscriptParagraphData } from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError } from '../errors.js';
import config from '../config/index.js'; // Keep config import

// --- Schemas ---
const SessionIdParamSchema = t.Object({
    sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" })
});
const ParagraphUpdateBodySchema = t.Object({
    paragraphIndex: t.Numeric({ minimum: 0, error: "Paragraph index must be 0 or greater" }),
    newText: t.String() // Can be empty string
});
const SessionMetadataUpdateBodySchema = t.Partial(t.Object({
    clientName: t.Optional(t.String({ minLength: 1 })),
    sessionName: t.Optional(t.String({ minLength: 1 })),
    date: t.Optional(t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD" })),
    sessionType: t.Optional(t.String({ minLength: 1 })),
    therapy: t.Optional(t.String({ minLength: 1 })),
    fileName: t.Optional(t.String()),
    transcriptPath: t.Optional(t.String()), // Should point to .json file now
}));
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(),
    fileName: t.String(),
    clientName: t.String(),
    sessionName: t.String(),
    date: t.String(),
    sessionType: t.String(),
    therapy: t.String(),
    transcriptPath: t.String(), // Path to the .json file
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

// Define the structure for a single paragraph in the response
const TranscriptParagraphSchema = t.Object({
    id: t.Number(), // Or index used as ID
    timestamp: t.Number(), // Milliseconds
    text: t.String()
});

// Define the Transcript response schema as an array of paragraphs
const TranscriptResponseSchema = t.Array(TranscriptParagraphSchema);


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
        // Register the new transcript response schema
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
                const tempFileName = `upload-${Date.now()}-${path.parse(audioFile.name).name}${path.extname(audioFile.name)}`; // Sanitize name slightly?
                tempAudioPath = path.join(config.db.uploadsDir, tempFileName);
                const audioBuffer = await audioFile.arrayBuffer();
                await fs.writeFile(tempAudioPath, Buffer.from(audioBuffer));
                console.log(`[API Upload] Temporary audio saved to ${tempAudioPath}`);

                // 2. Transcribe Audio using the updated service
                // The service now handles calling the Whisper API endpoint and returns StructuredTranscript
                console.log(`[API Upload] Starting transcription for ${audioFile.name}...`);
                const structuredTranscript: StructuredTranscript = await transcribeAudio(tempAudioPath); // Returns StructuredTranscript
                console.log(`[API Upload] Transcription finished, got ${structuredTranscript.length} paragraphs.`);

                // 3. Create Session in DB (using temp transcript path initially - now .json)
                // Use .json extension for the temporary path as well
                const tempDbTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.json`);
                // Pass filename from the original upload
                newSession = await sessionRepository.create(metadata as BackendSessionMetadata, audioFile.name, tempDbTranscriptPath);
                if (!newSession) throw new InternalServerError('Failed to create session record.');
                console.log(`[API Upload] DB session record created (ID: ${newSession.id}) with temp JSON path.`);

                const sessionId = newSession.id;
                // Final path is now .json
                const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.json`);

                // 4. Save structured transcript content to the final path (.json)
                savedTranscriptPath = await saveTranscriptContent(sessionId, structuredTranscript); // Pass the structured data
                console.log(`[API Upload] Structured transcript content saved to ${savedTranscriptPath}`);

                // 5. Update session record with final path (.json)
                const sessionAfterUpdate = await sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath });
                if (!sessionAfterUpdate) throw new InternalServerError(`Failed to update transcript path for session ${sessionId}.`);
                newSession = sessionAfterUpdate;
                console.log(`[API Upload] DB session record updated with final transcript path: ${finalTranscriptPath}`);

                // 6. Create initial chat
                const initialChat = await chatRepository.createChat(sessionId);
                // Add a more informative initial AI message
                await chatRepository.addMessage(initialChat.id, 'ai', `Session "${metadata.sessionName}" uploaded on ${metadata.date} has been transcribed and is ready for analysis.`);
                console.log(`[API Upload] Initial chat created (ID: ${initialChat.id})`);

                // 7. Fetch final state for response (including chat metadata)
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
                    chats: chatsMetadata // Include chat metadata in the response
                };

                set.status = 201;
                return responseSession; // Return the full session details with chats

            } catch (error) {
                 console.error('[API Error] Error during session upload processing:', error);
                 // Cleanup logic
                 if (newSession?.id) {
                     console.log(`[API Upload Cleanup] Attempting cleanup for session ${newSession.id}...`);
                     try {
                        // Attempt to delete transcript file (now .json)
                        await deleteTranscriptFile(newSession.id); // Handles .json path

                        await sessionRepository.deleteById(newSession.id);
                        console.log(`[API Upload Cleanup] DB record and associated transcript file (attempted) deleted.`);
                     }
                     catch (cleanupError) { console.error(`[API Upload Cleanup] Error during cleanup:`, cleanupError); }
                 }
                  if (error instanceof ApiError) throw error;
                  // Provide more context in the error message if possible
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error during upload';
                  throw new InternalServerError(`Session upload failed: ${errorMessage}`, error instanceof Error ? error : undefined);
            } finally {
                 if (tempAudioPath) {
                    console.log(`[API Upload Cleanup] Deleting temporary audio file: ${tempAudioPath}`);
                    await deleteUploadedFile(tempAudioPath); // Uses fs.unlink with error handling
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
                // Check if file is empty
                if (file.size === 0) {
                    throw new BadRequestError('Uploaded audio file cannot be empty.');
                }
            },
            // Reference the model name defined above
            body: 'uploadBody',
            // Update response schema to match the actual return type
            response: { 201: 'sessionWithChatsMetadataResponse', 400: t.Any(), 499: t.Any(), 500: t.Any() },
            detail: { summary: 'Upload session audio & metadata, trigger transcription' }
        })

        // --- Routes requiring :sessionId ---
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(async ({ params }) => {
                 const sessionId = parseInt(params.sessionId as unknown as string, 10);
                 if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');
                 // Fetch session using the repository method
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
             // GET /:sessionId/transcript - Get structured transcript content
             .get('/:sessionId/transcript', getTranscript, {
                 // Use the updated transcriptResponse schema (array of paragraphs)
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Get structured transcript content' }
             })
             // PATCH /:sessionId/transcript - Update transcript paragraph
             .patch('/:sessionId/transcript', updateTranscriptParagraph, {
                 body: 'paragraphUpdateBody',
                 // Use the updated transcriptResponse schema (array of paragraphs)
                 response: { 200: 'transcriptResponse' },
                 detail: { summary: 'Update transcript paragraph' }
             })
         )
    );
