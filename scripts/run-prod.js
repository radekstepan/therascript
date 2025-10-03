// scripts/run-prod.js
const { spawn } = require('child_process');
const { exec } = require('node:child_process');
const util = require('node:util');
const http = require('node:http'); // For the shutdown service

const execPromise = util.promisify(exec);

// Docker Container Names (must match your docker-compose files)
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed';
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service';
const ELASTICSEARCH_CONTAINER_NAME = 'therascript_elasticsearch_service';
const REDIS_CONTAINER_NAME = 'therascript_redis_service';

// --- UI Port for Cleanup ---
// Read CORS_ORIGIN from environment. If not set, default (less ideal but provides a fallback).
const UI_ORIGIN_FROM_ENV = process.env.CORS_ORIGIN || 'http://localhost:3002';
let UI_PORT;
try {
  UI_PORT = new URL(UI_ORIGIN_FROM_ENV).port || 3002;
} catch (e) {
  console.warn(
    `[RunProd] Could not parse CORS_ORIGIN "${UI_ORIGIN_FROM_ENV}" for port. Defaulting UI_PORT to 3002.`
  );
  UI_PORT = 3002;
}
console.log(
  `[RunProd] Using UI_ORIGIN: ${UI_ORIGIN_FROM_ENV} and derived UI_PORT: ${UI_PORT} for cleanup/CORS.`
);
// --- End UI Port ---

// --- Shutdown Service Configuration ---
const SHUTDOWN_PORT = 9999;
let shutdownHttpServer = null; // To store the server instance
// --- End Shutdown Service Configuration ---

console.log('[RunProd] Starting production-like environment...');

async function stopAndRemoveContainer(containerName) {
  console.log(
    `[RunProd Cleanup] Attempting to stop and remove container: ${containerName}...`
  );
  try {
    console.log(
      `[RunProd Cleanup] Sending stop command to ${containerName}...`
    );
    await execPromise(`docker stop -t 5 ${containerName}`);
    console.log(`[RunProd Cleanup] Container ${containerName} stopped.`);
  } catch (error) {
    const errMsg =
      error.stderr?.toLowerCase() || error.message?.toLowerCase() || '';
    if (
      errMsg.includes('no such container') ||
      errMsg.includes('is not running')
    ) {
      console.log(
        `[RunProd Cleanup] Container ${containerName} was not running or already stopped.`
      );
    } else {
      console.error(
        `[RunProd Cleanup] Failed to stop container ${containerName}:`,
        error.stderr || error.message
      );
    }
  }
  try {
    console.log(`[RunProd Cleanup] Removing container ${containerName}...`);
    await execPromise(`docker rm ${containerName}`);
    console.log(`[RunProd Cleanup] Container ${containerName} removed.`);
  } catch (error) {
    const errMsg =
      error.stderr?.toLowerCase() || error.message?.toLowerCase() || '';
    if (errMsg.includes('no such container')) {
      console.log(
        `[RunProd Cleanup] Container ${containerName} already removed or never existed.`
      );
    } else {
      console.error(
        `[RunProd Cleanup] Error removing ${containerName}:`,
        error.stderr || error.message
      );
    }
  }
}

async function cleanupDocker() {
  console.log('[RunProd Cleanup] Running Docker container cleanup...');
  await Promise.allSettled([
    stopAndRemoveContainer(OLLAMA_CONTAINER_NAME),
    stopAndRemoveContainer(WHISPER_CONTAINER_NAME),
    stopAndRemoveContainer(ELASTICSEARCH_CONTAINER_NAME),
    stopAndRemoveContainer(REDIS_CONTAINER_NAME),
  ]);
  console.log('[RunProd Cleanup] Docker cleanup process finished.');
}

