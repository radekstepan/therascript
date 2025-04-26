// packages/system/src/checkAutostartStatus.ts
import { isAutostartEnabled } from './autostartManager.js';

// IMPORTANT: This MUST match the service name used in setupAutostart.ts and removeAutostartScript.ts
const SERVICE_NAME = 'therascript-app.service';

async function checkStatus() {
    console.log(`[Autostart Status Check] Checking status for service: ${SERVICE_NAME}...`);
    console.warn(`[Autostart Status Check] This check typically requires root privileges (sudo).`);

    try {
        const isEnabled = await isAutostartEnabled(SERVICE_NAME);

        if (isEnabled) {
            console.log(`✅ Autostart Status for ${SERVICE_NAME}: ENABLED`);
            console.log(`   The application is configured to start automatically on boot.`);
        } else {
            console.log(`❌ Autostart Status for ${SERVICE_NAME}: DISABLED or NOT FOUND`);
            console.log(`   The application is NOT configured to start automatically on boot.`);
            console.log(`   Run 'yarn autostart:setup' to enable it.`);
        }
        process.exit(0); // Success exit code
    } catch (error) {
        console.error(`[Autostart Status Check] Error checking autostart status for ${SERVICE_NAME}:`, error);
        process.exitCode = 1; // Indicate failure
    }
}

// Execute the check function
checkStatus();
