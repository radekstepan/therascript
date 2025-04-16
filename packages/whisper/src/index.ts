// packages/whisper/src/index.ts
import { ensureWhisperRunning, stopWhisperService } from './dockerManager';

let isRunning = false; // Flag to track if startup was successful

async function main() {
    console.log("--- Whisper Service Manager ---");
    try {
        await ensureWhisperRunning();
        isRunning = true;
        console.log("✅ Whisper service manager initialization successful.");
        console.log("   (Manager process will keep running to handle shutdown signals)");

        // *** ADD THIS: Keep the process alive indefinitely ***
        console.log("   (Starting keep-alive interval)");
        setInterval(() => {
            // This function does nothing, but the interval keeps Node.js running
        }, 1 << 30); // Use a very large interval (approx 30 years) to minimize overhead

    } catch (error: any) {
        console.error("❌ Fatal Error during Whisper service startup:", error.message);
        console.error("   >>> API calls to Whisper will likely fail. Stopping development server startup. <<<");
        process.exit(1);
    }
}

// --- Graceful Shutdown ---
let isShuttingDown = false;
async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🚦 Received ${signal}. Initiating Whisper service shutdown (if it started successfully)...`);
    if (isRunning) {
        try {
            await stopWhisperService();
        } catch (error) {
            console.error("[Whisper Manager] Error during Docker stop on shutdown:", error);
        }
    } else {
        console.log("[Whisper Manager] Skipping Docker stop as initial startup did not complete successfully.");
    }
    console.log("🚪 Whisper Service Manager process is exiting.");
    // Allow the natural exit after signal handling finishes
    // process.exit(0); // REMOVE explicit exit if present
}

// Capture signals for graceful shutdown
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Optional: Log when the process actually exits
process.on('exit', (code) => {
     if (!isShuttingDown) {
         console.error(`[Whisper Manager] Exited unexpectedly with code ${code}. If the container was running, stop it manually ('docker compose down').`);
     } else {
         console.log(`[Whisper Manager] Final process exit with code ${code}.`);
     }
});

// --- Execute Main Function ---
main();
