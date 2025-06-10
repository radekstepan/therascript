import {
  Elysia,
  t,
  type Static,
  type Context as ElysiaContext,
  type Cookie,
} from 'elysia';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { Readable } from 'node:stream';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import {
  listSessions,
  getSessionDetails,
  updateSessionMetadata,
  getTranscript,
  updateTranscriptParagraph,
  deleteSessionAudioHandler,
  finalizeSessionHandler,
} from '../api/sessionHandler.js'; // Ensure finalizeSessionHandler is imported
import { calculateTokenCount } from '../services/tokenizerService.js';
import {
  deleteUploadedAudioFile,
  saveUploadedAudio,
  getAudioAbsolutePath,
} from '../services/fileService.js';
import {
  startTranscriptionJob,
  getTranscriptionStatus,
  getStructuredTranscriptionResult,
} from '../services/transcriptionService.js';
import type {
  BackendSession,
  StructuredTranscript,
  WhisperJobStatus,
  ChatMetadata,
  BackendChatSession,
} from '../types/index.js'; // Added BackendChatSession
import {
  NotFoundError,
  InternalServerError,
  ApiError,
  BadRequestError,
  ConflictError,
} from '../errors.js';
import config from '../config/index.js';
import {
  getElasticsearchClient,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
  deleteByQuery,
} from '@therascript/elasticsearch-client';

const esClient = getElasticsearchClient(config.elasticsearch.url);

