import { exec as callbackExec, spawn, ChildProcess } from 'child_process'; // Keep spawn for pull stream
import * as util from 'util';
import * as path from 'path';
import { Readable } from 'stream'; // Keep Readable for pull stream
import Dockerode from 'dockerode'; // Keep Dockerode for direct stop
import * as fs from 'fs'; // Added fs import
import { ensureServiceReady, stopContainer } from '@therascript/docker-utils';

const exec = util.promisify(callbackExec);

// --- Configuration ---
const COMPOSE_FILE = path.resolve(__dirname, '..', 'docker-compose.yml');
export const OLLAMA_SERVICE_NAME = 'ollama';
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed'; // Exact name from docker-compose.yml
const OLLAMA_HEALTH_URL = 'http://localhost:11434'; // Assuming default port mapping

// --- Dockerode Initialization ---
let docker: Dockerode | null = null;
try {
  docker = new Dockerode();
  console.log('[Ollama Docker Manager] Connected to Docker daemon.');
} catch (error) {
  console.error(
    '[Ollama Docker Manager] Failed to connect to Docker daemon:',
    error
  );
}

// --- Helper: Run docker compose exec (Kept for model checks/pulls) ---
async function runDockerComposeExec(command: string): Promise<string> {
  if (!fs.existsSync(COMPOSE_FILE)) {
    const errorMessage = `[Ollama Docker] Docker Compose file not found at expected path: ${COMPOSE_FILE}. Cannot manage service.`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  // Note: compose V2 uses 'exec -T' for non-interactive
  // Allow an optional extra compose override file to be supplied via env var.
  const extraCompose = process.env.DOCKER_COMPOSE_EXTRA;
  const extraFlag =
    extraCompose && fs.existsSync(extraCompose) ? ` -f "${extraCompose}"` : '';
  const composeCommand = `docker compose -f "${COMPOSE_FILE}"${extraFlag} exec -T ${OLLAMA_SERVICE_NAME} ${command}`;
  console.log(`[Ollama Docker Exec] Running: ${composeCommand}`);
  try {
    const { stdout, stderr } = await exec(composeCommand);
    if (stderr && !stderr.toLowerCase().includes('warn')) {
      console.warn(`[Ollama Docker Exec] Compose stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: any) {
    console.error(`[Ollama Docker Exec] Error executing: ${composeCommand}`);
    if (error.stderr)
      console.error(`[Ollama Docker Exec] Stderr: ${error.stderr}`);
    if (error.stdout)
      console.error(`[Ollama Docker Exec] Stdout: ${error.stdout}`);
    throw new Error(
      `Failed to run 'docker compose exec ${command}'. Is the container running? Error: ${error.message}`
    );
  }
}
// --- End Helper ---

// --- Checks if the specified model is available in Ollama (Kept using docker compose exec) ---
export async function isModelPulled(modelName: string): Promise<boolean> {
  console.log(
    `🔍 [Ollama Docker] Checking if model "${modelName}" is pulled...`
  );
  try {
    const output = await runDockerComposeExec('ollama list');
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
    console.error(
      `❌ [Ollama Docker] Error checking for model "${modelName}" via compose exec. Is the container running correctly?`,
      error.message
    );
    // Optional: Could check container running state here, but shared ensureServiceReady should handle it upstream
    return false;
  }
}

// --- Pulls the specified model using Docker Compose (Kept using spawn for streaming) ---
export function pullModelStream(modelName: string): Readable {
  console.log(
    `⏳ [Ollama Docker Stream] Starting pull for model "${modelName}"...`
  );
  const stream = new Readable({ read() {} });
  const command = 'docker';
  const args = [
    'compose',
    '-f',
    COMPOSE_FILE,
    'exec',
    // '-T', // Might need to remove -T if exec needs a pseudo-tty for progress bars
    OLLAMA_SERVICE_NAME,
    'ollama',
    'pull',
    modelName,
  ];
  let pullProcess: ChildProcess | null = null;

  try {
    pullProcess = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    stream.push(`{"status": "Starting pull for ${modelName}..."}\n`);

    pullProcess.stdout?.on('data', (data: Buffer | string) => {
      const output = data.toString();
      output.split('\n').forEach((line) => {
        if (line.trim()) {
          stream.push(line + '\n');
        }
      });
    });

    pullProcess.stderr?.on('data', (data: Buffer | string) => {
      const errorOutput = data.toString();
      errorOutput.split('\n').forEach((line) => {
        if (line.trim()) {
          // Check stderr for common errors that might indicate completion/failure
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('error pulling manifest')) {
            stream.push(
              `{"status": "failed", "message": "Error pulling manifest: ${line.trim()}"}\n`
            );
          } else if (lowerLine.includes('pulling')) {
            // Treat stderr "pulling" messages as progress/status
            stream.push(
              `{"status": "progress", "message": "${line.trim()}"}\n`
            );
          } else {
            stream.push(`stderr: ${line}\n`); // Pass other stderr through
          }
        }
      });
    });

    pullProcess.on('error', (err: Error) => {
      console.error(
        `❌ [Stream] Failed to start pull process for ${modelName}:`,
        err
      );
      stream.push(
        `{"error": "Failed to start docker compose process: ${err.message}"}\n`
      );
      stream.push(null);
    });

    pullProcess.on(
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          console.log(
            `✅ [Stream] Pull process for "${modelName}" finished successfully.`
          );
          stream.push(
            `{"status": "completed", "message": "Model pull finished."}\n`
          );
        } else {
          console.error(
            `❌ [Stream] Pull process for "${modelName}" exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`
          );
          stream.push(
            `{"status": "failed", "message": "Pull process exited with code ${code ?? 'null'}."}\n`
          );
        }
        stream.push(null);
      }
    );
  } catch (error: any) {
    console.error(
      `❌ [Stream] Error setting up pull process for ${modelName}:`,
      error
    );
    stream.push(
      `{"error": "Error setting up pull process: ${error.message}"}\n`
    );
    stream.push(null);
  }
  stream.on('close', () => {
    console.log(`[Stream] Readable stream for pulling ${modelName} closed.`);
    if (pullProcess && !pullProcess.killed) {
      console.log(
        `[Stream] Attempting to terminate pull process ${pullProcess.pid}...`
      );
      pullProcess.kill('SIGTERM');
      setTimeout(() => {
        if (pullProcess && !pullProcess.killed) {
          pullProcess.kill('SIGKILL');
        }
      }, 2000);
    }
  });
  return stream;
}

// --- Ensures the Ollama service is running using shared utility ---
export async function ensureOllamaRunning(): Promise<void> {
  if (!docker) {
    throw new Error(
      'Docker client not initialized. Cannot ensure Ollama running.'
    );
  }
  // Project name derived from compose file location (adjust if needed)
  const projectName = path.basename(path.dirname(COMPOSE_FILE));
  await ensureServiceReady({
    docker,
    containerName: OLLAMA_CONTAINER_NAME,
    serviceName: OLLAMA_SERVICE_NAME,
    composeFilePath: COMPOSE_FILE,
    projectName: projectName,
    healthCheck: {
      type: 'http', // Ollama has an API endpoint we can hit
      url: OLLAMA_HEALTH_URL, // Check base URL
      retries: 10, // Increase retries as Ollama can take time
      delayMs: 4000, // Slightly longer delay
      timeoutMs: 3000,
    },
  });
}

// --- Stops the Ollama service using shared utility ---
export async function stopOllamaService(): Promise<void> {
  if (!docker) {
    console.warn(
      '[Ollama Docker Manager] Docker client unavailable, cannot stop Ollama.'
    );
    return;
  }
  await stopContainer(docker, OLLAMA_CONTAINER_NAME);
}
