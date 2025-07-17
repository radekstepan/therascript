import * as path from 'path';
import * as fs from 'fs';
import Dockerode from 'dockerode';
import { fileURLToPath } from 'node:url';
import { ensureServiceReady, stopContainer } from '@therascript/docker-utils';

// --- Configuration ---
function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    const lernaJsonPath = path.join(currentDir, 'lerna.json');
    if (fs.existsSync(lernaJsonPath)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Could not find project root containing lerna.json.');
    }
    currentDir = parentDir;
  }
}

let ROOT_DIR: string;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  ROOT_DIR = findProjectRoot(__dirname);
  console.log(
    `[Voxtral Manager Docker] Project root identified as: ${ROOT_DIR}`
  );
} catch (error) {
  console.error('[Voxtral Manager Docker] Error finding project root:', error);
  throw error;
}

const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml');
export const VOXTRAL_SERVICE_NAME_IN_COMPOSE = 'voxtral';
const VOXTRAL_CONTAINER_NAME = 'therascript_voxtral_service';
const VOXTRAL_HEALTH_URL = 'http://localhost:8001/v1/models'; // Changed from /health

const HEALTH_CHECK_RETRIES = 25;
const HEALTH_CHECK_DELAY_MS = 15000; // 15 seconds, model download can be slow
const HEALTH_CHECK_TIMEOUT_MS = 10000; // 10 seconds

let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[Voxtral Manager Docker] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[Voxtral Manager Docker] Failed to connect to Docker daemon:',
    error
  );
}

export async function ensureVoxtralRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure Voxtral is running.'
    );
  }
  const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, '');

  console.log(
    `[Voxtral Manager Docker] Ensuring Voxtral service ('${VOXTRAL_SERVICE_NAME_IN_COMPOSE}') in project '${projectName}' is ready via ${COMPOSE_FILE}...`
  );

  await ensureServiceReady({
    docker,
    containerName: VOXTRAL_CONTAINER_NAME,
    serviceName: VOXTRAL_SERVICE_NAME_IN_COMPOSE,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http',
      url: VOXTRAL_HEALTH_URL,
      retries: HEALTH_CHECK_RETRIES,
      delayMs: HEALTH_CHECK_DELAY_MS,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    },
  });
  console.log(
    '[Voxtral Manager Docker] Voxtral service is confirmed running and healthy.'
  );
}

export async function stopVoxtralService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[Voxtral Manager Docker] Docker client unavailable, cannot stop Voxtral.'
    );
    return;
  }
  console.log(
    `[Voxtral Manager Docker] Attempting to stop Voxtral container: ${VOXTRAL_CONTAINER_NAME}`
  );
  await stopContainer(docker, VOXTRAL_CONTAINER_NAME);
}
