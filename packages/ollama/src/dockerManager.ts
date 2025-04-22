import { exec as callbackExec, spawn, ChildProcess } from 'child_process'; // Keep spawn for pull stream
import * as util from 'util';
import * as path from 'path';
import { Readable } from 'stream'; // Keep Readable for pull stream
import Dockerode from 'dockerode'; // Import Dockerode
import * as fs from 'fs'; // Added fs import

const exec = util.promisify(callbackExec);

// --- Configuration ---
const COMPOSE_FILE = path.resolve(__dirname, '..', 'docker-compose.yml');
export const OLLAMA_SERVICE_NAME = 'ollama';
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed'; // Exact name from docker-compose.yml

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
    docker = new Dockerode();
    console.log('[Ollama Docker Manager] Connected to Docker daemon.');
} catch (error) {
    console.error('[Ollama Docker Manager] Failed to connect to Docker daemon:', error);
}

// --- Helper Functions ---
/** Helper to run docker compose commands (used for start/pull/list) */
async function runDockerComposeCommand(command: string): Promise<string> {
    // Check if compose file exists before trying to use it
    if (!fs.existsSync(COMPOSE_FILE)) {
        const errorMessage = `[Ollama Docker] Docker Compose file not found at expected path: ${COMPOSE_FILE}. Cannot manage service.`;
        console.error(errorMessage);
        // Use standard Error as InternalServerError is not available here
        throw new Error(errorMessage);
    }
    const composeCommand = `docker compose -f "${COMPOSE_FILE}" ${command}`;
    console.log(`[Ollama Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn")) {
             console.warn(`[Ollama Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Ollama Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Ollama Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Ollama Docker] Stdout: ${error.stdout}`);
        // Use standard Error
        throw new Error(`Failed to run 'docker compose ${command}'. Is Docker running? Error: ${error.message}`);
    }
}

/**
 * Finds the Ollama container by its specific name.
 * @returns Dockerode Container object or null if not found or Docker unavailable.
 */
const findOllamaContainer = async (): Promise<Dockerode.Container | null> => {
    if (!docker) {
        console.warn('[Ollama Docker Manager] Docker client unavailable.');
        return null;
    }
    try {
        const containers = await docker.listContainers({ all: true });
        const found = containers.find(c => c.Names.some(name => name === `/${OLLAMA_CONTAINER_NAME}`));
        return found ? docker.getContainer(found.Id) : null;
    } catch (error) {
        console.error(`[Ollama Docker Manager] Error finding container '${OLLAMA_CONTAINER_NAME}':`, error);
        return null;
    }
};


// --- Docker Management Functions ---

/** Checks if the Ollama container is running */
async function isOllamaContainerRunning(): Promise<boolean> {
    const container = await findOllamaContainer();
    if (!container) return false;
    try {
        const data = await container.inspect();
        console.log(`[Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' state: ${data.State.Status}`);
        return data.State.Running === true;
    } catch (error: any) {
        if (error.statusCode === 404) { // Dockerode error for not found
             console.warn(`[Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' not found during inspect.`);
        } else {
            console.error(`[Ollama Docker Manager] Error inspecting container '${OLLAMA_CONTAINER_NAME}':`, error);
        }
        return false;
    }
}

/** Starts the Ollama service using Docker Compose */
async function startOllamaService(): Promise<void> {
    console.log("🐳 [Ollama Docker] Starting Ollama service via Docker Compose...");
    try {
        await runDockerComposeCommand(`up -d ${OLLAMA_SERVICE_NAME}`);
        console.log("⏳ [Ollama Docker] Waiting for Ollama service to potentially initialize (approx 15s)...");
        await new Promise(resolve => setTimeout(resolve, 15000));
        console.log("✅ [Ollama Docker] Ollama service should be starting up.");
    } catch (error) {
         console.error("❌ [Ollama Docker] Failed to start Ollama service.");
        // Re-throw the Error from the helper
        throw error;
    }
}

/** Checks if the specified model is available in Ollama (Kept using docker compose exec) */
export async function isModelPulled(modelName: string): Promise<boolean> {
     console.log(`🔍 [Ollama Docker] Checking if model "${modelName}" is pulled...`);
    try {
        const output = await runDockerComposeCommand(`exec ${OLLAMA_SERVICE_NAME} ollama list`);
        const lines = output.split('\n').slice(1); // Skip header line
        for (const line of lines) {
            const nameParts = line.trim().split(/\s+/);
            if (nameParts.length > 0 && nameParts[0].startsWith(modelName)) {
                console.log(`✅ [Ollama Docker] Model "${modelName}" found locally.`);
                return true;
            }
        }
        console.log(`🔻 [Ollama Docker] Model "${modelName}" not found locally.`);
        return false;
    } catch (error: any) {
        console.error(`❌ [Ollama Docker] Error checking for model "${modelName}" via compose exec. Is the container running correctly?`, error.message);
        if (!(await isOllamaContainerRunning())) {
            console.error(`[Ollama Docker] Container '${OLLAMA_CONTAINER_NAME}' is not running.`);
        }
        return false;
    }
}

/** Pulls the specified model using Docker Compose (Kept using spawn) */
export function pullModelStream(modelName: string): Readable {
    console.log(`⏳ [Ollama Docker Stream] Starting pull for model "${modelName}"...`);
    const stream = new Readable({ read() {} });
    const command = 'docker';
    const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', OLLAMA_SERVICE_NAME, 'ollama', 'pull', modelName];
    let pullProcess: ChildProcess | null = null;

    try {
        pullProcess = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        stream.push(`{"status": "Starting pull for ${modelName}..."}\n`);

        // Corrected Event Handlers
        pullProcess.stdout?.on('data', (data: Buffer | string) => { // Expect Buffer or string
            const output = data.toString(); // Ensure it's a string
            output.split('\n').forEach(line => {
                if (line.trim()) { stream.push(line + '\n'); }
            });
        });

        pullProcess.stderr?.on('data', (data: Buffer | string) => { // Expect Buffer or string
            const errorOutput = data.toString(); // Ensure it's a string
            errorOutput.split('\n').forEach(line => {
                if (line.trim()) { stream.push(`stderr: ${line}\n`); }
            });
        });

        pullProcess.on('error', (err: Error) => { // Expect Error object
            console.error(`❌ [Stream] Failed to start pull process for ${modelName}:`, err);
            stream.push(`{"error": "Failed to start docker compose process: ${err.message}"}\n`);
            stream.push(null);
        });

        pullProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => { // Expect code and signal
            if (code === 0) {
                console.log(`✅ [Stream] Pull process for "${modelName}" finished successfully.`);
                stream.push(`{"status": "completed", "message": "Model pull finished."}\n`);
            } else {
                console.error(`❌ [Stream] Pull process for "${modelName}" exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`);
                stream.push(`{"status": "failed", "message": "Pull process exited with code ${code ?? 'null'}."}\n`);
            }
            stream.push(null);
        });

    } catch (error: any) {
        console.error(`❌ [Stream] Error setting up pull process for ${modelName}:`, error);
        stream.push(`{"error": "Error setting up pull process: ${error.message}"}\n`);
        stream.push(null);
    }
    stream.on('close', () => {
         console.log(`[Stream] Readable stream for pulling ${modelName} closed.`);
         if (pullProcess && !pullProcess.killed) {
             console.log(`[Stream] Attempting to terminate pull process ${pullProcess.pid}...`);
             pullProcess.kill('SIGTERM'); // Try graceful termination first
             setTimeout(() => {
                 if (pullProcess && !pullProcess.killed) {
                     console.warn(`[Stream] Pull process ${pullProcess.pid} did not terminate, forcing kill.`);
                     pullProcess.kill('SIGKILL');
                 }
             }, 2000); // Force kill after 2 seconds
         }
    });
    return stream;
}

