import * as path from 'path';
import * as fs from 'fs';
import Dockerode from 'dockerode';
import { fileURLToPath } from 'node:url';
import { ensureServiceReady, stopContainer } from '@therascript/docker-utils';

// --- Configuration ---
function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    const lernaJsonPath = path.join(currentDir, 'lerna.json');
    if (fs.existsSync(packageJsonPath) && fs.existsSync(lernaJsonPath)) {
      return currentDir; // Found root
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        'Could not find project root containing package.json and lerna.json.'
      );
    }
    currentDir = parentDir;
  }
}

let ROOT_DIR: string;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  ROOT_DIR = findProjectRoot(__dirname);
  console.log(`[ES Manager Docker] Project root identified as: ${ROOT_DIR}`);
} catch (error) {
  console.error('[ES Manager Docker] Error finding project root:', error);
  throw error;
}

const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml'); // Use root compose file
export const ELASTICSEARCH_SERVICE_NAME_IN_COMPOSE = 'elasticsearch'; // Name from root compose file
const ELASTICSEARCH_CONTAINER_NAME = 'therascript_elasticsearch_service'; // container_name from root compose file
const ELASTICSEARCH_HEALTH_URL = 'http://localhost:9200/_cluster/health'; // Elasticsearch health endpoint

// Health check parameters
const HEALTH_CHECK_RETRIES = 20; // ES can take a while to start, especially first time
const HEALTH_CHECK_DELAY_MS = 6000; // 6 seconds
const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds for the HTTP request itself

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[ES Manager Docker] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[ES Manager Docker] Failed to connect to Docker daemon:',
    error
  );
}

/**
 * Ensures the Elasticsearch service is running AND healthy.
 * Uses the shared docker-utils package.
 */
export async function ensureElasticsearchRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure Elasticsearch is running.'
    );
  }
  const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, '');

  console.log(
    `[ES Manager Docker] Ensuring Elasticsearch service ('${ELASTICSEARCH_SERVICE_NAME_IN_COMPOSE}') in project '${projectName}' is ready via ${COMPOSE_FILE}...`
  );

  await ensureServiceReady({
    docker,
    containerName: ELASTICSEARCH_CONTAINER_NAME,
    serviceName: ELASTICSEARCH_SERVICE_NAME_IN_COMPOSE,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http',
      url: ELASTICSEARCH_HEALTH_URL, // Check cluster health
      retries: HEALTH_CHECK_RETRIES,
      delayMs: HEALTH_CHECK_DELAY_MS,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      // Note: ensureServiceReady checks for 2xx. For ES, _cluster/health returns 200.
      // The docker-compose.yml has a more specific health check for 'green' or 'yellow' status,
      // which Docker itself uses. This HTTP check is for our script's readiness confirmation.
    },
  });
  console.log(
    '[ES Manager Docker] Elasticsearch service is confirmed running and healthy.'
  );
}

/**
 * Stops the Elasticsearch service container using the shared docker-utils.
 */
export async function stopElasticsearchService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[ES Manager Docker] Docker client unavailable, cannot stop Elasticsearch.'
    );
    return;
  }
  console.log(
    `[ES Manager Docker] Attempting to stop Elasticsearch container: ${ELASTICSEARCH_CONTAINER_NAME}`
  );
  await stopContainer(docker, ELASTICSEARCH_CONTAINER_NAME);
}
