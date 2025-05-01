// Purpose: Standalone script to check if the Therascript systemd service is enabled.
//          Designed to be run via `yarn autostart:status`.

import { isAutostartEnabled } from './autostartManager.js'; // Import the checking function

// IMPORTANT: This service name MUST match the name used in `setupAutostart.ts`
// and `removeAutostartScript.ts`.
const SERVICE_NAME = 'therascript-app.service';

/**
 * Main function to check and report the autostart status.
 */
async function checkStatus() {
    console.log(`[Autostart Status Check] Checking status for service: ${SERVICE_NAME}...`);
    // Remind user that root privileges are usually needed for system-wide checks.
    console.warn(`[Autostart Status Check] This check typically requires root privileges (sudo).`);

    try {
        // Call the autostart manager function to check if the service is enabled
        const isEnabled = await isAutostartEnabled(SERVICE_NAME);

        // Report the status to the console
        if (isEnabled) {
            console.log(`✅ Autostart Status for ${SERVICE_NAME}: ENABLED`);
            console.log(`   The application is configured to start automatically on boot.`);
        } else {
            console.log(`❌ Autostart Status for ${SERVICE_NAME}: DISABLED or NOT FOUND`);
            console.log(`   The application is NOT configured to start automatically on boot.`);
            console.log(`   Run 'yarn autostart:setup' (with sudo) to enable it.`);
        }
        process.exit(0); // Exit with success code
    } catch (error) {
        // Log any errors during the check process
        console.error(`[Autostart Status Check] Error checking autostart status for ${SERVICE_NAME}:`, error);
        process.exitCode = 1; // Indicate failure
    }
}

// Execute the check function when the script is run
checkStatus();
