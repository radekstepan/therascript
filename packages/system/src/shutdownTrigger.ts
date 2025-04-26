// packages/system/src/shutdownTrigger.ts
import { shutdownSystem } from './shutdown.js';

console.log("[Shutdown Trigger] Script execution started.");

async function trigger() {
    try {
        console.log("[Shutdown Trigger] Calling shutdownSystem function...");
        await shutdownSystem();
        // If successful, the system will shut down, and this script might terminate abruptly.
        console.log("[Shutdown Trigger] Shutdown command issued successfully (system should be shutting down).");
        process.exit(0); // Exit cleanly if command was sent
    } catch (error) {
        console.error("[Shutdown Trigger] Error executing shutdownSystem:", error);
        process.exit(1); // Exit with error code if shutdown failed
    }
}

trigger();
