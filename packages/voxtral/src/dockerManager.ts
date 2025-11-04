import * as path from 'path';
import * as fs from 'fs';
import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import axios from 'axios';
import Dockerode from 'dockerode';
import { fileURLToPath } from 'node:url';

// ==================================================================
// --- START: Inlined docker utils (kept consistent with whisper) ---
// ==================================================================
const exec = util.promisify(callbackExec);

interface ServiceConfig {
  docker: Dockerode;
  containerName: string;
  serviceName: string;
  composeFilePath: string;
  projectName: string;
  healthCheck: HealthCheckOptions;
}

interface HealthCheckOptions {
  type: 'http' | 'running';
  url?: string;
  retries?: number;
  delayMs?: number;
  timeoutMs?: number;
}

// Voxtral (vLLM) first-time startup can take a while (model download, CUDA graph capture, inductor compile).
// Bump defaults to be more forgiving so dev doesn't fail prematurely.
const DEFAULT_RETRIES = 24; // 24 * 10s = ~4 minutes
const DEFAULT_DELAY_MS = 10000;
const DEFAULT_TIMEOUT_MS = 8000;

async function runDockerComposeCommand(
  composeFilePath: string,
  projectName: string,
  command: string
): Promise<string> {
  if (!fs.existsSync(composeFilePath)) {
    const errorMessage = `[Docker Utils] Docker Compose file not found at: ${composeFilePath}. Cannot manage service.`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  const composeCommand = `docker compose -p ${projectName} -f "${composeFilePath}" ${command}`;
  console.log(`[Docker Utils] Running: ${composeCommand}`);
  try {
    const { stdout, stderr } = await exec(composeCommand);
    if (
      stderr &&
      !stderr.toLowerCase().includes('warn') &&
      !stderr.toLowerCase().includes('found orphan containers')
    ) {
      console.warn(`[Docker Utils] Compose stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: any) {
    console.error(`[Docker Utils] Error executing: ${composeCommand}`);
    if (error.stderr) console.error(`[Docker Utils] Stderr: ${error.stderr}`);
    if (error.stdout) console.error(`[Docker Utils] Stdout: ${error.stdout}`);
    throw new Error(
      `Failed to run 'docker compose ${command}'. Is Docker running? Error: ${error.message}`
    );
  }
}

const findContainerByName = async (
  docker: Dockerode,
  containerName: string
): Promise<Dockerode.Container | null> => {
  try {
    const containers = await docker.listContainers({ all: true });
    const found = containers.find((c) =>
      c.Names.some((name) => name === `/${containerName}`)
    );
    return found ? docker.getContainer(found.Id) : null;
  } catch (error) {
    console.error(
      `[Docker Utils] Error finding container '${containerName}':`,
      error
    );
    return null;
  }
};

async function isContainerRunning(
  docker: Dockerode,
  containerName: string
): Promise<boolean> {
  const container = await findContainerByName(docker, containerName);
  if (!container) return false;
  try {
    const data = await container.inspect();
    console.log(
      `[Docker Utils] Container '${containerName}' state: ${data.State.Status}`
    );
    return data.State.Running === true;
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.warn(
        `[Docker Utils] Container '${containerName}' not found during inspect.`
      );
    } else {
      console.error(
        `[Docker Utils] Error inspecting container '${containerName}':`,
        error
      );
    }
    return false;
  }
}

async function checkHttpHealth(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout: timeoutMs });
    return response.status >= 200 && response.status < 300;
  } catch (error: any) {
    return false;
  }
}

async function startService(
  composeFilePath: string,
  projectName: string,
  serviceName: string
): Promise<void> {
  console.log(
    `🐳 [Docker Utils] Starting service '${serviceName}' via Docker Compose...`
  );
  await runDockerComposeCommand(
    composeFilePath,
    projectName,
    `up -d --remove-orphans ${serviceName}`
  );
  console.log(
    `✅ [Docker Utils] 'docker compose up' command issued for service '${serviceName}'.`
  );
}

export async function stopContainer(
  docker: Dockerode,
  containerName: string
): Promise<void> {
  console.log(
    `[Docker Utils] Attempting to stop container '${containerName}'...`
  );
  const container = await findContainerByName(docker, containerName);
  if (container) {
    try {
      await container.stop();
      console.log(`✅ [Docker Utils] Container '${containerName}' stopped.`);
    } catch (stopError: any) {
      if (stopError.statusCode === 304) {
        console.log(
          `[Docker Utils] Container '${containerName}' already stopped.`
        );
      } else {
        console.error(
          `[Docker Utils] Error stopping container '${containerName}':`,
          stopError
        );
      }
    }
  } else {
    console.log(
      `[Docker Utils] Container '${containerName}' not found, cannot stop.`
    );
  }
}

async function ensureServiceReady(config: ServiceConfig): Promise<void> {
  const {
    docker,
    containerName,
    serviceName,
    composeFilePath,
    projectName,
    healthCheck,
  } = config;
  const {
    type: healthCheckType,
    url: healthCheckUrl,
    retries = DEFAULT_RETRIES,
    delayMs = DEFAULT_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = healthCheck;
  console.log(
    `🐳 [Docker Utils] Ensuring service '${serviceName}' (container: '${containerName}') is ready...`
  );
  if (!(await isContainerRunning(docker, containerName))) {
    await startService(composeFilePath, projectName, serviceName);
  }
  for (let i = 0; i < retries; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    console.log(
      `[Docker Health] Performing health check for '${serviceName}' (Attempt ${i + 1}/${retries})...`
    );
    let isHealthy = false;
    if (healthCheckType === 'http' && healthCheckUrl) {
      isHealthy = await checkHttpHealth(healthCheckUrl, timeoutMs);
    } else {
      isHealthy = await isContainerRunning(docker, containerName);
    }
    if (isHealthy) {
      console.log(`✅ [Docker Health] Service '${serviceName}' is healthy.`);
      return;
    }
  }
  throw new Error(
    `Service '${serviceName}' did not become healthy after multiple retries.`
  );
}
// ================================================================
// --- END: Inlined docker utils ---
// ================================================================

// --- Configuration ---
function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    if (fs.existsSync(path.join(currentDir, 'lerna.json'))) return currentDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir)
      throw new Error('Could not find project root.');
    currentDir = parentDir;
  }
}

let ROOT_DIR: string;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  ROOT_DIR = findProjectRoot(__dirname);
  console.log(`[Voxtral Docker] Project root identified as: ${ROOT_DIR}`);
} catch (error) {
  console.error('[Voxtral Docker] Error finding project root:', error);
  throw error;
}

const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml');
const VOXTRAL_SERVICE_NAME = 'voxtral';
const VOXTRAL_CONTAINER_NAME = 'therascript_voxtral_service';
const VOXTRAL_HEALTH_URL = 'http://localhost:8010/v1/models';

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[Voxtral Docker Manager] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[Voxtral Docker Manager] Failed to connect to Docker daemon:',
    error
  );
}

// --- Service Management Functions ---
export async function ensureVoxtralRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure Voxtral running.'
    );
  }
  const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, '');
  await ensureServiceReady({
    docker,
    containerName: VOXTRAL_CONTAINER_NAME,
    serviceName: VOXTRAL_SERVICE_NAME,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http',
      url: VOXTRAL_HEALTH_URL,
      // Explicitly override to ample values regardless of defaults
      retries: 30, // up to ~5 minutes with 10s delay
      delayMs: 10000,
      timeoutMs: 8000,
    },
  });
}

export async function stopVoxtralService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[Voxtral Docker Manager] Docker client unavailable, cannot stop Voxtral.'
    );
    return;
  }
  await stopContainer(docker, VOXTRAL_CONTAINER_NAME);
}
