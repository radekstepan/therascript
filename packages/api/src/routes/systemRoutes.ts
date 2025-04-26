// packages/api/src/routes/systemRoutes.ts
import { Elysia, t } from 'elysia';
import { handleShutdownRequest } from '../api/systemHandler.js';

// Define response schema
const ShutdownResponseSchema = t.Object({
    message: t.String(),
});

export const systemRoutes = new Elysia({ prefix: '/api/system' })
    .model({
        shutdownResponse: ShutdownResponseSchema,
    })
    .group('', { detail: { tags: ['System'] } }, (app) => app
        .post('/shutdown', handleShutdownRequest, {
            response: {
                200: 'shutdownResponse', // Or 202
                500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }),
                503: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }), // For permission errors
            },
            detail: {
                summary: 'Initiate a system shutdown (Requires specific sudo permissions)',
                description: 'WARNING: This endpoint triggers a system shutdown. The API process requires pre-configured passwordless sudo permissions to execute the necessary shutdown script. Use with extreme caution.'
            }
        })
    );
