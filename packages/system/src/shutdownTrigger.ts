// Purpose: A simple standalone script that directly calls the `shutdownSystem` function.
//          This script is intended to be executed with elevated privileges (sudo)
//          either directly or via the API's system service.

import { shutdownSystem } from './shutdown.js'; // Import the core shutdown logic

console.log("[Shutdown Trigger] Script execution started.");

/**
 * Asynchronous function to trigger the system shutdown.
 */
async function trigger() {
    try {
        console.log("[Shutdown Trigger] Calling shutdownSystem function...");
        // Call the function that executes `shutdown -P now`
        await shutdownSystem();
        // If the shutdown command is successful, the system will begin shutting down.
        // This log message might not be fully processed or seen before termination.
        console.log("[Shutdown Trigger] Shutdown command issued successfully (system should be shutting down).");
        process.exit(0); // Exit cleanly if the command was successfully dispatched.
    } catch (error) {
        // Log any errors that occurred during the shutdown attempt.
        console.error("[Shutdown Trigger] Error executing shutdownSystem:", error);
        process.exit(1); // Exit with an error code to indicate failure.
    }
}

// Run the trigger function
trigger();
