// Purpose: Standalone script to set up and enable the Therascript systemd service
//          for autostarting the application on Linux systems.
//          Designed to be run via `yarn autostart:setup`.

import path from 'node:path'; // For path manipulation
import { fileURLToPath } from 'node:url'; // For getting current file path
import { setAutostart, isAutostartEnabled, removeAutostart } from './autostartManager.js'; // Import autostart functions

// IMPORTANT: Define the service name and description consistently.
// This MUST match the name used in other autostart scripts (remove, check).
const SERVICE_NAME = 'therascript-app.service';
const SERVICE_DESCRIPTION = 'Therascript Application Autostart Service';

/**
 * Main function to perform the autostart setup.
 */
async function setup() {
    console.log(`[Autostart Setup] Attempting to configure autostart for ${SERVICE_NAME}...`);
    console.warn(`[Autostart Setup] This operation requires root privileges (sudo).`);

    // --- Determine the absolute path to the compiled wrapper script ---
    // This script will be executed by the systemd service.
    const __filename = fileURLToPath(import.meta.url);
    // Assuming this script (`setupAutostart.js`) is in the 'dist/' directory after build
    const distDir = path.dirname(__filename);
    // Resolve the path to the compiled `startAppWrapper.js` within the same `dist` directory.
    const wrapperScriptPath = path.resolve(distDir, 'startAppWrapper.js');
    console.log(`[Autostart Setup] Absolute path to wrapper script to be run by service: ${wrapperScriptPath}`);
    // --- End Path Determination ---

    try {
        // 1. Check if the service is already enabled to avoid redundant setup.
        const enabled = await isAutostartEnabled(SERVICE_NAME);
        if (enabled) {
            console.log(`[Autostart Setup] Service ${SERVICE_NAME} is already enabled. No action needed.`);
            console.log(`   To update/reinstall, run 'yarn autostart:remove' first, then 'yarn autostart:setup'.`);
            return; // Exit successfully if already enabled
        }

        // 2. Call the autostart manager to create and enable the service.
        console.log(`[Autostart Setup] Service not enabled. Proceeding with setup...`);
        await setAutostart(
            wrapperScriptPath, // Absolute path to the wrapper script
            SERVICE_NAME,
            SERVICE_DESCRIPTION,
            // Optional: Specify Node path if '/usr/bin/env node' isn't correct for the service user (e.g., root)
            // nodePath: '/path/to/specific/node'
        );

        // 3. Log success and provide helpful next steps.
        console.log(`[Autostart Setup] Successfully enabled service ${SERVICE_NAME}.`);
        console.log(`[Autostart Setup] The application should now start automatically on the next system boot.`);
        console.log(`[Autostart Setup] To check status: sudo systemctl status ${SERVICE_NAME}`);
        console.log(`[Autostart Setup] To see logs: sudo journalctl -u ${SERVICE_NAME}`);
        console.log(`[Autostart Setup] To disable: sudo systemctl disable --now ${SERVICE_NAME}`);

    } catch (error) {
        // Log errors during setup
        console.error(`[Autostart Setup] Failed to set up autostart:`, error);
        process.exitCode = 1; // Indicate failure

        // --- Attempt Cleanup on Failure ---
        // If setup fails midway, try to remove any potentially created service file.
        try {
            console.log("[Autostart Setup] Attempting cleanup after failure...");
            await removeAutostart(SERVICE_NAME);
            console.log("[Autostart Setup] Cleanup attempted.");
        } catch (cleanupError) {
            // Log cleanup errors but don't override the original failure exit code.
            console.error("[Autostart Setup] Cleanup attempt failed:", cleanupError);
        }
        // --- End Cleanup ---
    }
}

// Execute the setup function when the script is run
setup();
