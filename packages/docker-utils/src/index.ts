import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import axios, { AxiosError } from 'axios';
import Dockerode from 'dockerode';

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
  url?: string; // Required if type is 'http'
  retries?: number;
  delayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_RETRIES = 8;
const DEFAULT_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 4000;

/** Helper to run docker compose commands */
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
  // If an extra compose file is provided via env (useful for macOS override without GPU), include it
  const extraCompose = process.env.DOCKER_COMPOSE_EXTRA;
  const extraFlag =
    extraCompose && fs.existsSync(extraCompose) ? ` -f "${extraCompose}"` : '';
  const composeCommand = `docker compose -p ${projectName} -f "${composeFilePath}"${extraFlag} ${command}`;
  console.log(`[Docker Utils] Running: ${composeCommand}`);
  try {
    const { stdout, stderr } = await exec(composeCommand);
    if (
      stderr &&
      !stderr.toLowerCase().includes('warn') &&
      !stderr.toLowerCase().includes('found orphan containers') && // Ignore compose v2 warning
      !stderr.toLowerCase().includes('network') // Ignore network creation/attachment messages
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

/** Finds a container by its specific name using Dockerode */
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

/** Checks if a container is running using Dockerode */
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

/** Performs an HTTP health check against a service URL */
async function checkHttpHealth(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout: timeoutMs });
    // Simple check for 2xx status code
    const isHealthy = response.status >= 200 && response.status < 300;
    if (!isHealthy) {
      console.warn(
        `[Docker Health] Service at ${url} responded but status was not 2xx: ${response.status}`
      );
    }
    return isHealthy; // Return true for any 2xx status
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        // This is common and expected while starting
      } else if (
        error.code === 'ECONNABORTED' ||
        error.message.includes('timeout')
      ) {
        console.warn(
          `[Docker Health] Health check to ${url} timed out after ${timeoutMs}ms.`
        );
      } else {
        console.warn(
          `[Docker Health] Health check to ${url} failed (Axios Error): ${error.message}`
        );
      }
    } else {
      console.warn(
        `[Docker Health] Health check to ${url} failed with non-axios error: ${error}`
      );
    }
    return false;
  }
}

/** Starts a service using Docker Compose */
async function startService(
  composeFilePath: string,
  projectName: string,
  serviceName: string
): Promise<void> {
  console.log(
    `🐳 [Docker Utils] Starting service '${serviceName}' via Docker Compose (${composeFilePath})...`
  );
  try {
    await runDockerComposeCommand(
      composeFilePath,
      projectName,
      `up -d --remove-orphans ${serviceName}`
    );
    console.log(
      `✅ [Docker Utils] 'docker compose up' command issued for service '${serviceName}'.`
    );
  } catch (error) {
    console.error(
      `❌ [Docker Utils] Failed to start service '${serviceName}' via docker compose.`
    );
    throw error;
  }
}

/** Stops a container using Dockerode */
export async function stopContainer(
  docker: Dockerode,
  containerName: string
): Promise<void> {
  console.log(
    `[Docker Utils] Attempting to stop container '${containerName}'...`
  );
  try {
    const container = await findContainerByName(docker, containerName);
    if (container) {
      try {
        console.log(
          `[Docker Utils] Stopping container '${containerName}' (ID: ${container.id})...`
        );
        await container.stop(); // Consider adding timeout { t: 10 }
        console.log(`✅ [Docker Utils] Container '${containerName}' stopped.`);
        // Optionally remove the container after stopping
        // console.log(`[Docker Utils] Removing container '${containerName}'...`);
        // await container.remove();
        // console.log(`✅ [Docker Utils] Container '${containerName}' removed.`);
      } catch (stopError: any) {
        if (stopError.statusCode === 304) {
          console.log(
            `[Docker Utils] Container '${containerName}' already stopped.`
          );
        } else if (stopError.statusCode === 404) {
          console.log(
            `[Docker Utils] Container '${containerName}' not found (already removed?).`
          );
        } else {
          console.error(
            `[Docker Utils] Error stopping container '${containerName}':`,
            stopError
          );
          // Don't rethrow stop errors necessarily, but log them
        }
      }
    } else {
      console.log(
        `[Docker Utils] Container '${containerName}' not found, cannot stop.`
      );
    }
  } catch (error) {
    console.error(
      `[Docker Utils] General error stopping container '${containerName}':`,
      error
    );
    // Don't rethrow general stop errors necessarily
  }
}

