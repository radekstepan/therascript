// Purpose: Entry point for the Node.js script that manages the Whisper Docker service lifecycle.
//          This script is intended to be run alongside the main API and UI during development
//          (orchestrated by the root `run-dev.js` script). It ensures the Whisper container
//          is running and handles graceful shutdown.

import { ensureWhisperRunning, stopWhisperService } from './dockerManager'; // Import Docker management functions

// Flag to track if the initial startup sequence completed successfully.
// Used to determine if cleanup (stopping the container) is needed on exit.
let isRunning = false;

/**
 * Main asynchronous function to initialize the Whisper service manager.
 */
async function main() {
  console.log('--- Whisper Service Manager ---');
  try {
    // Ensure the Whisper Docker container is running and healthy.
    // This involves checking the container status and performing health checks.
    // It might start the container if it's not running.
    await ensureWhisperRunning();
    // If ensureWhisperRunning completes without throwing, mark startup as successful.
    isRunning = true;
    console.log('✅ Whisper service manager initialization successful.');
    console.log(
      '   (Manager process will keep running to handle shutdown signals)'
    );

    // Keep the Node.js process alive indefinitely after successful startup.
    // The primary purpose of this script is to manage the Docker container's lifecycle
    // and respond to shutdown signals from the parent process (`run-dev.js`).
    console.log(
      '   (Starting keep-alive interval - press Ctrl+C to stop dev environment)'
    );
    // Use a very large interval to minimize CPU usage while keeping the process alive.
    setInterval(() => {
      // This function intentionally does nothing.
      // Its existence prevents Node.js from exiting automatically.
    }, 1 << 30); // Interval is approximately 34 years (2^30 ms)
  } catch (error: any) {
    // Handle fatal errors during the startup/health check phase.
    console.error(
      '❌ Fatal Error during Whisper service startup:',
      error.message
    );
    console.error('   >>> API calls to Whisper will likely fail. <<<');
    // Exit with an error code to signal failure to the parent process.
    process.exit(1);
  }
}

// --- Graceful Shutdown Logic ---
// Flag to prevent duplicate shutdown attempts if multiple signals are received quickly.
let isShuttingDown = false;

/**
 * Handles shutdown signals (SIGINT, SIGTERM) to gracefully stop the Whisper Docker container.
 * @param signal - The signal received (e.g., 'SIGINT', 'SIGTERM').
 */
async function shutdown(signal: string) {
  // Prevent re-entry if shutdown is already in progress.
  if (isShuttingDown) {
    console.log(
      `[Whisper Manager] Shutdown already in progress, ignoring signal: ${signal}`
    );
    return;
  }
  isShuttingDown = true;
  console.log(
    `\n🚦 Received ${signal}. Initiating Whisper service shutdown...`
  );

  // Only attempt to stop the Docker container if the initial startup was successful.
  if (isRunning) {
    try {
      // Call the function to stop the Whisper Docker container.
      await stopWhisperService();
      console.log(
        '[Whisper Manager] Whisper service container stop command issued.'
      );
    } catch (error) {
      // Log errors during Docker stop but don't prevent the manager process from exiting.
      console.error(
        '[Whisper Manager] Error during Docker stop on shutdown:',
        error
      );
    }
  } else {
    // Skip Docker stop if startup failed, as the container might not exist or be manageable.
    console.log(
      '[Whisper Manager] Skipping Docker stop as initial startup did not complete successfully.'
    );
  }
  console.log('🚪 Whisper Service Manager process is exiting.');
  // Allow the Node.js process to exit naturally after signal handlers complete.
  // No explicit process.exit(0) needed here.
}

// Capture termination signals to trigger the graceful shutdown function.
process.on('SIGINT', () => shutdown('SIGINT')); // Typically Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // Sent by process managers (like `concurrently` or `kill`)

// Optional: Log when the process finally exits, indicating if it was expected or unexpected.
process.on('exit', (code) => {
  if (!isShuttingDown) {
    // If the process exits without `isShuttingDown` being true, it was likely unexpected.
    console.error(`[Whisper Manager] Exited unexpectedly with code ${code}.`);
    // Remind the user to potentially clean up the container manually if it was left running.
    console.error(
      `   If the Whisper container was running, consider stopping it manually ('docker compose -f ./docker-compose.yml down' from root).`
    );
  } else {
    // Normal exit after shutdown signal.
    console.log(`[Whisper Manager] Final process exit with code ${code}.`);
  }
});
// --- End Graceful Shutdown Logic ---

// --- Execute Main Function ---
// Start the initialization process when the script is run.
main();
