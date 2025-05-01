// Purpose: Standalone script to disable and remove the Therascript systemd service.
//          Designed to be run via `yarn autostart:remove`.

import { removeAutostart } from './autostartManager.js'; // Import the removal function

// IMPORTANT: This service name MUST match the name used in `setupAutostart.ts`.
const SERVICE_NAME = 'therascript-app.service';

/**
 * Main function to execute the autostart removal process.
 */
async function remove() {
  console.log(
    `[Autostart Removal] Attempting to remove autostart service: ${SERVICE_NAME}...`
  );
  console.warn(
    `[Autostart Removal] This operation requires root privileges (sudo).`
  );

  try {
    // Call the autostart manager function to disable and remove the service
    await removeAutostart(SERVICE_NAME);
    console.log(
      `[Autostart Removal] Service ${SERVICE_NAME} disabled and removed successfully.`
    );
    console.log(
      `[Autostart Removal] The application will no longer start automatically on boot.`
    );
  } catch (error) {
    // Log any errors during the removal process
    console.error(
      `[Autostart Removal] Failed to remove autostart service:`,
      error
    );
    process.exitCode = 1; // Indicate failure
  }
}

// Execute the removal function when the script is run
remove();
