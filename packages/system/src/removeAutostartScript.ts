// packages/system/src/removeAutostartScript.ts
import { removeAutostart } from './autostartManager.js';

const SERVICE_NAME = 'therascript-app.service'; // Must match the name used in setup

async function remove() {
    console.log(`[Autostart Removal] Attempting to remove autostart service: ${SERVICE_NAME}...`);

    try {
        await removeAutostart(SERVICE_NAME);
        console.log(`[Autostart Removal] Service ${SERVICE_NAME} disabled and removed successfully.`);
        console.log(`[Autostart Removal] The application will no longer start automatically on boot.`);
    } catch (error) {
        console.error(`[Autostart Removal] Failed to remove autostart service:`, error);
        process.exitCode = 1;
    }
}

// Execute the removal function
remove();
