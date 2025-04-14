import { exec as callbackExec } from 'child_process';
import * as util from 'util';
import * as path from 'path';

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

/** Pulls the specified model using Docker Compose */
export async function pullModel(modelName: string): Promise<void> {
    console.log(`⏳ Pulling model "${modelName}"... This may take a while.`);
    try {
        const { stdout, stderr } = await exec(`docker compose -f "${COMPOSE_FILE}" exec ${OLLAMA_SERVICE_NAME} ollama pull ${modelName}`);
        console.log("--- Ollama Pull Output ---");
        console.log(stdout || "(No stdout)");
        if(stderr) console.warn("Stderr:", stderr);
        console.log("------------------------");
        console.log(`✅ Successfully pulled model "${modelName}" (or it was already up to date).`);
    } catch (error: any) {
        console.error(`❌ Failed to pull model "${modelName}".`);
        if (error.stderr) console.error(`Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`Stdout: ${error.stdout}`);
        throw new Error(`Failed to pull model ${modelName}`);
    }
}

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
