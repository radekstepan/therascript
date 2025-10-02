import { Elysia, t, type Static } from 'elysia';
import path from 'node:path';
import fsSync from 'node:fs';
import { Readable } from 'node:stream';
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
  listSessions,
  getSessionDetails,
  updateSessionMetadata,
  getTranscript,
  updateTranscriptParagraph,
  deleteSessionAudioHandler,
  deleteTranscriptParagraph,
} from '../api/sessionHandler.js';
import {
  deleteUploadedAudioFile,
  saveUploadedAudio,
  getAudioAbsolutePath,
} from '../services/fileService.js';
import { startTranscriptionJob } from '../services/transcriptionService.js';
import type { BackendSession } from '../types/index.js';
import {
  NotFoundError,
  InternalServerError,
  ApiError,
  BadRequestError,
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
const ParagraphUpdateBodySchema = t.Object({
  paragraphIndex: t.Numeric({
    minimum: 0,
    error: 'Paragraph index must be 0 or greater',
  }),
  newText: t.String(),
});
const ParagraphIndexParamSchema = t.Object({
  paragraphIndex: t.String({
    pattern: '^[0-9]+$',
    error: 'Paragraph Index must be a non-negative integer string.',
  }),
});
const SessionAndParagraphParamsSchema = t.Intersect([
  SessionIdParamSchema,
  ParagraphIndexParamSchema,
]);
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
        t.Literal('queued'),
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

export const sessionRoutes = new Elysia({ prefix: '/api' })
  .model({
    sessionIdParam: SessionIdParamSchema,
    paragraphIndexParam: ParagraphIndexParamSchema,
    sessionAndParagraphParams: SessionAndParagraphParamsSchema,
    paragraphUpdateBody: ParagraphUpdateBodySchema,
    metadataUpdateBody: SessionMetadataUpdateBodySchema,
    uploadBody: UploadBodySchema,
    sessionMetadataResponse: SessionMetadataResponseSchema,
    sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema,
    transcriptResponse: TranscriptResponseSchema,
    deleteResponse: DeleteResponseSchema,
  })
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
          let newSess: BackendSession | null = null;
          try {
            const isoDate = dateToIsoStringForStorage(dateInput);
            newSess = sessionRepository.create(
              { ...metadata, date: isoDate },
              audioFile.name,
              null,
              new Date().toISOString()
            );
            if (!newSess)
              throw new InternalServerError('Failed to create session in DB.');

            const buffer = await audioFile.arrayBuffer();
            const savedAudioId = await saveUploadedAudio(
              newSess.id,
              audioFile.name,
              Buffer.from(buffer)
            );

            sessionRepository.updateMetadata(newSess.id, {
              audioPath: savedAudioId,
              status: 'queued',
            });

            await startTranscriptionJob(newSess.id);

            set.status = 202;
            return {
              sessionId: newSess.id,
              message: 'Upload successful, transcription queued.',
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
                  if (current.audioPath) {
                    try {
                      await deleteUploadedAudioFile(current.audioPath);
                    } catch (delErr) {
                      console.error(
                        `Cleanup audio err for ${current.audioPath}:`,
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
            const sid = parseInt(params.sessionId!, 10);
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
          .delete(
            '/:sessionId/transcript/:paragraphIndex',
            (context) => deleteTranscriptParagraph(context as any),
            {
              params: 'sessionAndParagraphParams',
              response: { 200: 'transcriptResponse' },
              detail: { summary: 'Delete a single transcript paragraph' },
            }
          )
          .get(
            '/:sessionId/audio',
            (context: any) => {
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
                  const start = parseInt(parts, 10);
                  const end = parts ? parseInt(parts, 10) : fileSize - 1;
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
          .delete(
            '/:sessionId',
            async ({ params, set, sessionData }) => {
              const sid = sessionData.id;
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
