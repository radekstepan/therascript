import { Elysia, t, type Context } from 'elysia';
import {
  reindexElasticsearchService,
  resetAllDataService,
  exportDataService,
  importDataService,
} from '../api/adminHandler.js';
import { InternalServerError } from '../errors.js'; // For error schema

// Schema for the re-index response
const ReindexResponseSchema = t.Object({
  message: t.String(),
  transcriptsIndexed: t.Number(),
  messagesIndexed: t.Number(),
  errors: t.Array(t.String()),
});

// Schema for the reset response
const ResetAllDataResponseSchema = t.Object({
  message: t.String(),
  errors: t.Array(t.String()),
});

// --- NEW SCHEMAS ---
const ImportBodySchema = t.Object({
  backupFile: t.File({
    type: ['application/x-tar'],
    error: 'A single .tar backup file is required.',
  }),
});

const ImportResponseSchema = t.Object({
  message: t.String(),
});
// --- END NEW ---

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .model({
    reindexResponse: ReindexResponseSchema,
    resetAllDataResponse: ResetAllDataResponseSchema,
    importBody: ImportBodySchema,
    importResponse: ImportResponseSchema,
    errorResponse: t.Object({
      error: t.String(),
      message: t.String(),
      details: t.Optional(t.Any()),
    }),
  })
  .group('', { detail: { tags: ['Admin'] } }, (app) =>
    app
      .post(
        '/reindex-elasticsearch',
        async (context) => {
          const result = await reindexElasticsearchService();
          if (result.errors.length > 0) {
            context.set.status = 500;
          } else {
            context.set.status = 200;
          }
          return result;
        },
        {
          response: {
            200: 'reindexResponse',
            207: 'reindexResponse',
            500: 'reindexResponse',
          },
          detail: {
            summary: 'Delete and Re-index all Elasticsearch Data',
            description:
              'WARNING: This is a destructive operation. It deletes all current Elasticsearch indices and re-populates them from the SQLite database.',
          },
        }
      )
      .post(
        '/reset-all-data',
        async (context) => {
          const result = await resetAllDataService();
          if (result.errors.length > 0) {
            context.set.status = 500;
          } else {
            context.set.status = 200;
          }
          return result;
        },
        {
          response: {
            200: 'resetAllDataResponse',
            500: 'resetAllDataResponse',
          },
          detail: {
            summary: 'Reset All Application Data',
            description:
              'WARNING: This is a highly destructive operation. It deletes all data from the SQLite database, all uploaded files, and all Elasticsearch indices, then re-initializes them to a blank state. This action cannot be undone.',
          },
        }
      )
      .get(
        '/export-data',
        async (context: Context) => {
          const readableStream = await exportDataService();
          context.set.headers['Content-Type'] = 'application/x-tar';
          context.set.headers['Content-Disposition'] =
            `attachment; filename="therascript-backup-${new Date().toISOString().split('T')[0]}.tar"`;
          context.set.status = 200;
          return new Response(readableStream as any);
        },
        {
          response: {
            200: t.Unknown({
              description: 'A tar archive of all application data.',
            }),
            500: 'errorResponse',
          },
          detail: {
            summary: 'Export all application data as a TAR archive',
            produces: ['application/x-tar'],
          },
        }
      )
      .post(
        '/import-data',
        async (context) => {
          const { body, set } = context;
          const result = await importDataService(body.backupFile);
          set.status = 200;
          return result;
        },
        {
          body: 'importBody',
          response: {
            200: 'importResponse',
            400: 'errorResponse',
            500: 'errorResponse',
          },
          detail: {
            summary:
              'Import data from a TAR archive, overwriting all existing data',
            consumes: ['multipart/form-data'],
          },
        }
      )
  );
