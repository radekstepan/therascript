import { Elysia, t } from 'elysia';
// Removed: import { handleShutdownRequest } from '../api/systemHandler.js';

// Schemas related to shutdown are removed.
// const ShutdownResponseSchema = t.Object({ message: t.String() });
// const ErrorResponseSchema = t.Object({ /* ... */ });

/**
 * Defines API routes related to system-level actions under the `/api/system` prefix.
 * PC Shutdown functionality has been removed.
 * This file is kept for structure if other system operations are added.
 */
export const systemRoutes = new Elysia({ prefix: '/api/system' })
  // .model({ /* shutdownResponse: ShutdownResponseSchema, errorResponse: ErrorResponseSchema */ })
  .group(
    '',
    { detail: { tags: ['System'] } },
    (app) => app
    // POST /api/system/shutdown - Route removed
    // No routes defined for system operations at the moment.
  );
