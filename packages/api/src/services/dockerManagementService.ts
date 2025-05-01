// Purpose: Provides functions to interact with the Docker daemon, specifically
//          to get the status of containers related to the Therascript project.
import Dockerode from 'dockerode'; // Library to interact with the Docker Engine API
import { InternalServerError } from '../errors.js'; // Custom error class
import type { DockerContainerStatus } from '../types/index.js'; // Type definition for container status

// --- Project Specific Containers ---
// These names MUST match the `container_name` specified in the relevant docker-compose files.
const PROJECT_CONTAINER_NAMES = [
    'ollama_server_managed',       // From packages/ollama/docker-compose.yml
    'therascript_whisper_service', // From the root docker-compose.yml
];
// --- End Project Specific Containers ---

// --- Docker Client Initialization ---
let docker: Dockerode | null = null; // Holds the Dockerode client instance
try {
    // Attempt to connect to the Docker daemon.
    // This usually connects via the default socket path (/var/run/docker.sock on Linux,
    // or uses Docker Desktop's mechanism on Mac/Windows).
    // Ensure the user running the API process has permissions to access the Docker socket
    // (e.g., being in the 'docker' group on Linux).
    docker = new Dockerode();
    console.log('[DockerService] Connected to Docker daemon successfully.');
} catch (error) {
    // Log failure and keep docker as null. Functions using it must check.
    console.error('[DockerService] Failed to initialize Dockerode. Docker daemon might not be running or accessible:', error);
    // Potential reasons: Docker daemon not running, permissions issue, incorrect DOCKER_HOST env var.
}
// --- End Docker Client Initialization ---

/**
 * Fetches the current status of known project-related Docker containers.
 * Retrieves information like ID, name, state, ports, etc.
 *
 * @returns {Promise<DockerContainerStatus[]>} A promise resolving to an array of container status objects.
 * @throws {InternalServerError} If the Docker client is unavailable or if there's an error communicating with the Docker daemon.
 */
export const getProjectContainerStatus = async (): Promise<DockerContainerStatus[]> => {
    // Check if Dockerode client was initialized successfully
    if (!docker) {
        console.error('[DockerService] Docker client is not initialized. Cannot fetch container status.');
        throw new InternalServerError('Docker client unavailable. Cannot connect to Docker daemon.');
    }

    console.log('[DockerService] Fetching status for project containers:', PROJECT_CONTAINER_NAMES);
    const containerStatuses: DockerContainerStatus[] = [];

    try {
        // List all containers, including stopped ones (`all: true`)
        const allContainers = await docker.listContainers({ all: true });

        // Filter the list to find containers whose names match our project list
        // Docker container names often have a leading '/' prefix.
        const projectContainers = allContainers.filter(c =>
            PROJECT_CONTAINER_NAMES.some(expectedName => c.Names.includes(`/${expectedName}`))
        );

        console.log(`[DockerService] Found ${projectContainers.length} matching containers in Docker.`);

        // Process each found project container
        for (const containerInfo of projectContainers) {
            // Extract the primary name (without the leading '/')
            // Handles cases where a container might have multiple names (less common)
            const name = containerInfo.Names[0]?.substring(1) || 'unknown_name';
            // Map the Dockerode container info to our simplified DockerContainerStatus structure
            containerStatuses.push({
                id: containerInfo.Id.substring(0, 12), // Use short 12-character ID
                name: name,
                image: containerInfo.Image,
                state: containerInfo.State,     // e.g., 'running', 'exited'
                status: containerInfo.Status,   // e.g., 'Up 5 minutes', 'Exited (0) 2 hours ago'
                ports: containerInfo.Ports.map(p => ({ // Simplify port information
                    PrivatePort: p.PrivatePort,
                    PublicPort: p.PublicPort,
                    Type: p.Type,
                    IP: p.IP
                })),
            });
        }

        // Add entries for expected containers that were NOT found by Docker
        // This ensures the UI knows about containers defined in config but not running/stopped.
        for (const expectedName of PROJECT_CONTAINER_NAMES) {
             if (!containerStatuses.some(cs => cs.name === expectedName)) {
                 console.log(`[DockerService] Expected container '${expectedName}' not found.`);
                 containerStatuses.push({
                     id: 'N/A',
                     name: expectedName,
                     image: 'N/A',
                     state: 'not_found', // Custom state for missing containers
                     status: 'Container not found',
                     ports: [],
                 });
             }
         }

        console.log('[DockerService] Successfully fetched and processed container statuses.');
        // Sort the results alphabetically by name for consistent UI display
        return containerStatuses.sort((a, b) => a.name.localeCompare(b.name));

    } catch (error: any) {
        console.error('[DockerService] Error fetching container status from Docker daemon:', error);
        // Handle specific Docker connection errors
        if (error.code === 'ECONNREFUSED' || error.message?.includes('connect ECONNREFUSED')) {
            throw new InternalServerError('Connection refused: Cannot connect to the Docker daemon.');
        }
        // Wrap other errors
        throw new InternalServerError('Failed to fetch Docker container status.', error);
    }
};
