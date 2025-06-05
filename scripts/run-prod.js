// scripts/run-prod.js
const { spawn } = require('child_process');
const { exec } = require('node:child_process');
const util = require('node:util');

const execPromise = util.promisify(exec);

// Docker Container Names (must match your docker-compose files)
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed';
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service';

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
  ]);
  console.log('[RunProd Cleanup] Docker cleanup process finished.');
}

// Arguments for concurrently
const concurrentlyArgs = [
  'concurrently',
  '--kill-others-on-fail',
  '--names',
  'API,UI,WHISPER',
  '--prefix-colors',
  'bgGreen.bold,bgMagenta.bold,bgCyan.bold', // API color green for prod-like

  // Commands to run:
  '"yarn start:api:prod"', // <-- Uses the production API start script
  '"yarn dev:ui"', // UI still runs in dev mode for local testing
  '"yarn start:whisper"', // Starts the real Whisper service
];

const appProcess = spawn(concurrentlyArgs[0], concurrentlyArgs.slice(1), {
  stdio: 'inherit', // Pass through stdio
  shell: true, // Use shell for better cross-platform compatibility
});

appProcess.on('spawn', () => {
  console.log(
    '[RunProd] Concurrently process for production-like start spawned successfully.'
  );
});

appProcess.on('error', (error) => {
  console.error('[RunProd] Error spawning concurrently:', error);
  cleanupDocker().finally(() => process.exit(1));
});

let isShuttingDown = false;
appProcess.on('close', (code, signal) => {
  console.log(
    `[RunProd] Concurrently process exited with code ${code}, signal ${signal}.`
  );
  if (!isShuttingDown) {
    console.log(
      '[RunProd] Concurrently closed unexpectedly, running cleanup...'
    );
    cleanupDocker().finally(() => {
      process.exit(code ?? 1);
    });
  }
});

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[RunProd] Received ${signal}. Initiating shutdown...`);

  console.log('[RunProd] Terminating concurrently process...');
  if (appProcess && !appProcess.killed) {
    const killed = appProcess.kill('SIGKILL'); // Use SIGKILL for more forceful termination
    console.log(
      `[RunProd] Kill signal sent to concurrently process (PID: ${appProcess.pid}). Success: ${killed}`
    );
  } else {
    console.log(
      '[RunProd] Concurrently process already exited or not running.'
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1500)); // Brief wait

  await cleanupDocker();

  console.log('[RunProd] Shutdown complete. Exiting wrapper script.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => handleShutdown('SIGTERM')); // kill command
