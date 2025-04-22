import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import axios, { AxiosError } from 'axios'; // Ensure AxiosError is imported
import Dockerode from 'dockerode';

const exec = util.promisify(callbackExec);

// --- Configuration ---
// Explicitly type the return value
function findProjectRoot(startDir: string): string {
    let currentDir = startDir;
    while (true) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const lernaJsonPath = path.join(currentDir, 'lerna.json'); // Also look for lerna.json as a fallback indicator

        if (fs.existsSync(packageJsonPath) && fs.existsSync(lernaJsonPath)) {
            return currentDir; // Explicit return
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error("Could not find project root containing package.json and lerna.json."); // Throws, satisfies return path
        }
        currentDir = parentDir;
    }
}
let ROOT_DIR: string;
try { ROOT_DIR = findProjectRoot(__dirname); console.log(`[Whisper Docker] Project root identified as: ${ROOT_DIR}`); }
catch (error) { console.error("[Whisper Docker] Error finding project root:", error); throw error; }
const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml');
export const WHISPER_SERVICE_NAME = 'whisper';
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service'; // Exact name from root docker-compose.yml
const WHISPER_HEALTH_URL = 'http://localhost:8000/health';
const HEALTH_CHECK_RETRIES = 8;
const HEALTH_CHECK_DELAY = 5000;
const HEALTH_CHECK_TIMEOUT = 4000;

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
    docker = new Dockerode();
    console.log('[Whisper Docker Manager] Connected to Docker daemon.');
} catch (error) {
    console.error('[Whisper Docker Manager] Failed to connect to Docker daemon:', error);
}

// --- Helper Functions ---
/** Helper to run docker compose commands (used for start) */
// Explicitly type the return value
async function runDockerComposeCommand(command: string): Promise<string> {
    if (!fs.existsSync(COMPOSE_FILE)) {
        const errorMessage = `[Whisper Docker] Root Docker Compose file not found at: ${COMPOSE_FILE}. Cannot manage service.`;
        console.error(errorMessage);
        // Use standard Error
        throw new Error(errorMessage);
    }
    const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, '');
    const composeCommand = `docker compose -p ${projectName} -f "${COMPOSE_FILE}" ${command}`;
    console.log(`[Whisper Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn") && !stderr.toLowerCase().includes("found orphan containers")) {
             console.warn(`[Whisper Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim(); // Explicit return
    } catch (error: any) {
        console.error(`[Whisper Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Whisper Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Whisper Docker] Stdout: ${error.stdout}`);
        // Use standard Error
        throw new Error(`[Whisper Docker] Failed to run 'docker compose ${command}'. Is Docker running? Error: ${error.message}`); // Throws, satisfies return path
    }
}

/**
 * Finds the Whisper container by its specific name.
 * @returns Dockerode Container object or null if not found or Docker unavailable.
 */
const findWhisperContainer = async (): Promise<Dockerode.Container | null> => {
    if (!docker) {
        console.warn('[Whisper Docker Manager] Docker client unavailable.');
        return null;
    }
    try {
        const containers = await docker.listContainers({ all: true });
        const found = containers.find(c => c.Names.some(name => name === `/${WHISPER_CONTAINER_NAME}`));
        return found ? docker.getContainer(found.Id) : null;
    } catch (error) {
        console.error(`[Whisper Docker Manager] Error finding container '${WHISPER_CONTAINER_NAME}':`, error);
        return null;
    }
};

// --- Docker Management Functions ---

/** Checks if the Whisper container is running (using Dockerode) */
async function isWhisperContainerRunning(): Promise<boolean> {
    const container = await findWhisperContainer();
    if (!container) return false;
    try {
        const data = await container.inspect();
        console.log(`[Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' state: ${data.State.Status}`);
        return data.State.Running === true;
    } catch (error: any) {
        if (error.statusCode === 404) { // Check specific Dockerode error
            console.warn(`[Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' not found during inspect.`);
        } else {
            console.error(`[Whisper Docker Manager] Error inspecting container '${WHISPER_CONTAINER_NAME}':`, error);
        }
        return false;
    }
}

/** Performs an HTTP health check against the service (Kept using axios) */
async function checkServiceHealth(): Promise<boolean> {
    try {
        const response = await axios.get(WHISPER_HEALTH_URL, { timeout: HEALTH_CHECK_TIMEOUT });
        const isHealthy = response.status === 200 && response.data?.status === 'healthy';
         if (!isHealthy) {
             console.warn(`[Whisper Health] Service responded but status was not healthy: ${response.status} - ${JSON.stringify(response.data)}`);
         }
        return isHealthy; // Explicit return on success
    } catch (error: any) {
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED') {
                console.info(`[Whisper Health] Health check refused (service likely still starting or stopped)...`);
            } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                 console.warn(`[Whisper Health] Health check timed out after ${HEALTH_CHECK_TIMEOUT}ms.`);
            } else {
                 console.warn(`[Whisper Health] Health check failed (Axios Error): ${error.message}`);
            }
        } else {
            console.warn(`[Whisper Health] Health check failed with non-axios error: ${error}`);
        }
        return false; // *** ADDED: Explicit return false on any error ***
    }
}

