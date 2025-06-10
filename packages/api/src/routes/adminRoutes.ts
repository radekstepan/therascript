import { Elysia, t } from 'elysia';
import { handleReindexElasticsearch } from '../api/adminHandler.js';
import { InternalServerError } from '../errors.js'; // For error schema

// Schema for the re-index response
const ReindexResponseSchema = t.Object({
  message: t.String(),
  transcriptsIndexed: t.Number(),
  messagesIndexed: t.Number(),
  errors: t.Array(t.String()),
});

export const adminRoutes = new Elysia({ prefix: '/api/admin' })
  .model({
    reindexResponse: ReindexResponseSchema,
    errorResponse: t.Object({
      error: t.String(),
      message: t.String(),
      details: t.Optional(t.Any()),
    }),
  })
  .group('', { detail: { tags: ['Admin'] } }, (app) =>
    app.post(
      '/reindex-elasticsearch',
      async (context) => {
        // TODO: Add authentication/authorization here for production
        return handleReindexElasticsearch(context);
      },
      {
        response: {
          200: 'reindexResponse',
          207: 'reindexResponse',
          500: 'reindexResponse', // Return ReindexResponse even for 500 to include errors array
        },
        detail: {
          summary: 'Delete and Re-index all Elasticsearch Data',
          description:
            'WARNING: This is a destructive operation. It deletes all current Elasticsearch indices and re-populates them from the SQLite database.',
        },
      }
    )
  );
