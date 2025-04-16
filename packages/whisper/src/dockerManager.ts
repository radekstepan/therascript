// packages/whisper/src/dockerManager.ts
import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios'; // *** ADD axios import ***

const exec = util.promisify(callbackExec);

// Path to the ROOT docker-compose.yml
const COMPOSE_FILE = path.resolve(__dirname, '..', '..', '..', 'docker-compose.yml');
// Service name defined in the root docker-compose.yml
export const WHISPER_SERVICE_NAME = 'whisper';
// *** ADD Health Check Config ***
const WHISPER_HEALTH_URL = 'http://localhost:8000/health'; // Assumes port 8000 is mapped
const HEALTH_CHECK_RETRIES = 8; // Increased retries
const HEALTH_CHECK_DELAY = 5000; // 5 seconds delay
const HEALTH_CHECK_TIMEOUT = 4000; // Timeout for the health check request itself

/** Helper to run docker compose commands */
async function runDockerComposeCommand(command: string): Promise<string> {
    // Check if compose file exists before trying to use it
    if (!fs.existsSync(COMPOSE_FILE)) {
        console.error(`[Whisper Docker] Docker Compose file not found at expected path: ${COMPOSE_FILE}`);
        throw new Error(`[Whisper Docker] Docker Compose file not found at: ${COMPOSE_FILE}. Cannot manage service.`);
    }
    try {
        const { stdout, stderr } = await exec(`docker compose -f "${COMPOSE_FILE}" ${command}`);
        if (stderr && !stderr.toLowerCase().includes("warn")) { // Ignore docker compose warnings
             console.warn(`[Whisper Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Whisper Docker] Error executing Compose command: ${command}`);
        if (error.stderr) console.error(`[Whisper Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Whisper Docker] Stdout: ${error.stdout}`);
        if (error.message) console.error(`[Whisper Docker] Error message: ${error.message}`);
        throw new Error(`[Whisper Docker] Failed to run 'docker compose ${command}'. Is Docker running and compose file correct at ${COMPOSE_FILE}?`);
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
        // If 'docker compose ps -q' fails (e.g., compose file error), it throws.
        // Also, 'docker inspect' could fail if the container disappeared between commands.
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
             // Log if the service responded but wasn't healthy
             console.warn(`[Whisper Health] Service responded but status was not healthy: ${response.status} - ${JSON.stringify(response.data)}`);
         }
        return isHealthy;
    } catch (error: any) {
        // Handle different types of axios errors during health check
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED') {
                // Service is not listening yet (common during startup)
                console.info(`[Whisper Health] Health check refused (service likely still starting or stopped)...`);
            } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                 // Request timed out
                 console.warn(`[Whisper Health] Health check timed out after ${HEALTH_CHECK_TIMEOUT}ms.`);
            } else {
                 // Other axios errors (network issues, DNS, etc.)
                 console.warn(`[Whisper Health] Health check failed (Axios Error): ${error.message}`);
            }
        } else {
            // Non-axios errors during the request attempt
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
        // No delay here, the health check loop will handle waiting
        console.log("✅ [Whisper Docker] 'docker compose up' command issued.");
    } catch (error) {
         console.error("❌ [Whisper Docker] Failed to start Whisper service (docker compose up failed).");
        throw error; // Re-throw to indicate critical failure
    }
}

/** Ensures the Whisper service is running AND healthy */
export async function ensureWhisperRunning(): Promise<void> {
    console.log("🐳 [Whisper Docker] Ensuring Whisper service is running and healthy...");

    let attemptStart = false; // Flag to indicate if we attempted to start the service

    // Check if already running AND healthy first
    if (await isWhisperContainerRunning()) {
        console.log("✅ [Whisper Docker] Container process found. Checking health...");
        if (await checkServiceHealth()) {
             console.log("✅ [Whisper Health] Service is already running and healthy.");
             return; // Already good, no need to start or poll
        }
        console.warn("⚠️ [Whisper Health] Container process is running but service is not healthy yet. Will proceed with start/check logic.");
        // No need to explicitly stop here, 'up' handles existing containers.
        attemptStart = true; // Treat as if we need to start because it's not healthy
    } else {
        // If container wasn't even running
        attemptStart = true;
    }

    // If not running or not healthy, attempt to start
    if (attemptStart) {
        console.log("🅾️ [Whisper Docker] Attempting to start/restart Whisper service...");
        await startWhisperService(); // This might throw if 'up' command fails critically
    } else {
         console.log("ℹ️ [Whisper Docker] Skipping start command as container process was found (but might be unhealthy).");
    }


    // Wait and perform health checks
    console.log(`⏳ [Whisper Health] Waiting for service to become healthy (retrying up to ${HEALTH_CHECK_RETRIES} times with ${HEALTH_CHECK_DELAY / 1000}s delay)...`);
    let isHealthy = false;
    for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
        // Wait *before* checking (gives service time to start/recover)
        await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_DELAY));
        console.log(`[Whisper Health] Performing health check (Attempt ${i + 1}/${HEALTH_CHECK_RETRIES})...`);

        isHealthy = await checkServiceHealth();
        if (isHealthy) {
            console.log("✅ [Whisper Health] Whisper service became healthy.");
            break; // Exit loop on success
        }

        // Optional: Check if the Docker container itself is still running if health checks fail
        // This helps differentiate between a slow start and a crash.
        if (!(await isWhisperContainerRunning())) {
             console.error("❌ [Whisper Docker] Container stopped running during health check polling! Check internal container logs.");
             isHealthy = false; // Ensure isHealthy is false
             break; // Stop polling if container disappears
         }
    }

    // Final check after loop (maybe it became healthy just after the last check)
    if (!isHealthy) {
        console.log("[Whisper Health] Performing one final health check...");
        await new Promise(resolve => setTimeout(resolve, 1000)); // Brief wait before final check
        isHealthy = await checkServiceHealth();
    }

    if (!isHealthy) {
        console.error("❌ [Whisper Health] Whisper service did not become healthy after multiple retries.");
        console.error("   >>> Please check the container logs: docker compose logs whisper <<<");
        // Throw an error to signal failure to the calling script (index.ts)
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
         // Don't re-throw, just log the error
    }
}
