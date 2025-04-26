// packages/system/src/setupAutostart.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAutostart, isAutostartEnabled, removeAutostart } from './autostartManager.js';

const SERVICE_NAME = 'therascript-app.service';
const SERVICE_DESCRIPTION = 'Therascript Application Autostart Service';

async function setup() {
    console.log(`[Autostart Setup] Attempting to configure autostart for ${SERVICE_NAME}...`);

    // --- Determine the absolute path to the compiled wrapper script ---
    const __filename = fileURLToPath(import.meta.url);
    // Assuming this script is in 'dist/' after build
    const distDir = path.dirname(__filename);
    // Path to the compiled wrapper script
    const wrapperScriptPath = path.resolve(distDir, 'startAppWrapper.js');
    console.log(`[Autostart Setup] Absolute path to wrapper script: ${wrapperScriptPath}`);
    // --- End Path Determination ---

    try {
        // Check if the service is already enabled
        const enabled = await isAutostartEnabled(SERVICE_NAME);
        if (enabled) {
            console.log(`[Autostart Setup] Service ${SERVICE_NAME} is already enabled. No action needed.`);
            // Optional: Offer to remove and re-add if needed for updates
            // console.log("To update, first run 'yarn autostart:remove', then 'yarn autostart:setup'.");
            return;
        }

        // Set up autostart
        await setAutostart(
            wrapperScriptPath, // Absolute path to the wrapper script
            SERVICE_NAME,
            SERVICE_DESCRIPTION,
            // Assuming 'node' is in the PATH for the root user running the service
            // Adjust if Node is installed differently:
            // nodePath: '/path/to/specific/node'
        );

        console.log(`[Autostart Setup] Successfully enabled service ${SERVICE_NAME}.`);
        console.log(`[Autostart Setup] The application should now start automatically on the next system boot.`);
        console.log(`[Autostart Setup] To check status: systemctl status ${SERVICE_NAME}`);
        console.log(`[Autostart Setup] To see logs: journalctl -u ${SERVICE_NAME}`);

    } catch (error) {
        console.error(`[Autostart Setup] Failed to set up autostart:`, error);
        process.exitCode = 1;
        // Try to clean up if setup failed halfway
        try {
            console.log("[Autostart Setup] Attempting cleanup...");
            await removeAutostart(SERVICE_NAME);
        } catch (cleanupError) {
            console.error("[Autostart Setup] Cleanup failed:", cleanupError);
        }
    }
}

// Execute the setup function
setup();