/**
 * Ensures a Docker service defined in a compose file is running and healthy.
 * Starts the service if needed and performs health checks based on options.
 */
export async function ensureServiceReady(config: ServiceConfig): Promise<void> {
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
    `🐳 [Docker Utils] Ensuring service '${serviceName}' (container: '${containerName}') is running and healthy...`
  );
  let attemptStart = false;
  let isHealthy = false;

  const isRunning = await isContainerRunning(docker, containerName);

  if (isRunning) {
    console.log(
      `✅ [Docker Utils] Container process '${containerName}' found. Checking health...`
    );
    if (healthCheckType === 'http') {
      if (!healthCheckUrl) throw new Error('HTTP health check requires a URL.');
      isHealthy = await checkHttpHealth(healthCheckUrl, timeoutMs);
    } else {
      // 'running' type health check is satisfied if isRunning is true
      isHealthy = true;
    }

    if (isHealthy) {
      console.log(
        `✅ [Docker Health] Service '${serviceName}' is already running and healthy.`
      );
      return; // Service is ready
    } else {
      console.warn(
        `⚠️ [Docker Health] Container process '${containerName}' is running but service is not healthy yet. Will proceed with start/check logic.`
      );
      // Even though it's running, trigger 'up' to ensure it's properly initialized or restarted if stuck
      attemptStart = true;
    }
  } else {
    console.log(
      `🅾️ [Docker Utils] Container process '${containerName}' not found.`
    );
    attemptStart = true;
  }

  if (attemptStart) {
    console.log(
      `🅾️ [Docker Utils] Attempting to start/restart service '${serviceName}'...`
    );
    await startService(composeFilePath, projectName, serviceName);
  } else {
    console.log(
      `ℹ️ [Docker Utils] Skipping start command for '${serviceName}' as container process was found (but unhealthy).`
    );
  }

  // --- Health Check Polling Loop ---
  if (healthCheckType === 'http' && !healthCheckUrl) {
    throw new Error('HTTP health check type requires a URL.');
  }

  console.log(
    `⏳ [Docker Health] Waiting for service '${serviceName}' to become healthy (retrying up to ${retries} times with ${delayMs / 1000}s delay)...`
  );

  for (let i = 0; i < retries; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    console.log(
      `[Docker Health] Performing health check for '${serviceName}' (Attempt ${i + 1}/${retries})...`
    );

    // Check container existence first
    const stillRunning = await isContainerRunning(docker, containerName);
    if (!stillRunning) {
      console.error(
        `❌ [Docker Utils] Container '${containerName}' stopped running during health check polling! Check container logs.`
      );
      isHealthy = false;
      break; // Exit loop if container stopped
    }

    // Perform the actual health check
    if (healthCheckType === 'http') {
      isHealthy = await checkHttpHealth(healthCheckUrl!, timeoutMs);
    } else {
      // For 'running' type, isHealthy is true if stillRunning is true
      isHealthy = true;
    }

    if (isHealthy) {
      console.log(
        `✅ [Docker Health] Service '${serviceName}' became healthy.`
      );
      break; // Exit loop on success
    }
  }

  // Final check after the loop
  if (!isHealthy) {
    console.log(
      `[Docker Health] Performing one final health check for '${serviceName}'...`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Short wait
    const stillRunningFinal = await isContainerRunning(docker, containerName);
    if (stillRunningFinal) {
      if (healthCheckType === 'http') {
        isHealthy = await checkHttpHealth(healthCheckUrl!, timeoutMs);
      } else {
        isHealthy = true;
      }
    }
  }

  if (!isHealthy) {
    const errorMsg = `Service '${serviceName}' did not become healthy after multiple retries.`;
    console.error(`❌ [Docker Health] ${errorMsg}`);
    console.error(
      `   >>> Please check the container logs: docker logs ${containerName} <<<`
    );
    // Or use compose logs: `docker compose -f "${composeFilePath}" logs ${serviceName}`
    throw new Error(errorMsg);
  }

  console.log(
    `🚀 [Docker Utils] Service '${serviceName}' is confirmed running and healthy.`
  );
}
