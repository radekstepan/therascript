/* packages/api/src/routes/dockerRoutes.ts */
import { Elysia, t } from 'elysia';
import { InternalServerError } from '../errors.js';
import { getProjectContainerStatus } from '../services/dockerManagementService.js';
import type { DockerContainerStatus } from '../types/index.js';

// --- Docker Status Schemas ---
const DockerPortSchema = t.Object({
    PrivatePort: t.Number(),
    PublicPort: t.Optional(t.Number()),
    Type: t.String(),
    IP: t.Optional(t.String()),
});
const DockerContainerStatusSchema = t.Object({
    id: t.String(),
    name: t.String(),
    image: t.String(),
    state: t.String(),
    status: t.String(),
    ports: t.Array(DockerPortSchema),
});
const DockerStatusResponseSchema = t.Object({
    containers: t.Array(DockerContainerStatusSchema),
});

export const dockerRoutes = new Elysia({ prefix: '/api/docker' })
    .model({
        dockerContainerStatus: DockerContainerStatusSchema,
        dockerStatusResponse: DockerStatusResponseSchema,
    })
    .group('', { detail: { tags: ['Docker'] } }, (app) => app
        .get('/status', async ({ set }) => {
            console.log('[API Docker] Requesting project container status...');
            try {
                const containers = await getProjectContainerStatus();
                set.status = 200;
                return { containers };
            } catch (error: any) {
                console.error('[API Docker] Error fetching Docker status:', error);
                if (error instanceof InternalServerError) throw error;
                throw new InternalServerError('Failed to fetch Docker container status.', error);
            }
        }, {
            response: { 200: 'dockerStatusResponse', 500: t.Any() },
            detail: { summary: 'Get status of project-related Docker containers' }
        })
    );