// --- Schemas ---
const SessionIdParamSchema = t.Object({
  sessionId: t.String({
    pattern: '^[0-9]+$',
    error: 'Session ID must be a positive number',
  }),
});
const JobIdParamSchema = t.Object({
  jobId: t.String({ minLength: 1, error: 'Job ID must be provided' }),
});
const ParagraphUpdateBodySchema = t.Object({
  paragraphIndex: t.Numeric({
    minimum: 0,
    error: 'Paragraph index must be 0 or greater',
  }),
  newText: t.String(),
});
const SessionMetadataUpdateBodySchema = t.Partial(
  t.Object({
    clientName: t.Optional(t.String({ minLength: 1 })),
    sessionName: t.Optional(t.String({ minLength: 1 })),
    date: t.Optional(
      t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date must be YYYY-MM-DD' })
    ),
    sessionType: t.Optional(t.String({ minLength: 1 })),
    therapy: t.Optional(t.String({ minLength: 1 })),
    fileName: t.Optional(t.String()),
    status: t.Optional(
      t.Union([
        t.Literal('pending'),
        t.Literal('transcribing'),
        t.Literal('completed'),
        t.Literal('failed'),
      ])
    ),
    whisperJobId: t.Optional(t.Union([t.String(), t.Null()])),
    audioPath: t.Optional(t.Union([t.String(), t.Null()])),
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
  })
);
const SessionMetadataResponseSchema = t.Object({
  id: t.Number(),
  fileName: t.String(),
  clientName: t.String(),
  sessionName: t.String(),
  date: t.String(),
  sessionType: t.String(),
  therapy: t.String(),
  audioPath: t.Union([t.String(), t.Null()]),
  status: t.String(),
  whisperJobId: t.Union([t.String(), t.Null()]),
  transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema;
const SessionChatMetadataSchema = t.Omit(
  t.Object({
    id: t.Number(),
    sessionId: t.Number(),
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()])),
    tags: t.Optional(t.Any()),
  }),
  ['tags']
);
const SessionWithChatsMetadataResponseSchema = t.Object({
  id: t.Number(),
  fileName: t.String(),
  clientName: t.String(),
  sessionName: t.String(),
  date: t.String(),
  sessionType: t.String(),
  therapy: t.String(),
  audioPath: t.Union([t.String(), t.Null()]),
  status: t.String(),
  whisperJobId: t.Union([t.String(), t.Null()]),
  transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
  chats: t.Array(SessionChatMetadataSchema),
});
const TranscriptParagraphSchema = t.Object({
  id: t.Number(),
  timestamp: t.Number(),
  text: t.String(),
});
const TranscriptResponseSchema = t.Array(TranscriptParagraphSchema);
const UploadBodySchema = t.Object({
  audioFile: t.File({ error: 'Audio file required.' }),
  clientName: t.String({ minLength: 1, error: 'Client name required.' }),
  sessionName: t.String({ minLength: 1, error: 'Session name required.' }),
  date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date must be YYYY-MM-DD.' }),
  sessionType: t.String({ minLength: 1, error: 'Session type required.' }),
  therapy: t.String({ minLength: 1, error: 'Therapy type required.' }),
});
const TranscriptionStatusResponseSchema = t.Object({
  job_id: t.String(),
  status: t.Union([
    t.Literal('queued'),
    t.Literal('model_loading'),
    t.Literal('model_downloading'),
    t.Literal('processing'),
    t.Literal('transcribing'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('canceled'),
  ]),
  progress: t.Optional(t.Number()),
  error: t.Optional(t.Union([t.String(), t.Null()])),
  duration: t.Optional(t.Union([t.Number(), t.Null()])),
  message: t.Optional(t.String()),
});
const DeleteResponseSchema = t.Object({ message: t.String() });

const dateToIsoStringForStorage = (dateString: string): string => {
  const dt = new Date(`${dateString}T12:00:00.000Z`);
  return dt.toISOString();
};

const parseSize = (sizeStr: string): number => {
  const l = sizeStr.toLowerCase();
  const v = parseFloat(l);
  if (isNaN(v)) return 0;
  if (l.endsWith('g') || l.endsWith('gb')) return v * 1024 * 1024 * 1024;
  if (l.endsWith('m') || l.endsWith('mb')) return v * 1024 * 1024;
  if (l.endsWith('k') || l.endsWith('kb')) return v * 1024;
  return v;
};

// Define Elysia context type for handlers more explicitly if needed globally,
// or type context parameters directly in handlers.
// For instance:
// type SessionRouteContext = ElysiaContext<{ params: Static<typeof SessionIdParamSchema> }> & { sessionData: BackendSession };

export const sessionRoutes = new Elysia({ prefix: '/api' })
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
    deleteResponse: DeleteResponseSchema,
  })
  .group('/transcription', { detail: { tags: ['Transcription'] } }, (app) =>
    app.get(
      '/status/:jobId',
      async ({ params }) => {
        const { jobId } = params;
        try {
          const statusData = await getTranscriptionStatus(jobId);
          return statusData; // Handler should return data matching schema
        } catch (err) {
          console.error(`[API Err] Tx Status ${jobId}:`, err);
          if (err instanceof ApiError) throw err;
          throw new InternalServerError(
            'Failed get tx status',
            err instanceof Error ? err : undefined
          );
        }
      },
      {
        params: 'jobIdParam',
        response: {
          200: 'transcriptionStatusResponse',
          404: t.Any(),
          500: t.Any(),
        },
        detail: { summary: 'Get transcription job status' },
      }
    )
  )
  .group('/sessions', { detail: { tags: ['Session'] } }, (app) =>
    app
      .get('/', listSessions, {
        response: { 200: t.Array(SessionListResponseItemSchema) },
        detail: { summary: 'List all sessions (metadata only)' },
      })
      .post(
        '/upload',
        async ({ body, set }) => {
          const {
            audioFile,
            date: dateInput,
            ...metadata
          } = body as Static<typeof UploadBodySchema>;
          let savedAudioId: string | null = null;
          let newSess: BackendSession | null = null;
          let tempAudioPath: string | null = null;
          try {
            const isoDate = dateToIsoStringForStorage(dateInput);
            newSess = sessionRepository.create(
              { ...metadata, date: isoDate },
              audioFile.name,
              null, // audioPath set after saving
              new Date().toISOString()
            );
            if (!newSess)
              throw new InternalServerError(
                'Failed create initial session in DB.'
              );

            const sid = newSess.id;
            const buffer = await audioFile.arrayBuffer();
            savedAudioId = await saveUploadedAudio(
              sid,
              audioFile.name,
              Buffer.from(buffer)
            );

            sessionRepository.updateMetadata(sid, { audioPath: savedAudioId });
            tempAudioPath = getAudioAbsolutePath(savedAudioId);
            if (!tempAudioPath)
              throw new InternalServerError(
                'Could not resolve absolute audio path after saving.'
              );

            const jobId = await startTranscriptionJob(tempAudioPath);
            const finalSess = sessionRepository.updateMetadata(sid, {
              status: 'transcribing',
              whisperJobId: jobId,
            });
            if (!finalSess)
              throw new InternalServerError(
                'Failed update session status/jobId after starting transcription.'
              );

            set.status = 202;
            return {
              sessionId: finalSess.id,
              jobId,
              message: 'Upload successful, transcription started.',
            };
          } catch (err) {
            const origErr = err instanceof Error ? err : new Error(String(err));
            console.error(
              '[API Err] Upload session:',
              origErr.message,
              origErr.stack
            );
            if (newSess?.id) {
              try {
                const current = sessionRepository.findById(newSess.id);
                if (current) {
                  if (savedAudioId) {
                    try {
                      await deleteUploadedAudioFile(savedAudioId);
                    } catch (delErr) {
                      console.error(
                        `Cleanup audio err for ${savedAudioId}:`,
                        delErr
                      );
                    }
                  }
                  sessionRepository.deleteById(newSess.id);
                }
              } catch (cleanupErr) {
                console.error(
                  `Cleanup err for session ${newSess.id}:`,
                  cleanupErr
                );
              }
            }
            if (err instanceof ApiError) throw err;
            throw new InternalServerError(
              `Upload failed: ${origErr.message}`,
              origErr
            );
          }
        },
        {
          beforeHandle: ({ body }) => {
            const f = (body as any).audioFile as File;
            const maxS = parseSize(config.upload.maxFileSize);
            if (!f || typeof f.type !== 'string')
              throw new BadRequestError('Audio file is missing or invalid.');
            if (!config.upload.allowedMimeTypes.includes(f.type))
              throw new BadRequestError(`Invalid file type: ${f.type}`);
            if (f.size > maxS)
              throw new BadRequestError(
                `File size exceeds limit of ${config.upload.maxFileSize}`
              );
            if (f.size === 0)
              throw new BadRequestError('Uploaded file is empty.');
          },
          body: 'uploadBody',
          response: {
            202: t.Object({
              sessionId: t.Number(),
              jobId: t.String(),
              message: t.String(),
            }),
            400: t.Any(),
            500: t.Any(),
            503: t.Any(),
          },
          detail: { summary: 'Upload audio & metadata, start transcription' },
        }
      )
      .guard({ params: 'sessionIdParam' }, (app) =>
        app
          .derive(({ params }) => {
            const sid = parseInt(params.sessionId!, 10); // params.sessionId will be string
            if (isNaN(sid))
              throw new BadRequestError('Invalid Session ID format');
            const s = sessionRepository.findById(sid);
            if (!s) throw new NotFoundError(`Session with ID ${sid}`);
            return { sessionData: s };
          })
          .get('/:sessionId', (context) => getSessionDetails(context), {
            response: { 200: 'sessionWithChatsMetadataResponse' },
            detail: { summary: 'Get session metadata & chat list' },
          })
          .put(
            '/:sessionId/metadata',
            async (context) => updateSessionMetadata(context),
            {
              body: 'metadataUpdateBody',
              response: { 200: 'sessionMetadataResponse' },
              detail: { summary: 'Update session metadata' },
            }
          )
          .get(
            '/:sessionId/transcript',
            async (context) => getTranscript(context),
            {
              response: { 200: 'transcriptResponse' },
              detail: { summary: 'Get structured transcript content' },
            }
          )
          .patch(
            '/:sessionId/transcript',
            async (context) => updateTranscriptParagraph(context),
            {
              body: 'paragraphUpdateBody',
              response: { 200: 'transcriptResponse' },
              detail: { summary: 'Update transcript paragraph' },
            }
          )
          .get(
            '/:sessionId/audio',
            (context: any) => {
              // context type here for Elysia pass-through
              const { request, set, sessionData } = context;
              const sid = sessionData.id;
              const absPath = getAudioAbsolutePath(sessionData.audioPath);
              if (!absPath || !fsSync.existsSync(absPath))
                throw new NotFoundError(`Audio for session ${sid}`);
              try {
                const stats = fsSync.statSync(absPath);
                const fileSize = stats.size;
                const range = request.headers.get('range');
                const ext = path.extname(absPath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                  '.mp3': 'audio/mpeg',
                  '.wav': 'audio/wav',
                  '.ogg': 'audio/ogg',
                  '.m4a': 'audio/mp4',
                  '.aac': 'audio/aac',
                  '.flac': 'audio/flac',
                  '.webm': 'audio/webm',
                };
                const contentType =
                  mimeTypes[ext] || 'application/octet-stream';
                if (range) {
                  const parts = range.replace(/bytes=/, '').split('-');
                  const start = parseInt(parts[0], 10);
                  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                  const chunksize = end - start + 1;
                  if (start >= fileSize || end >= fileSize || start > end) {
                    set.status = 416;
                    set.headers['Content-Range'] = `bytes */${fileSize}`;
                    return 'Range Not Satisfiable';
                  }
                  const fileStream = fsSync.createReadStream(absPath, {
                    start,
                    end,
                  });
                  set.status = 206;
                  set.headers['Content-Range'] =
                    `bytes ${start}-${end}/${fileSize}`;
                  set.headers['Accept-Ranges'] = 'bytes';
                  set.headers['Content-Length'] = chunksize.toString();
                  set.headers['Content-Type'] = contentType;
                  return new Response(Readable.toWeb(fileStream) as any);
                } else {
                  set.status = 200;
                  set.headers['Content-Length'] = fileSize.toString();
                  set.headers['Content-Type'] = contentType;
                  set.headers['Accept-Ranges'] = 'bytes';
                  return new Response(
                    Readable.toWeb(fsSync.createReadStream(absPath)) as any
                  );
                }
              } catch (error) {
                console.error(`[API Audio Err] ${sid}:`, error);
                if (error instanceof ApiError) throw error;
                throw new InternalServerError(
                  'Failed stream audio',
                  error instanceof Error ? error : undefined
                );
              }
            },
            {
              response: {
                200: t.Unknown(),
                206: t.Unknown(),
                404: t.Any(),
                416: t.Any(),
                500: t.Any(),
              },
              detail: { summary: 'Stream the original session audio file' },
            }
          )
          .post(
            '/:sessionId/finalize',
            async (context) => finalizeSessionHandler(context),
            {
              response: {
                200: 'sessionWithChatsMetadataResponse',
                409: t.Any(),
                500: t.Any(),
              },
              detail: {
                summary: 'Finalize session after successful transcription',
              },
            }
          )
          .delete(
            '/:sessionId',
            async ({ params, set, sessionData }) => {
              // params from guard, sessionData from derive
              const sid = sessionData.id; // Already parsed and validated
              console.log(`[API Del] Request to delete session ${sid}`);
              const audioId = sessionData.audioPath;
              try {
                if (audioId) {
                  await deleteUploadedAudioFile(audioId);
                } else {
                  console.warn(
                    `[API Del] No audio identifier for session ${sid}.`
                  );
                }

                const deletedSqlite = sessionRepository.deleteById(sid);
                if (!deletedSqlite)
                  console.warn(
                    `[API Del] Session ${sid} not found in SQLite during delete attempt.`
                  );
                else
                  console.log(
                    `[API Del] Deleted session ${sid} from SQLite (associated chats/paragraphs/messages cascaded).`
                  );

                try {
                  await deleteByQuery(esClient, TRANSCRIPTS_INDEX, {
                    term: { session_id: sid },
                  });
                  await deleteByQuery(esClient, MESSAGES_INDEX, {
                    term: { session_id: sid },
                  });
                  console.log(
                    `[API Delete ES] Successfully deleted Elasticsearch documents for session ${sid}.`
                  );
                } catch (esDeleteError) {
                  console.error(
                    `[API Delete ES] Error deleting ES documents for session ${sid}:`,
                    esDeleteError
                  );
                }
                set.status = 200;
                return {
                  message: `Session ${sid} and associated data deleted successfully.`,
                };
              } catch (error) {
                console.error(`[API Err] Delete Session ${sid}:`, error);
                if (error instanceof ApiError) throw error;
                throw new InternalServerError(
                  `Failed delete session ${sid}`,
                  error instanceof Error ? error : undefined
                );
              }
            },
            {
              response: { 200: 'deleteResponse', 404: t.Any(), 500: t.Any() },
              detail: {
                summary: 'Delete session, files, chats, paragraphs & ES docs',
              },
            }
          )
          .delete(
            '/:sessionId/audio',
            async (context) => deleteSessionAudioHandler(context),
            {
              response: { 200: 'deleteResponse', 404: t.Any(), 500: t.Any() },
              detail: { summary: 'Delete original audio file only' },
            }
          )
      )
  );

// No need to export 'sessionRoutesInstance', the plugin is applied via .use(sessionRoutes) in server.ts
