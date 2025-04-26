// main.ts

import { shutdownSystem } from './shutdown.js'; // Adjust path if needed
import { setAutostart, isAutostartEnabled, removeAutostart } from './autostartManager.js'; // Adjust path
import path from 'path';

// --- Configuration ---
// IMPORTANT: Replace with the *ABSOLUTE* path to the script you want to autostart
const SCRIPT_TO_AUTOSTART_PATH = path.resolve(__dirname, 'my-autostart-script.js'); // Example path

// IMPORTANT: Choose a unique and descriptive name for your systemd service
const SERVICE_NAME = 'my-custom-app.service';

// IMPORTANT: Ensure the script at SCRIPT_TO_AUTOSTART_PATH exists,
// has the correct shebang (e.g., #!/usr/bin/env node), and is executable (chmod +x).
// Create a dummy script for testing if needed:
// echo '#!/usr/bin/env node\nconsole.log("Autostart script ran at:", new Date());' > my-autostart-script.js
// chmod +x my-autostart-script.js
// --- End Configuration ---


async function manageAutostart() {
    console.log(`--- Autostart Management for ${SERVICE_NAME} ---`);
    try {
        const isEnabled = await isAutostartEnabled(SERVICE_NAME);
        console.log(`Service ${SERVICE_NAME} currently enabled: ${isEnabled}`);

        if (!isEnabled) {
            console.log(`Setting up autostart for ${SCRIPT_TO_AUTOSTART_PATH}...`);
            await setAutostart(
                SCRIPT_TO_AUTOSTART_PATH,
                SERVICE_NAME,
                `My Custom Application Service` // Optional description
                // Optional: specify node path if not default '/usr/bin/env node'
                // Optional: specify user if not root (ensure user has permissions!)
            );
            console.log(`Autostart configured successfully for ${SERVICE_NAME}.`);
        } else {
            console.log(`Service ${SERVICE_NAME} is already configured for autostart.`);
            // Example: Remove if needed (uncomment to test removal)
            // console.log(`Removing existing autostart configuration for ${SERVICE_NAME}...`);
            // await removeAutostart(SERVICE_NAME);
            // console.log(`Autostart configuration removed for ${SERVICE_NAME}.`);
        }
    } catch (error) {
        console.error('Error during autostart management:', error);
        // Decide if the program should exit or continue
        process.exitCode = 1;
    }
    console.log(`--- Autostart Management Finished ---`);
}


async function main() {
    // Run autostart management first
    await manageAutostart();

    // Example: Optionally trigger shutdown after a delay or based on some condition
    // Remember this needs sudo!
    const shouldShutdown = false; // Set to true to test shutdown

    if (shouldShutdown && process.exitCode !== 1) { // Don't shutdown if autostart failed
        console.log("\n--- Initiating System Shutdown ---");
        try {
            console.log("Waiting 5 seconds before shutting down...");
            await new Promise(resolve => setTimeout(resolve, 5000));
            await shutdownSystem();
            // Execution likely stops here if shutdown is successful
        } catch (error) {
            console.error("Error during shutdown initiation:", error);
            process.exitCode = 1;
        }
    } else if (shouldShutdown) {
        console.log("\n--- Skipping shutdown due to previous errors ---");
    } else {
         console.log("\n--- Shutdown not requested ---");
    }
}


// --- Script Execution ---
// REMEMBER TO RUN THIS SCRIPT WITH SUDO:
// 1. Compile: tsc *.ts --module commonjs --esModuleInterop --outDir dist
// 2. Create dummy script: echo '#!/usr/bin/env node\nconsole.log("Autostart ran:", new Date());' > dist/my-autostart-script.js && chmod +x dist/my-autostart-script.js
// 3. Run: cd dist && sudo node main.js
// Check service status after running: systemctl status my-custom-app.service
// Check if enabled: systemctl is-enabled my-custom-app.service
// Check logs after reboot (if script logs): journalctl -u my-custom-app.service
// -------------------------

main().catch(error => {
    console.error("Unhandled error in main execution:", error);
    process.exit(1);
});