/** Ensures the Ollama service is running */
export async function ensureOllamaRunning(): Promise<void> {
    console.log("🐳 [Ollama Docker] Checking Ollama Docker status...");
    const running = await isOllamaContainerRunning();
    if (running) {
        console.log("✅ [Ollama Docker] Ollama container is already running.");
    } else {
        console.log("🅾️ [Ollama Docker] Ollama container not running. Attempting to start...");
        await startOllamaService(); // Uses compose
    }
}

/** Stops the Ollama service using Dockerode */
export async function stopOllamaService(): Promise<void> {
    if (!docker) {
        console.warn('[Ollama Docker Manager] Docker client unavailable, cannot stop Ollama.');
        return;
    }
    console.log(`[Ollama Docker Manager] Attempting to stop container '${OLLAMA_CONTAINER_NAME}'...`);
    try {
        const container = await findOllamaContainer();
        if (container) {
            try {
                console.log(`[Ollama Docker Manager] Stopping container '${OLLAMA_CONTAINER_NAME}' (ID: ${container.id})...`);
                await container.stop();
                console.log(`✅ [Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' stopped.`);
                 // Remove container after stop?
                 // console.log(`[Ollama Docker Manager] Removing container '${OLLAMA_CONTAINER_NAME}'...`);
                 // await container.remove();
                 // console.log(`✅ [Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' removed.`);
            } catch (stopError: any) {
                if (stopError.statusCode === 304) { console.log(`[Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' already stopped.`); }
                else if (stopError.statusCode === 404) { console.log(`[Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' not found (already removed?).`); }
                else { console.error(`[Ollama Docker Manager] Error stopping container '${OLLAMA_CONTAINER_NAME}':`, stopError); }
            }
        } else {
            console.log(`[Ollama Docker Manager] Container '${OLLAMA_CONTAINER_NAME}' not found, cannot stop.`);
        }
    } catch (error) {
        console.error(`[Ollama Docker Manager] General error stopping Ollama service:`, error);
    }
}
