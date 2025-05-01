import { Elysia, t } from 'elysia';
import { handleShutdownRequest } from '../api/systemHandler.js';

// --- Response Schema Definitions ---

// Schema for a successful shutdown response
const ShutdownResponseSchema = t.Object({
  message: t.String(), // Confirmation message (e.g., "Shutdown command issued successfully.")
});

// Schema for generic error responses (can be reused)
// Note: Details might be stripped in production by the global onError handler
const ErrorResponseSchema = t.Object({
  error: t.String(), // Error type (e.g., 'InternalServerError', 'ApiError')
  message: t.String(), // Human-readable error message
  details: t.Optional(t.Any()), // Optional additional details (e.g., original error, stack trace in dev)
});
// --- End Response Schema Definitions ---

/**
 * Defines API routes related to system-level actions under the `/api/system` prefix.
 * Currently includes only the shutdown endpoint.
 */
export const systemRoutes = new Elysia({ prefix: '/api/system' })
  // Register models for validation and documentation
  .model({
    shutdownResponse: ShutdownResponseSchema,
    errorResponse: ErrorResponseSchema, // Generic error model
  })
  // Group routes under the 'System' tag in Swagger
  .group(
    '',
    { detail: { tags: ['System'] } },
    (app) =>
      app
        /**
         * POST /api/system/shutdown
         * Initiates a system shutdown by calling the `handleShutdownRequest` handler.
         * Requires specific sudo permissions configured for the API process.
         * USE WITH EXTREME CAUTION.
         */
        .post('/shutdown', handleShutdownRequest, {
          // Define expected responses for various outcomes
          response: {
            200: 'shutdownResponse', // Success (or potentially 202 Accepted)
            500: 'errorResponse', // Internal server error (e.g., command failed unexpectedly)
            503: 'errorResponse', // Service Unavailable (likely due to permission errors/missing sudo config)
          },
          // Add details for Swagger documentation
          detail: {
            summary:
              'Initiate a system shutdown (Requires specific sudo permissions)',
            description:
              'WARNING: This endpoint triggers a system shutdown. The API process requires pre-configured passwordless sudo permissions to execute the necessary shutdown script (`packages/system/dist/shutdownTrigger.js`). Use with extreme caution.',
          },
        })
    // Add other system-level routes here if needed (e.g., reboot, service status)
  );
