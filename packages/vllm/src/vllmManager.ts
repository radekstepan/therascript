import * as path from 'path';
import Dockerode from 'dockerode';
import * as fs from 'fs';
import { ensureServiceReady, stopContainer } from '@therascript/docker-utils';

// --- Configuration ---
const COMPOSE_FILE = path.resolve(__dirname, '..', 'docker-compose.yml');
export const VLLM_SERVICE_NAME = 'vllm';
const VLLM_CONTAINER_NAME = 'vllm_server_managed';
const VLLM_HEALTH_URL = 'http://localhost:8000/health'; // vLLM health check endpoint

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[vLLM Docker Manager] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[vLLM Docker Manager] Failed to connect to Docker daemon:',
    error
  );
}

/**
 * Ensures the vLLM service is running by starting it via docker-compose if needed
 * and waiting for the health check to pass.
 * @throws An error if the Docker client is not initialized or the service fails to start.
 */
export async function ensureVllmRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure vLLM is running.'
    );
  }
  if (!fs.existsSync(COMPOSE_FILE)) {
    const errorMessage = `[vLLM Docker] Docker Compose file not found at expected path: ${COMPOSE_FILE}. Cannot manage service.`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Project name derived from compose file location
  const projectName = path.basename(path.dirname(COMPOSE_FILE));

  // FIX: Use a type assertion `as any` to resolve monorepo type conflicts.
  // This occurs when this package and a dependency (`@therascript/docker-utils`)
  // resolve different instances of `@types/dockerode`, making their types
  // technically incompatible even if identical. This is a pragmatic fix.
  await ensureServiceReady({
    docker: docker as any,
    containerName: VLLM_CONTAINER_NAME,
    serviceName: VLLM_SERVICE_NAME,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http',
      url: VLLM_HEALTH_URL,
      retries: 20, // Increased retries as model loading can take a long time
      delayMs: 5000, // Longer delay between checks
      timeoutMs: 4000,
    },
  });
}

/**
 * Stops the vLLM service container.
 */
export async function stopVllmService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[vLLM Docker Manager] Docker client unavailable, cannot stop vLLM.'
    );
    return;
  }
  // FIX: Use a type assertion `as any` to resolve monorepo type conflicts.
  await stopContainer(docker as any, VLLM_CONTAINER_NAME);
}
