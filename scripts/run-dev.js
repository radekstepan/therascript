// Purpose: Starts the development environment for Therascript.
//          Uses `concurrently` to run the API, UI, and Whisper service manager scripts in parallel.
//          Also handles graceful shutdown by stopping related Docker containers.

const { spawn } = require('child_process'); // For running `concurrently`
const { exec } = require('node:child_process'); // For running docker commands during cleanup
const util = require('node:util'); // For promisify

// Promisify exec for async/await usage with docker commands
const execPromise = util.promisify(exec);

// --- Configuration: Docker Container Names ---
// These names MUST match the `container_name` defined in the docker-compose files.
const OLLAMA_CONTAINER_NAME = 'ollama_server_managed'; // From packages/ollama/docker-compose.yml
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service'; // From root docker-compose.yml
// --- End Configuration ---

console.log('[RunDev] Starting development environment...');

// --- Docker Cleanup Function ---
/**
 * Attempts to gracefully stop and then remove a specified Docker container.
 * Handles common errors like the container not existing or already being stopped.
 *
 * @param {string} containerName - The name of the container to stop and remove.
 */
async function stopAndRemoveContainer(containerName) {
  console.log(
    `[RunDev Cleanup] Attempting to stop and remove container: ${containerName}...`
  );

  // 1. Attempt to stop the container
  try {
    console.log(`[RunDev Cleanup] Sending stop command to ${containerName}...`);
    // Use `docker stop` with a timeout (e.g., 5 seconds) for graceful shutdown
    await execPromise(`docker stop -t 5 ${containerName}`);
    console.log(`[RunDev Cleanup] Container ${containerName} stopped.`);
  } catch (error) {
    // Check stderr/message for common errors indicating the container is already stopped or gone
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
      // Log other errors but proceed to removal attempt
      console.error(
        `[RunDev Cleanup] Failed to stop container ${containerName}:`,
        error.stderr || error.message
      );
    }
  }

  // 2. Attempt to remove the container (whether stop succeeded or failed)
  try {
    console.log(`[RunDev Cleanup] Removing container ${containerName}...`);
    // Use `docker rm`
    await execPromise(`docker rm ${containerName}`);
    console.log(`[RunDev Cleanup] Container ${containerName} removed.`);
  } catch (error) {
    // Check stderr/message for common errors indicating the container is already removed
    const errMsg =
      error.stderr?.toLowerCase() || error.message?.toLowerCase() || '';
    if (errMsg.includes('no such container')) {
      console.log(
        `[RunDev Cleanup] Container ${containerName} already removed or never existed.`
      );
    } else {
      // Log other removal errors
      console.error(
        `[RunDev Cleanup] Error removing ${containerName}:`,
        error.stderr || error.message
      );
    }
  }
}

/**
 * Runs the cleanup process for all relevant Docker containers.
 * Calls `stopAndRemoveContainer` for each container.
 */
async function cleanupDocker() {
  console.log('[RunDev Cleanup] Running Docker container cleanup...');
  // Run cleanup tasks in parallel for speed
  await Promise.allSettled([
    stopAndRemoveContainer(OLLAMA_CONTAINER_NAME),
    stopAndRemoveContainer(WHISPER_CONTAINER_NAME),
  ]);
  console.log('[RunDev Cleanup] Docker cleanup process finished.');
}
// --- End Docker Cleanup Function ---

// --- Concurrently Command Setup ---
// Define the arguments for the `concurrently` command.
const concurrentlyArgs = [
  'concurrently', // The command itself
  '--kill-others-on-fail', // Attempt to kill other processes if one fails
  // '--handle-input', // Optionally handle input across processes (usually not needed here)
  '--names',
  'API,UI,WHISPER', // Names for prefixing output lines
  '--prefix-colors',
  'bgBlue.bold,bgMagenta.bold,bgCyan.bold', // Colors for prefixes

  // Commands to run concurrently. MUST be quoted correctly for the shell.
  // These correspond to scripts defined in the root package.json.
  '"yarn:dev:api"', // Starts the API server in dev mode (with watch)
  '"yarn:dev:ui"', // Starts the UI dev server (webpack serve)
  '"yarn:start:whisper"', // Starts the Whisper service manager script
];
// --- End Concurrently Command Setup ---

// --- Spawn Concurrently Process ---
// Spawn the `concurrently` command.
// Use `{ shell: true }` for better cross-platform compatibility (handles path resolution, quoting).
const devProcess = spawn(concurrentlyArgs[0], concurrentlyArgs.slice(1), {
  stdio: 'inherit', // Pass stdin, stdout, stderr directly to/from the parent process
  shell: true,
});
// --- End Spawn Concurrently Process ---

// --- Process Event Handling ---
devProcess.on('spawn', () => {
  // Logged when the `concurrently` process starts successfully.
  console.log('[RunDev] Concurrently process spawned successfully.');
});

devProcess.on('error', (error) => {
  // Log errors related to *spawning* `concurrently` itself (e.g., command not found).
  console.error('[RunDev] Error spawning concurrently:', error);
  // Attempt cleanup and exit with error code if spawning fails.
  cleanupDocker().finally(() => process.exit(1));
});

devProcess.on('close', (code, signal) => {
  // Logged when the `concurrently` process exits.
  console.log(
    `[RunDev] Concurrently process exited with code ${code}, signal ${signal}.`
  );
  // If the exit was unexpected (not triggered by our shutdown handler), run cleanup.
  if (!isShuttingDown) {
    console.log(
      '[RunDev] Concurrently closed unexpectedly, running cleanup...'
    );
    cleanupDocker().finally(() => {
      // Exit this script with the exit code from `concurrently`.
      process.exit(code ?? 1);
    });
  }
});
// --- End Process Event Handling ---

// --- Graceful Shutdown Handling for this Wrapper Script ---
// Flag to prevent duplicate shutdown logic execution.
let isShuttingDown = false;

/**
 * Handles shutdown signals (SIGINT, SIGTERM) for the run-dev.js script.
 * Attempts to kill the `concurrently` process and then cleans up Docker containers.
 * @param {string} signal - The signal received (e.g., 'SIGINT', 'SIGTERM').
 */
async function handleShutdown(signal) {
  if (isShuttingDown) return; // Prevent re-entry
  isShuttingDown = true;
  console.log(`\n[RunDev] Received ${signal}. Initiating shutdown...`);

  // 1. Terminate the `concurrently` process.
  //    We send SIGKILL because `concurrently` might not reliably pass SIGTERM/SIGINT
  //    down to all its child processes (especially those started via yarn/nodemon).
  //    SIGKILL provides a more forceful termination.
  console.log('[RunDev] Terminating concurrently process...');
  if (devProcess && !devProcess.killed) {
    const killed = devProcess.kill('SIGKILL'); // Use SIGKILL
    console.log(
      `[RunDev] Kill signal sent to concurrently process (PID: ${devProcess.pid}). Success: ${killed}`
    );
  } else {
    console.log('[RunDev] Concurrently process already exited or not running.');
  }

  // 2. Wait briefly for processes to terminate after sending kill signal.
  //    Adjust delay if needed.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 3. Run Docker cleanup *after* attempting to kill the child processes.
  await cleanupDocker();

  console.log('[RunDev] Shutdown complete. Exiting wrapper script.');
  // Exit the wrapper script cleanly.
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', () => handleShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => handleShutdown('SIGTERM')); // kill command
// --- End Graceful Shutdown Handling ---
