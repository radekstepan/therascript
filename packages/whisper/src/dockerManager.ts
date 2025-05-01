import * as path from 'path';
import * as fs from 'fs';
import Dockerode from 'dockerode';
import { fileURLToPath } from 'node:url';

import { ensureServiceReady, stopContainer } from '@therascript/docker-utils';

// --- Configuration ---
// Find project root relative to this file using ES Module method
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
      // Reached the filesystem root without finding indicator files
      throw new Error(
        'Could not find project root containing package.json and lerna.json.'
      );
    }
    currentDir = parentDir;
  }
}

let ROOT_DIR: string;
try {
  // Get the directory name of the current module file
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename); // <-- Correct way to get dirname in ESM
  // Now find the project root starting from the directory containing this built file (e.g., dist/)
  ROOT_DIR = findProjectRoot(__dirname);
  console.log(`[Whisper Docker] Project root identified as: ${ROOT_DIR}`);
} catch (error) {
  console.error('[Whisper Docker] Error finding project root:', error);
  throw error; // Re-throw critical error
}

const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml'); // Use root compose file
export const WHISPER_SERVICE_NAME = 'whisper'; // Name from root compose file
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service'; // Name from root compose file
const WHISPER_HEALTH_URL = 'http://localhost:8000/health'; // Default health endpoint
const HEALTH_CHECK_RETRIES = 8;
const HEALTH_CHECK_DELAY_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 4000;

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[Whisper Docker Manager] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[Whisper Docker Manager] Failed to connect to Docker daemon:',
    error
  );
  // Keep docker as null, functions will handle it
}

// --- Ensures the Whisper service is running AND healthy using shared utility ---
export async function ensureWhisperRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure Whisper running.'
    );
  }
  // Derive project name from the root directory path for docker-compose project isolation
  const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, '');
  await ensureServiceReady({
    docker,
    containerName: WHISPER_CONTAINER_NAME,
    serviceName: WHISPER_SERVICE_NAME,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http', // Whisper service has an HTTP health endpoint
      url: WHISPER_HEALTH_URL,
      retries: HEALTH_CHECK_RETRIES,
      delayMs: HEALTH_CHECK_DELAY_MS,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    },
  });
}

// --- Stops the Whisper service using shared utility ---
export async function stopWhisperService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[Whisper Docker Manager] Docker client unavailable, cannot stop Whisper.'
    );
    return;
  }
  await stopContainer(docker, WHISPER_CONTAINER_NAME);
}
