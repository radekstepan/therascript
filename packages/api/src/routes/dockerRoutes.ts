import { Elysia, t } from 'elysia';
import { InternalServerError, BadRequestError } from '../errors.js';
import {
  getProjectContainerStatus,
  getContainerLogs,
  PROJECT_CONTAINER_NAMES,
} from '../services/dockerManagementService.js';
// No need to import DockerContainerStatus type if using schema inference primarily

// --- Docker Status Schemas (define structure for API request/response validation and documentation) ---

// Schema for individual port mapping details within a container status
const DockerPortSchema = t.Object({
  PrivatePort: t.Number(), // Internal port number in the container
  PublicPort: t.Optional(t.Number()), // External port number on the host (if mapped)
  Type: t.String(), // Protocol (e.g., 'tcp', 'udp')
  IP: t.Optional(t.String()), // Host IP address the port is bound to (e.g., '0.0.0.0')
});

// Schema for the status of a single Docker container relevant to the project
const DockerContainerStatusSchema = t.Object({
  id: t.String(), // Short container ID
  name: t.String(), // Container name (e.g., 'therascript_whisper_service')
  image: t.String(), // Image used by the container (e.g., 'therascript/whisper')
  state: t.String(), // Current state (e.g., 'running', 'exited', 'not_found')
  status: t.String(), // Human-readable status (e.g., 'Up 5 minutes', 'Exited (0) 2 hours ago')
  ports: t.Array(DockerPortSchema), // Array of port mappings
});

// Schema for the overall response of the /status endpoint
const DockerStatusResponseSchema = t.Object({
  containers: t.Array(DockerContainerStatusSchema), // Array of container statuses
});

// --- NEW SCHEMAS for Logs ---
const DockerLogsResponseSchema = t.Object({
  logs: t.String(),
  containerName: t.String(),
});

const DockerLogsParamSchema = t.Object({
  containerName: t.String(),
});
// --- END NEW SCHEMAS ---

/**
 * Defines API routes related to Docker management under the `/api/docker` prefix.
 */
export const dockerRoutes = new Elysia({ prefix: '/api/docker' })
  // Register models for schema validation and Swagger documentation
  .model({
    dockerContainerStatus: DockerContainerStatusSchema,
    dockerStatusResponse: DockerStatusResponseSchema,
    dockerLogsResponse: DockerLogsResponseSchema, // Added
    dockerLogsParam: DockerLogsParamSchema, // Added
  })
  // Group routes under the 'Docker' tag in Swagger documentation
  .group('', { detail: { tags: ['Docker'] } }, (app) =>
    app
      /**
       * GET /api/docker/status
       * Retrieves the status of project-related Docker containers (e.g., Whisper, Ollama).
       * Calls the `dockerManagementService` to interact with the Docker daemon.
       */
      .get(
        '/status',
        async ({ set }) => {
          console.log('[API Docker] Requesting project container status...');
          try {
            // Fetch status from the service layer
            const containers = await getProjectContainerStatus();
            set.status = 200; // OK
            return { containers };
          } catch (error: any) {
            console.error('[API Docker] Error fetching Docker status:', error);
            // If it's already an InternalServerError from the service, rethrow it
            if (error instanceof InternalServerError) throw error;
            // Otherwise, wrap it in an InternalServerError
            throw new InternalServerError(
              'Failed to fetch Docker container status.',
              error
            );
          }
        },
        {
          // Define expected responses for different status codes using the registered models
          response: {
            200: 'dockerStatusResponse', // Successful response schema
            500: t.Any(), // Allow any structure for 500 errors (handled by onError)
            // Add other potential error codes if needed (e.g., 503 if Docker daemon is down)
          },
          // Add details for Swagger documentation
          detail: {
            summary: 'Get status of project-related Docker containers',
          },
        }
      )
      /**
       * GET /api/docker/logs/:containerName
       * Retrieves recent logs from a specific project container.
       */
      .get(
        '/logs/:containerName',
        async ({ params, set }) => {
          const { containerName } = params;
          if (!PROJECT_CONTAINER_NAMES.includes(containerName)) {
            throw new BadRequestError(
              `Access to logs for container '${containerName}' is not permitted.`
            );
          }
          console.log(
            `[API Docker] Requesting logs for container: ${containerName}...`
          );
          try {
            const logs = await getContainerLogs(containerName);
            set.status = 200;
            return { logs, containerName };
          } catch (error: any) {
            console.error(
              `[API Docker] Error fetching logs for ${containerName}:`,
              error
            );
            if (error instanceof InternalServerError) throw error;
            throw new InternalServerError(
              `Failed to fetch logs for container ${containerName}.`,
              error
            );
          }
        },
        {
          params: 'dockerLogsParam',
          response: {
            200: 'dockerLogsResponse',
            400: t.Any(),
            404: t.Any(),
            500: t.Any(),
          },
          detail: {
            summary: 'Get recent logs from a specific project container',
          },
        }
      )
  );
