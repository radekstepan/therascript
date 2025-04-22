// New file: packages/api/src/services/dockerManagementService.ts
import Dockerode from 'dockerode';
import { InternalServerError } from '../errors.js';
import type { DockerContainerStatus } from '../types/index.js';

// --- Project Specific Containers ---
// These names should match the container_name in the docker-compose files
const PROJECT_CONTAINER_NAMES = [
    'ollama_server_managed',       // From packages/ollama/docker-compose.yml
    'therascript_whisper_service', // From docker-compose.yml at project root
];

let docker: Dockerode | null = null;
try {
    // Connect to the Docker daemon.
    // Ensure Docker is running and accessible.
    // On Linux, this might require the user running the API to be in the 'docker' group.
    // On Windows/Mac with Docker Desktop, it usually works out of the box.
    // If connecting via TCP socket: new Dockerode({ socketPath: undefined, host: '127.0.0.1', port: 2375 });
    // If connecting via Unix socket: new Dockerode({ socketPath: '/var/run/docker.sock' });
    docker = new Dockerode();
    console.log('[DockerService] Connected to Docker daemon successfully.');
} catch (error) {
    console.error('[DockerService] Failed to initialize Dockerode. Docker daemon might not be running or accessible:', error);
    // docker remains null, functions will check for this
}

/**
 * Fetches the status of known project-related Docker containers.
 */
export const getProjectContainerStatus = async (): Promise<DockerContainerStatus[]> => {
    if (!docker) {
        console.error('[DockerService] Docker client is not initialized. Cannot fetch container status.');
        throw new InternalServerError('Docker client unavailable. Cannot connect to Docker daemon.');
    }

    console.log('[DockerService] Fetching status for project containers:', PROJECT_CONTAINER_NAMES);
    const containerStatuses: DockerContainerStatus[] = [];

    try {
        // List all containers (including stopped ones)
        const allContainers = await docker.listContainers({ all: true });

        // Filter for the containers we care about
        const projectContainers = allContainers.filter(c =>
            PROJECT_CONTAINER_NAMES.some(name => c.Names.includes(`/${name}`))
        );

        console.log(`[DockerService] Found ${projectContainers.length} matching containers.`);

        for (const containerInfo of projectContainers) {
            // Extract the primary name (without the leading '/')
            const name = containerInfo.Names[0]?.substring(1) || 'unknown';
            containerStatuses.push({
                id: containerInfo.Id.substring(0, 12), // Short ID
                name: name,
                image: containerInfo.Image,
                state: containerInfo.State, // e.g., 'running', 'exited'
                status: containerInfo.Status, // e.g., 'Up 5 minutes', 'Exited (0) 2 hours ago'
                ports: containerInfo.Ports.map(p => ({ // Simplify ports
                    PrivatePort: p.PrivatePort,
                    PublicPort: p.PublicPort,
                    Type: p.Type,
                    IP: p.IP
                })),
            });
        }

        // Add info for containers defined in our list but NOT found running/stopped
        for (const expectedName of PROJECT_CONTAINER_NAMES) {
             if (!containerStatuses.some(cs => cs.name === expectedName)) {
                 containerStatuses.push({
                     id: 'N/A',
                     name: expectedName,
                     image: 'N/A',
                     state: 'not_found',
                     status: 'Container not found',
                     ports: [],
                 });
             }
         }

        console.log('[DockerService] Successfully fetched container statuses.');
        return containerStatuses.sort((a, b) => a.name.localeCompare(b.name)); // Sort by name

    } catch (error: any) {
        console.error('[DockerService] Error fetching container status:', error);
        if (error.code === 'ECONNREFUSED' || error.message?.includes('connect ECONNREFUSED')) {
            throw new InternalServerError('Connection refused: Cannot connect to the Docker daemon.');
        }
        throw new InternalServerError('Failed to fetch Docker container status.', error);
    }
};
