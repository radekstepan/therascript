// packages/whisper/src/dockerManager.ts
import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

const exec = util.promisify(callbackExec);

// --- Helper function to find project root ---
function findProjectRoot(startDir: string): string {
    let currentDir = startDir;
    while (true) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const lernaJsonPath = path.join(currentDir, 'lerna.json'); // Also look for lerna.json as a fallback indicator

        if (fs.existsSync(packageJsonPath) && fs.existsSync(lernaJsonPath)) {
            // Found the directory containing both package.json and lerna.json
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        // If we've reached the filesystem root and haven't found it, throw an error
        if (parentDir === currentDir) {
            throw new Error("Could not find project root containing package.json and lerna.json.");
        }
        currentDir = parentDir;
    }
}
// --- End Helper ---

// --- Use the helper to find the root ---
let ROOT_DIR: string;
try {
    // Start searching from the directory of the current file (__dirname)
    ROOT_DIR = findProjectRoot(__dirname);
    console.log(`[Whisper Docker] Project root identified as: ${ROOT_DIR}`);
} catch (error) {
     console.error("[Whisper Docker] Error finding project root:", error);
     // Fallback or rethrow, depending on desired behavior. Rethrowing is safer.
     throw error;
}

const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml');
// --- End Root Finding ---


// Service name defined in the root docker-compose.yml
export const WHISPER_SERVICE_NAME = 'whisper';
const WHISPER_HEALTH_URL = 'http://localhost:8000/health'; // Assumes port 8000 is mapped
const HEALTH_CHECK_RETRIES = 8;
const HEALTH_CHECK_DELAY = 5000;
const HEALTH_CHECK_TIMEOUT = 4000;

/** Helper to run docker compose commands */
async function runDockerComposeCommand(command: string): Promise<string> {
    // Check if compose file exists before trying to use it
    if (!fs.existsSync(COMPOSE_FILE)) {
        console.error(`[Whisper Docker] Docker Compose file not found at expected path: ${COMPOSE_FILE}`);
        throw new Error(`[Whisper Docker] Docker Compose file not found at: ${COMPOSE_FILE}. Cannot manage service.`);
    }
     // Use -p <project_name> to avoid conflicts if other compose files are used
     const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, ''); // Simple project name from dir
     const composeCommand = `docker compose -p ${projectName} -f "${COMPOSE_FILE}" ${command}`;
     console.log(`[Whisper Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn") && !stderr.toLowerCase().includes("found orphan containers")) { // Ignore more warnings
             console.warn(`[Whisper Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Whisper Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Whisper Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Whisper Docker] Stdout: ${error.stdout}`);
        if (error.message) console.error(`[Whisper Docker] Error message: ${error.message}`);
        // Make error more specific
        throw new Error(`[Whisper Docker] Failed to run 'docker compose ${command}'. Is Docker running? Error: ${error.message}`);
    }
}

/** Checks if the Whisper container is running (basic Docker status) */
async function isWhisperContainerRunning(): Promise<boolean> {
    try {
        const containerId = await runDockerComposeCommand(`ps -q ${WHISPER_SERVICE_NAME}`);
        if (!containerId) return false; // No container found for the service
        // Check the status of the found container ID
        const { stdout: statusOutput } = await exec(`docker inspect --format='{{.State.Status}}' ${containerId}`);
        return statusOutput.trim() === 'running';
    } catch (error: any) {
        console.warn(`[Whisper Docker] Error checking basic running status (container might be stopped or compose file issue): ${error.message}`);
        return false; // Assume not running if status check fails
    }
}

/** Performs an HTTP health check against the service */
async function checkServiceHealth(): Promise<boolean> {
    try {
        const response = await axios.get(WHISPER_HEALTH_URL, { timeout: HEALTH_CHECK_TIMEOUT });
        const isHealthy = response.status === 200 && response.data?.status === 'healthy';
         if (!isHealthy) {
             console.warn(`[Whisper Health] Service responded but status was not healthy: ${response.status} - ${JSON.stringify(response.data)}`);
         }
        return isHealthy;
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
        return false; // Treat any error as unhealthy
    }
}


/** Starts the Whisper service using Docker Compose */
async function startWhisperService(): Promise<void> {
    console.log("🐳 [Whisper Docker] Starting Whisper service via Docker Compose...");
    try {
        // Use --remove-orphans to clean up any potential old containers for this service
        await runDockerComposeCommand(`up -d --remove-orphans ${WHISPER_SERVICE_NAME}`);
        console.log("✅ [Whisper Docker] 'docker compose up' command issued.");
    } catch (error) {
         console.error("❌ [Whisper Docker] Failed to start Whisper service (docker compose up failed).");
        throw error; // Re-throw to indicate critical failure
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
        attemptStart = true;
    } else {
        attemptStart = true;
    }

    if (attemptStart) {
        console.log("🅾️ [Whisper Docker] Attempting to start/restart Whisper service...");
        await startWhisperService();
    } else {
         console.log("ℹ️ [Whisper Docker] Skipping start command as container process was found (but might be unhealthy).");
    }

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
        if (!(await isWhisperContainerRunning())) {
             console.error("❌ [Whisper Docker] Container stopped running during health check polling! Check internal container logs.");
             isHealthy = false;
             break;
         }
    }

    if (!isHealthy) {
        console.log("[Whisper Health] Performing one final health check...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        isHealthy = await checkServiceHealth();
    }

    if (!isHealthy) {
        console.error("❌ [Whisper Health] Whisper service did not become healthy after multiple retries.");
        console.error("   >>> Please check the container logs: docker compose logs whisper <<<");
        throw new Error("Failed to confirm Whisper service health after start attempt.");
    }
    console.log("🚀 [Whisper Docker] Service is confirmed running and healthy.");
}

/** Stops the Whisper service */
export async function stopWhisperService(): Promise<void> {
    console.log("🐳 [Whisper Docker] Stopping Whisper service...");
    try {
        await runDockerComposeCommand(`down`); // Use 'down' which stops and removes
        console.log("✅ [Whisper Docker] Whisper service stopped and removed.");
    } catch (error) {
         console.error("❌ [Whisper Docker] Failed to stop Whisper service via compose. You may need to stop it manually ('docker compose down').");
    }
}
