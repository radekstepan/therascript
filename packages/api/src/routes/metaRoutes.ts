/* packages/api/src/routes/metaRoutes.ts */
import { Elysia, t } from 'elysia';
import { InternalServerError } from '../errors.js';
import { checkDatabaseHealth } from '../db/sqliteService.js'; // Assuming health check is in sqliteService

export const metaRoutes = new Elysia({ prefix: '/api' })
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
    );
