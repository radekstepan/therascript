// packages/ollama/src/dockerManager.ts
import { exec as callbackExec, spawn, ChildProcess } from 'child_process'; // Import spawn
import * as util from 'util';
import * as path from 'path';
import { Readable } from 'stream'; // Import Readable

const exec = util.promisify(callbackExec);

const COMPOSE_FILE = path.resolve(__dirname, '..', 'docker-compose.yml');
export const OLLAMA_SERVICE_NAME = 'ollama';

/** Helper to run docker compose commands */
async function runDockerComposeCommand(command: string): Promise<string> {
    try {
        const { stdout, stderr } = await exec(`docker compose -f "${COMPOSE_FILE}" ${command}`);
        if (stderr && !stderr.toLowerCase().includes("warn")) { // Ignore docker compose warnings
             console.warn(`Docker Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`Error executing Docker Compose command: ${command}`);
        if (error.stderr) {
            console.error(`Stderr: ${error.stderr}`);
        }
        if (error.stdout) {
            console.error(`Stdout: ${error.stdout}`);
        }
        if (error.message) {
             console.error(`Error message: ${error.message}`);
        }
        throw new Error(`Failed to run 'docker compose ${command}'. Is Docker running and compose file correct?`);
    }
}

/** Checks if the Ollama container is running */
async function isOllamaContainerRunning(): Promise<boolean> {
    try {
        const containerId = await runDockerComposeCommand(`ps -q ${OLLAMA_SERVICE_NAME}`);
        if (!containerId) {
            return false;
        }
        const { stdout: statusOutput } = await exec(`docker inspect --format='{{.State.Status}}' ${containerId}`);
        const status = statusOutput.trim();
        return status === 'running';
    } catch (error: any) {
        return false;
    }
}

/** Starts the Ollama service using Docker Compose */
async function startOllamaService(): Promise<void> {
    console.log("🐳 Starting Ollama service...");
    try {
        await runDockerComposeCommand(`up -d ${OLLAMA_SERVICE_NAME}`);
        console.log("⏳ Waiting for Ollama service to potentially initialize (approx 15s)...");
        await new Promise(resolve => setTimeout(resolve, 15000));
        console.log("✅ Ollama service should be starting up.");
    } catch (error) {
         console.error("❌ Failed to start Ollama service.");
        throw error;
    }
}

/** Checks if the specified model is available in Ollama */
export async function isModelPulled(modelName: string): Promise<boolean> {
     console.log(`🔍 Checking if model "${modelName}" is pulled...`);
    try {
        const output = await runDockerComposeCommand(`exec ${OLLAMA_SERVICE_NAME} ollama list`);
        const lines = output.split('\n').slice(1); // Skip header line
        for (const line of lines) {
            const nameParts = line.trim().split(/\s+/);
            if (nameParts.length > 0) {
                const listedName = nameParts[0];
                if (listedName.startsWith(modelName)) {
                     console.log(`✅ Model "${modelName}" found locally.`);
                    return true;
                }
            }
        }
        console.log(`🔻 Model "${modelName}" not found locally.`);
        return false;
    } catch (error: any) {
        console.error(`❌ Error checking for model "${modelName}". Is the Ollama container running correctly?`);
        return false;
    }
}

/**
 * Pulls the specified model using Docker Compose and returns a stream of progress updates.
 * @param modelName The name of the model to pull.
 * @returns A Readable stream that yields progress update strings.
 */
export function pullModelStream(modelName: string): Readable {
    console.log(`⏳ [Stream] Starting pull for model "${modelName}"...`);
    const stream = new Readable({ read() {} }); // Create a push-based Readable stream

    // --- Use spawn instead of exec ---
    const command = 'docker';
    const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', OLLAMA_SERVICE_NAME, 'ollama', 'pull', modelName];
    // '-T' disables pseudo-tty allocation, which is better for non-interactive exec

    let pullProcess: ChildProcess | null = null;

    try {
        pullProcess = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
        });

        stream.push(`{"status": "Starting pull for ${modelName}..."}\n`);

        pullProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString('utf-8');
            // Push raw output lines for the service layer to parse
            output.split('\n').forEach(line => {
                if (line.trim()) {
                    stream.push(line + '\n');
                }
            });
        });

        pullProcess.stderr?.on('data', (data: Buffer) => {
            const errorOutput = data.toString('utf-8');
             // Push raw error lines too, prefix them for easier parsing?
             errorOutput.split('\n').forEach(line => {
                 if (line.trim()) {
                    stream.push(`stderr: ${line}\n`);
                 }
            });
        });

        pullProcess.on('error', (err) => {
            console.error(`❌ [Stream] Failed to start pull process for ${modelName}:`, err);
            stream.push(`{"error": "Failed to start docker compose process: ${err.message}"}\n`);
            stream.push(null); // End the stream on error
        });

        pullProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ [Stream] Pull process for "${modelName}" finished successfully.`);
                stream.push(`{"status": "completed", "message": "Model pull finished."}\n`);
            } else {
                console.error(`❌ [Stream] Pull process for "${modelName}" exited with code ${code}.`);
                 // Don't push an error object here if stderr already pushed details
                 // Just signal completion, the consumer should check the log for errors
                stream.push(`{"status": "failed", "message": "Pull process exited with code ${code}."}\n`);
            }
            stream.push(null); // End the stream
        });

    } catch (error: any) {
        console.error(`❌ [Stream] Error setting up pull process for ${modelName}:`, error);
        // Push an error message into the stream before ending it
        stream.push(`{"error": "Error setting up pull process: ${error.message}"}\n`);
        stream.push(null); // End the stream immediately on setup error
    }

    // Handle stream destruction (e.g., client disconnects)
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
// --- End Stream Function ---

/** Ensures the Ollama service is running */
export async function ensureOllamaRunning(): Promise<void> {
    console.log("🐳 Checking Ollama Docker status...");
    const running = await isOllamaContainerRunning();
    if (running) {
        console.log("✅ Ollama container is already running.");
    } else {
        console.log("🅾️ Ollama container not running. Attempting to start...");
        await startOllamaService();
    }
}

/** Stops the Ollama service */
export async function stopOllamaService(): Promise<void> {
    console.log("🐳 Stopping Ollama service...");
    try {
        await runDockerComposeCommand(`down`);
        console.log("✅ Ollama service stopped.");
    } catch (error) {
         console.error("❌ Failed to stop Ollama service. You may need to stop it manually.");
         console.error("   Try: docker compose down");
    }
}
