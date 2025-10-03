// Purpose: Starts the development environment for Therascript.
//          Uses `concurrently` to run the API, UI, and Whisper service manager scripts in parallel.
//          Also handles graceful shutdown by stopping related Docker containers.

const { spawn } = require('child_process'); // For running `concurrently`
const { exec } = require('node:child_process'); // For running docker commands and port killing
const util = require('node:util'); // For promisify
const http = require('node:http'); // For the shutdown service

// Promisify exec for async/await usage with docker commands
const execPromise = util.promisify(exec);

// --- Configuration: Docker Container Names ---
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed';
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service';
const ELASTICSEARCH_CONTAINER_NAME = 'therascript_elasticsearch_service';
const REDIS_CONTAINER_NAME = 'therascript_redis_service';
// --- End Configuration ---

// --- UI Port for Cleanup ---
// Read CORS_ORIGIN from environment. If not set, default (less ideal but provides a fallback).
const UI_ORIGIN_FROM_ENV = process.env.CORS_ORIGIN || 'http://localhost:3002';
let UI_PORT;
try {
  UI_PORT = new URL(UI_ORIGIN_FROM_ENV).port || 3002;
} catch (e) {
  console.warn(
    `[RunDev] Could not parse CORS_ORIGIN "${UI_ORIGIN_FROM_ENV}" for port. Defaulting UI_PORT to 3002.`
  );
  UI_PORT = 3002;
}
console.log(
  `[RunDev] Using UI_ORIGIN: ${UI_ORIGIN_FROM_ENV} and derived UI_PORT: ${UI_PORT} for cleanup/CORS.`
);
// --- End UI Port ---

// --- Shutdown Service Configuration ---
const SHUTDOWN_PORT = 9999;
let shutdownHttpServer = null;
// --- End Shutdown Service Configuration ---

console.log('[RunDev] Starting development environment...');

// --- Docker Cleanup Function ---
async function stopAndRemoveContainer(containerName) {
  console.log(
    `[RunDev Cleanup] Attempting to stop and remove container: ${containerName}...`
  );
  try {
    await execPromise(`docker stop -t 5 ${containerName}`);
    console.log(`[RunDev Cleanup] Container ${containerName} stopped.`);
  } catch (error) {
    const errMsg =
      error.stderr?.toLowerCase() || error.message?.toLowerCase() || '';
    if (
      errMsg.includes('no such container') ||
      errMsg.includes('is not running')
    ) {
      console.log(
        `[RunDev Cleanup] Container ${containerName} was not running or already stopped.`
      );
    } else {
      console.error(
        `[RunDev Cleanup] Failed to stop container ${containerName}:`,
        error.stderr || error.message
      );
    }
  }
  try {
    await execPromise(`docker rm ${containerName}`);
    console.log(`[RunDev Cleanup] Container ${containerName} removed.`);
  } catch (error) {
    const errMsg =
      error.stderr?.toLowerCase() || error.message?.toLowerCase() || '';
    if (errMsg.includes('no such container')) {
      console.log(
        `[RunDev Cleanup] Container ${containerName} already removed or never existed.`
      );
    } else {
      console.error(
        `[RunDev Cleanup] Error removing ${containerName}:`,
        error.stderr || error.message
      );
    }
  }
}

async function cleanupDocker() {
  console.log('[RunDev Cleanup] Running Docker container cleanup...');
  await Promise.allSettled([
    stopAndRemoveContainer(OLLAMA_CONTAINER_NAME),
    stopAndRemoveContainer(WHISPER_CONTAINER_NAME),
    stopAndRemoveContainer(ELASTICSEARCH_CONTAINER_NAME),
    stopAndRemoveContainer(REDIS_CONTAINER_NAME),
  ]);
  console.log('[RunDev Cleanup] Docker cleanup process finished.');
}
// --- End Docker Cleanup Function ---