// --- UI Process Cleanup Function (Improved) ---
async function cleanupUiProcess(port) {
  console.log(
    `[RunProd Cleanup] Attempting to stop UI process on port ${port}...`
  );
  try {
    if (process.platform === 'win32') {
      console.warn(
        `[RunProd Cleanup] Automatic UI process cleanup on port ${port} for Windows is not fully implemented. Please manually stop if needed.`
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
          `[RunProd Cleanup] No process found by lsof on port ${port}. Assuming stopped.`
        );
        return;
      }

      if (pidsToKill) {
        const killCmd = `kill -9 ${pidsToKill.split('\n').join(' ')}`;
        console.log(
          `[RunProd Cleanup] Found PIDs ${pidsToKill.replace('\n', ' ')} for port ${port}. Executing: ${killCmd}`
        );
        await execPromise(killCmd);
        console.log(
          `[RunProd Cleanup] UI process(es) on port ${port} terminated.`
        );
      } else {
        console.log(
          `[RunProd Cleanup] No UI process found listening on port ${port}.`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[RunProd Cleanup] Error trying to stop UI process on port ${port}: ${error.message}`
    );
  }
}
// --- End UI Process Cleanup Function ---

// Arguments for concurrently
const concurrentlyArgs = [
  'concurrently',
  '--kill-others-on-fail',
  '--names',
  'API,UI,WORKER,WHISPER,ES',
  '--prefix-colors',
  'bgGreen.bold,bgMagenta.bold,bgYellow.bold,bgCyan.bold,bgBlue.bold',
  '"yarn start:api:prod"',
  '"yarn dev:ui"', // Typically for prod you'd serve static UI assets, but dev:ui is fine for this setup
  '"yarn start:worker:prod"',
  '"yarn start:whisper"',
  '"yarn start:elasticsearch-manager"',
];

let appProcess;
let isShuttingDown = false;

async function main() {
  console.log('[RunProd] Ensuring Redis service is running...');
  try {
    await execPromise('docker compose up -d --wait redis');
    console.log('[RunProd] ✅ Redis service is up and healthy.');
  } catch (error) {
    console.error(
      '[RunProd] ❌ Failed to start Redis container. Aborting.',
      error
    );
    process.exit(1);
  }

  appProcess = spawn(concurrentlyArgs[0], concurrentlyArgs.slice(1), {
    stdio: 'inherit',
    shell: true,
    detached: process.platform !== 'win32',
  });

  appProcess.on('spawn', () => {
    console.log(
      '[RunProd] Concurrently process for production-like start spawned successfully.'
    );
  });

  appProcess.on('error', (error) => {
    console.error('[RunProd] Error spawning concurrently:', error);
    cleanupDocker()
      .then(() => cleanupUiProcess(UI_PORT))
      .finally(() => process.exit(1));
  });

  appProcess.on('close', (code, signal) => {
    console.log(
      `[RunProd] Concurrently process exited with code ${code}, signal ${signal}.`
    );
    if (!isShuttingDown) {
      console.log(
        '[RunProd] Concurrently closed unexpectedly, running cleanup...'
      );
      cleanupDocker()
        .then(() => cleanupUiProcess(UI_PORT))
        .finally(() => {
          process.exit(code ?? 1);
        });
    }
  });

  if (appProcess && !appProcess.killed) {
    shutdownHttpServer = createShutdownService(handleShutdown);
  } else {
    console.warn(
      '[RunProd] Concurrently process failed to start or exited prematurely. Shutdown service not started.'
    );
  }
}

async function handleShutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[RunProd] Received ${reason}. Initiating shutdown...`);

  if (shutdownHttpServer) {
    console.log('[RunProd] Closing shutdown HTTP service...');
    await new Promise((resolve) => shutdownHttpServer.close(resolve));
    console.log('[RunProd] Shutdown HTTP service closed.');
    shutdownHttpServer = null;
  }

  console.log('[RunProd] Terminating concurrently process and its group...');
  if (appProcess && !appProcess.killed) {
    try {
      if (process.platform === 'win32') {
        await execPromise(`taskkill /PID ${appProcess.pid} /T /F`);
        console.log(
          `[RunProd] Sent taskkill to concurrently process (PID: ${appProcess.pid}) and its children.`
        );
      } else {
        process.kill(-appProcess.pid, 'SIGKILL');
        console.log(
          `[RunProd] Kill signal sent to concurrently process group (PGID: ${appProcess.pid}).`
        );
      }
    } catch (killError) {
      console.warn(
        `[RunProd] Error sending kill signal to concurrently process/group: ${killError.message}`
      );
      if (!appProcess.killed) appProcess.kill('SIGKILL');
    }
  } else {
    console.log(
      '[RunProd] Concurrently process already exited or not running.'
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await cleanupDocker();
  await cleanupUiProcess(UI_PORT);

  console.log('[RunProd] Shutdown complete. Exiting wrapper script.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// --- Shutdown Service (with CORS from env) ---
function createShutdownService(shutdownHandlerCallback) {
  const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', UI_ORIGIN_FROM_ENV); // Use value from environment
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/shutdown') {
      console.log(
        `[RunProd ShutdownService] Received /shutdown request. Initiating shutdown...`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: 'Shutdown initiated via API for prod server',
        })
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
      `[RunProd ShutdownService] Listening on http://localhost:${SHUTDOWN_PORT}/shutdown (allowing origin: ${UI_ORIGIN_FROM_ENV})`
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[RunProd ShutdownService] Port ${SHUTDOWN_PORT} is already in use.`
      );
    } else {
      console.error('[RunProd ShutdownService] Error:', err);
    }
  });
  return server;
}

main().catch((err) => {
  console.error('[RunProd] A critical error occurred in main():', err);
  process.exit(1);
});