/** Starts the Whisper service using Docker Compose */
async function startWhisperService(): Promise<void> {
    console.log("🐳 [Whisper Docker] Starting Whisper service via Docker Compose...");
    try {
        await runDockerComposeCommand(`up -d --remove-orphans ${WHISPER_SERVICE_NAME}`);
        console.log("✅ [Whisper Docker] 'docker compose up' command issued.");
    } catch (error) {
         console.error("❌ [Whisper Docker] Failed to start Whisper service (docker compose up failed).");
         // Re-throw the Error from the helper
        throw error;
    }
}

/** Ensures the Whisper service is running AND healthy */
export async function ensureWhisperRunning(): Promise<void> {
    console.log("🐳 [Whisper Docker] Ensuring Whisper service is running and healthy...");
    let attemptStart = false;

    if (await isWhisperContainerRunning()) {
        console.log("✅ [Whisper Docker] Container process found. Checking health...");
        if (await checkServiceHealth()) {
             console.log("✅ [Whisper Health] Service is already running and healthy.");
             return;
        }
        console.warn("⚠️ [Whisper Health] Container process is running but service is not healthy yet. Will proceed with start/check logic.");
        attemptStart = true; // Attempt start to ensure it's properly initialized
    } else {
        console.log("🅾️ [Whisper Docker] Container process not found.");
        attemptStart = true;
    }

    if (attemptStart) {
        console.log("🅾️ [Whisper Docker] Attempting to start/restart Whisper service...");
        await startWhisperService(); // Uses compose
    } else {
         console.log("ℹ️ [Whisper Docker] Skipping start command as container process was found (but might be unhealthy).");
    }

    // Health check polling loop (unchanged)
    console.log(`⏳ [Whisper Health] Waiting for service to become healthy (retrying up to ${HEALTH_CHECK_RETRIES} times with ${HEALTH_CHECK_DELAY / 1000}s delay)...`);
    let isHealthy = false;
    for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
        await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_DELAY));
        console.log(`[Whisper Health] Performing health check (Attempt ${i + 1}/${HEALTH_CHECK_RETRIES})...`);
        isHealthy = await checkServiceHealth();
        if (isHealthy) {
            console.log("✅ [Whisper Health] Whisper service became healthy.");
            break;
        }
        // Add extra check: if container stopped during polling, fail fast
        if (!(await isWhisperContainerRunning())) {
             console.error("❌ [Whisper Docker] Container stopped running during health check polling! Check internal container logs.");
             isHealthy = false;
             break; // Exit loop if container stopped
         }
    }

    if (!isHealthy) {
        console.log("[Whisper Health] Performing one final health check...");
        await new Promise(resolve => setTimeout(resolve, 1000)); // Short wait before final check
        isHealthy = await checkServiceHealth();
    }

    if (!isHealthy) {
        const errorMsg = "Failed to confirm Whisper service health after start attempt.";
        console.error("❌ [Whisper Health] Whisper service did not become healthy after multiple retries.");
        console.error("   >>> Please check the container logs: docker compose logs whisper <<<");
        // Use standard Error
        throw new Error(errorMsg);
    }
    console.log("🚀 [Whisper Docker] Service is confirmed running and healthy.");
}

/** Stops the Whisper service using Dockerode */
export async function stopWhisperService(): Promise<void> {
    if (!docker) {
        console.warn('[Whisper Docker Manager] Docker client unavailable, cannot stop Whisper.');
        return;
    }
    console.log(`[Whisper Docker Manager] Attempting to stop container '${WHISPER_CONTAINER_NAME}'...`);
    try {
        const container = await findWhisperContainer();
        if (container) {
             try {
                 console.log(`[Whisper Docker Manager] Stopping container '${WHISPER_CONTAINER_NAME}' (ID: ${container.id})...`);
                 await container.stop(); // Configurable timeout? Add { t: 10 } for 10s timeout
                 console.log(`✅ [Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' stopped.`);
                  // Remove container after stop?
                 // console.log(`[Whisper Docker Manager] Removing container '${WHISPER_CONTAINER_NAME}'...`);
                 // await container.remove();
                 // console.log(`✅ [Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' removed.`);
             } catch (stopError: any) {
                 if (stopError.statusCode === 304) { console.log(`[Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' already stopped.`); }
                 else if (stopError.statusCode === 404) { console.log(`[Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' not found (already removed?).`); }
                 else { console.error(`[Whisper Docker Manager] Error stopping container '${WHISPER_CONTAINER_NAME}':`, stopError); }
             }
         } else {
            console.log(`[Whisper Docker Manager] Container '${WHISPER_CONTAINER_NAME}' not found, cannot stop.`);
        }
    } catch (error) {
        console.error(`[Whisper Docker Manager] General error stopping Whisper service:`, error);
    }
}