// --- UI Process Cleanup Function (Improved) ---
async function cleanupUiProcess(port) {
  console.log(
    `[RunDev Cleanup] Attempting to stop UI process on port ${port}...`
  );
  try {
    if (process.platform === 'win32') {
      console.warn(
        `[RunDev Cleanup] Automatic UI process cleanup on port ${port} for Windows is not fully implemented. Please manually stop if needed.`
      );
      return;
    } else {
      // For Linux/macOS
      const findPidCmd = `lsof -ti tcp:${port}`;
      let pidsToKill = '';
      try {
        const { stdout } = await execPromise(findPidCmd);
        pidsToKill = stdout.trim();
      } catch (lsofError) {
        console.log(
          `[RunDev Cleanup] No process found by lsof on port ${port}. Assuming stopped.`
        );
        return;
      }

      if (pidsToKill) {
        const killCmd = `kill -9 ${pidsToKill.split('\n').join(' ')}`;
        console.log(
          `[RunDev Cleanup] Found PIDs ${pidsToKill.replace('\n', ' ')} for port ${port}. Executing: ${killCmd}`
        );
        await execPromise(killCmd);
        console.log(
          `[RunDev Cleanup] UI process(es) on port ${port} terminated.`
        );
      } else {
        console.log(
          `[RunDev Cleanup] No UI process found listening on port ${port}.`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[RunDev Cleanup] Error trying to stop UI process on port ${port}: ${error.message}`
    );
  }
}
// --- End UI Process Cleanup Function ---

// --- Concurrently Command Setup ---
const concurrentlyArgs = [
  'concurrently',
  '--kill-others-on-fail',
  '--names',
  'API,UI,WORKER,WHISPER,ES', // Added WORKER
  '--prefix-colors',
  'bgBlue.bold,bgMagenta.bold,bgYellow.bold,bgCyan.bold,bgGreen.bold', // Added color for WORKER
  '"yarn dev:api"',
  '"yarn dev:ui"',
  '"yarn dev:worker"', // Added WORKER
  '"yarn start:whisper"',
  '"yarn start:elasticsearch-manager"',
];
// --- End Concurrently Command Setup ---

// --- Main Execution Block ---
let devProcess; // To hold the concurrently process
let isShuttingDown = false;

async function main() {
  console.log('[RunDev] Ensuring Redis service is running...');
  try {
    // Start Redis and wait for its health check to pass before proceeding.
    await execPromise('docker compose up -d --wait redis');
    console.log('[RunDev] ✅ Redis service is up and healthy.');
  } catch (error) {
    console.error(
      '[RunDev] ❌ Failed to start Redis container. Aborting.',
      error
    );
    process.exit(1);
  }

  // --- Spawn Concurrently Process ---
  devProcess = spawn(concurrentlyArgs[0], concurrentlyArgs.slice(1), {
    stdio: 'inherit',
    shell: true,
    detached: process.platform !== 'win32',
  });

  // --- Process Event Handling ---
  devProcess.on('spawn', () => {
    console.log('[RunDev] Concurrently process spawned successfully.');
  });

  devProcess.on('error', (error) => {
    console.error('[RunDev] Error spawning concurrently:', error);
    cleanupDocker()
      .then(() => cleanupUiProcess(UI_PORT))
      .finally(() => process.exit(1));
  });

  devProcess.on('close', (code, signal) => {
    console.log(
      `[RunDev] Concurrently process exited with code ${code}, signal ${signal}.`
    );
    if (!isShuttingDown) {
      console.log(
        '[RunDev] Concurrently closed unexpectedly, running cleanup...'
      );
      cleanupDocker()
        .then(() => cleanupUiProcess(UI_PORT))
        .finally(() => {
          process.exit(code ?? 1);
        });
    }
  });

  // --- Start Shutdown Service ---
  if (devProcess && !devProcess.killed) {
    shutdownHttpServer = createShutdownService(handleShutdown);
  } else {
    console.warn(
      '[RunDev] Concurrently process failed to start. Shutdown service not started.'
    );
  }
}

// --- Graceful Shutdown Handling ---
async function handleShutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[RunDev] Received ${reason}. Initiating shutdown...`);

  if (shutdownHttpServer) {
    console.log('[RunDev] Closing shutdown HTTP service...');
    await new Promise((resolve) => shutdownHttpServer.close(resolve));
    console.log('[RunDev] Shutdown HTTP service closed.');
    shutdownHttpServer = null;
  }

  console.log('[RunDev] Terminating concurrently process and its group...');
  if (devProcess && !devProcess.killed) {
    try {
      if (process.platform === 'win32') {
        await execPromise(`taskkill /PID ${devProcess.pid} /T /F`);
        console.log(
          `[RunDev] Sent taskkill to concurrently process (PID: ${devProcess.pid}) and its children.`
        );
      } else {
        process.kill(-devProcess.pid, 'SIGKILL');
        console.log(
          `[RunDev] Kill signal sent to concurrently process group (PGID: ${devProcess.pid}).`
        );
      }
    } catch (killError) {
      console.warn(
        `[RunDev] Error sending kill signal to concurrently process/group: ${killError.message}`
      );
      if (!devProcess.killed) devProcess.kill('SIGKILL');
    }
  } else {
    console.log('[RunDev] Concurrently process already exited or not running.');
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await cleanupDocker();
  await cleanupUiProcess(UI_PORT);

  console.log('[RunDev] Shutdown complete. Exiting wrapper script.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
// --- End Graceful Shutdown Handling ---

// --- Shutdown Service (with CORS from env) ---
function createShutdownService(shutdownHandlerCallback) {
  const server = http.createServer((req, res) => {
    // Set CORS headers for all responses from this server
    res.setHeader('Access-Control-Allow-Origin', UI_ORIGIN_FROM_ENV); // Use value from environment
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      // Handle preflight request
      res.writeHead(204); // No Content
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/shutdown') {
      console.log(
        `[RunDev ShutdownService] Received /shutdown request. Initiating shutdown...`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ message: 'Shutdown initiated via API for dev server' })
      );
      setTimeout(() => {
        shutdownHandlerCallback('API_REQUEST');
      }, 100);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(SHUTDOWN_PORT, 'localhost', () => {
    console.log(
      `[RunDev ShutdownService] Listening on http://localhost:${SHUTDOWN_PORT}/shutdown (allowing origin: ${UI_ORIGIN_FROM_ENV})`
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[RunDev ShutdownService] Port ${SHUTDOWN_PORT} is already in use.`
      );
    } else {
      console.error('[RunDev ShutdownService] Error:', err);
    }
  });
  return server;
}

// Start the application
main().catch((err) => {
  console.error('[RunDev] A critical error occurred in main():', err);
  process.exit(1);
});
