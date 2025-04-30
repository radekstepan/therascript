/* packages/api/src/routes/metaRoutes.ts */
import { Elysia, t } from 'elysia';
import { InternalServerError } from '../errors.js';
import { checkDatabaseHealth } from '../db/sqliteService.js'; // Assuming health check is in sqliteService
import { getStarredMessages } from '../api/metaHandler.js'; // <-- Import handler
import type { BackendChatMessage } from '../types/index.js'; // <-- Import type

// Schema for the starred message response
// Use the updated ChatMessageResponseSchema definition consistent with other routes
const StarredMessageResponseSchema = t.Object({
    id: t.Number(),
    chatId: t.Number(),
    sender: t.Union([t.Literal('user'), t.Literal('ai')]), // Keep both for now, handler filters
    text: t.String(),
    timestamp: t.Number(),
    promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
    completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
    starred: t.Boolean(), // Should always be true here
    starredName: t.Optional(t.Union([t.String(), t.Null()]))
});


export const metaRoutes = new Elysia({ prefix: '/api' })
    .model({ // Add model for starred message response
        starredMessageResponse: StarredMessageResponseSchema,
    })
    .group('', { detail: { tags: ['Meta'] } }, (app) => app
        .get('/health', ({ set }) => {
            try {
                checkDatabaseHealth(); // Perform a quick check
                set.status = 200;
                return {
                    status: 'OK',
                    database: 'connected', // Simplified status
                    timestamp: new Date().toISOString()
                };
            } catch (dbError) {
                console.error("[Health Check] Database error:", dbError);
                throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined);
            }
        }, {
            detail: { summary: 'Check API and Database health' }
        })
        .get('/schema', ({ set }) => {
            set.status = 501;
            return { message: "API schema definition is not available here. Use /api/docs for Swagger UI." };
        }, {
            detail: { summary: 'API Schema Information (Redirects to Swagger)' }
        })
        // --- New Starred Messages Endpoint ---
         .get('/starred-messages', getStarredMessages, {
             response: { 200: t.Array(StarredMessageResponseSchema) }, // Return array of starred messages
             detail: {
                 tags: ['Chat'], // Add to Chat tag
                 summary: 'Get all starred user messages (templates)'
             }
         })
    );
// TODO comments should not be removed
