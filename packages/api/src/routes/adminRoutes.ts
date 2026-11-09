import { Elysia, t, type Context } from 'elysia';
import {
  reindexElasticsearchService,
  resetAllDataService,
  exportDataService,
  exportVaultBackupService,
  importDataService,
} from '../api/adminHandler.js';
import { BadRequestError, InternalServerError } from '../errors.js'; // For error schema
import { getVaultManager } from '../services/vaultManager.js';

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
    type: ['application/x-tar', 'application/octet-stream'],
    error:
      'A single backup file is required (.tar legacy or encrypted .tvbak).',
  }),
  backupPassword: t.Optional(t.String({ maxLength: 1024 })),
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
          // Vault mode exports only sealed, password-protected archives;
          // use POST /export-data with a backup password instead.
          if (getVaultManager().isProtectionActive()) {
            throw new BadRequestError(
              'Plaintext export is disabled in vault mode. POST a backup password to /api/admin/export-data instead.'
            );
          }
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
            summary:
              'Export all application data as a TAR archive (legacy mode only)',
            produces: ['application/x-tar'],
          },
        }
      )
      .post(
        '/export-data',
        async (
          context: Context & {
            body: { backupPassword: string };
          }
        ) => {
          const readableStream = await exportVaultBackupService(
            context.body.backupPassword
          );
          context.set.headers['Content-Type'] = 'application/octet-stream';
          context.set.headers['Content-Disposition'] =
            `attachment; filename="therascript-backup-${new Date().toISOString().split('T')[0]}.tvbak"`;
          context.set.status = 200;
          return new Response(readableStream as any);
        },
        {
          body: t.Object({
            backupPassword: t.String({ minLength: 1, maxLength: 1024 }),
          }),
          response: {
            200: t.Unknown({
              description: 'An encrypted backup archive (.tvbak).',
            }),
            400: 'errorResponse',
            500: 'errorResponse',
          },
          detail: {
            summary: 'Export an encrypted backup archive',
            description:
              'Seals the full database snapshot plus recordings under the given backup password (Argon2id + AES-GCM). Works in vault and legacy mode.',
            produces: ['application/octet-stream'],
          },
        }
      )
      .post(
        '/import-data',
        async (context) => {
          const { body, set } = context;
          const result = await importDataService(body.backupFile, {
            backupPassword: body.backupPassword,
          });
          set.status = 200;
          return result;
        },
        {
          body: 'importBody',
          response: {
            200: 'importResponse',
            400: 'errorResponse',
            401: 'errorResponse',
            500: 'errorResponse',
          },
          detail: {
            summary:
              'Import data from a backup archive, overwriting all existing data',
            description:
              'Accepts legacy .tar backups and encrypted .tvbak archives (with their backup password). In vault mode the import is staged into a new generation and committed atomically; failures leave the live vault untouched.',
            consumes: ['multipart/form-data'],
          },
        }
      )
  );
