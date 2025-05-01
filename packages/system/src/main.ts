// Purpose: Example entry point demonstrating the usage of shutdown and autostart management functions.
//          This file is primarily for testing/demonstration and is NOT the main entry point
//          for the Therascript application itself.

import { shutdownSystem } from './shutdown.js'; // Import the shutdown function
import {
  setAutostart,
  isAutostartEnabled,
  removeAutostart,
} from './autostartManager.js'; // Import autostart functions
import path from 'path'; // For resolving paths

// --- Configuration (Example Values) ---
// IMPORTANT: Replace with the *ABSOLUTE* path to the script you want to autostart.
// For Therascript, this should point to the compiled `startAppWrapper.js`.
// `__dirname` points to the directory of the *compiled* main.js (likely `dist/`).
const SCRIPT_TO_AUTOSTART_PATH = path.resolve(__dirname, 'startAppWrapper.js'); // Correct path for Therascript

// IMPORTANT: Choose a unique and descriptive name for your systemd service.
// This MUST match the name used across all autostart scripts.
const SERVICE_NAME = 'therascript-app.service'; // Correct service name for Therascript

// Reminder: Ensure the target script (startAppWrapper.js) exists, is executable,
// and has the correct shebang (`#!/usr/bin/env node`).
// --- End Configuration ---

/**
 * Example function to manage the autostart configuration.
 * Checks if the service is enabled and sets it up if not.
 * Includes commented-out example for removal.
 */
async function manageAutostart() {
  console.log(`--- Autostart Management for ${SERVICE_NAME} ---`);
  console.warn('Requires root privileges (sudo).');
  try {
    const isEnabled = await isAutostartEnabled(SERVICE_NAME);
    console.log(`Service ${SERVICE_NAME} currently enabled: ${isEnabled}`);

    if (!isEnabled) {
      console.log(`Setting up autostart for ${SCRIPT_TO_AUTOSTART_PATH}...`);
      await setAutostart(
        SCRIPT_TO_AUTOSTART_PATH,
        SERVICE_NAME,
        `Therascript Application Autostart` // Descriptive name
        // Optional: specify node path if not default '/usr/bin/env node'
        // Optional: specify user if not determined correctly automatically
      );
      console.log(`Autostart configured successfully for ${SERVICE_NAME}.`);
    } else {
      console.log(
        `Service ${SERVICE_NAME} is already configured for autostart.`
      );
      // Example: Remove if needed (uncomment to test removal)
      // console.log(`Removing existing autostart configuration for ${SERVICE_NAME}...`);
      // await removeAutostart(SERVICE_NAME);
      // console.log(`Autostart configuration removed for ${SERVICE_NAME}.`);
    }
  } catch (error) {
    console.error('Error during autostart management:', error);
    process.exitCode = 1; // Indicate failure if autostart management fails
  }
  console.log(`--- Autostart Management Finished ---`);
}

/**
 * Main execution function (example).
 * Runs autostart management and optionally triggers shutdown.
 */
async function main() {
  // Run autostart management first
  await manageAutostart();

  // Example: Optionally trigger shutdown after a delay or based on some condition
  // Requires sudo! Set to true ONLY for testing shutdown.
  const shouldShutdown = false;

  if (shouldShutdown && process.exitCode !== 1) {
    // Don't shutdown if autostart management failed
    console.log('\n--- Initiating System Shutdown (Example) ---');
    try {
      console.log('Waiting 5 seconds before shutting down...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await shutdownSystem(); // Call the shutdown function
      // Execution likely stops here if shutdown is successful
      console.log('Shutdown command dispatched.'); // May not be reached
    } catch (error) {
      console.error('Error during shutdown initiation:', error);
      process.exitCode = 1; // Indicate shutdown failure
    }
  } else if (shouldShutdown) {
    console.log('\n--- Skipping shutdown due to previous errors ---');
  } else {
    console.log('\n--- Shutdown not requested in this example run ---');
  }
}

// --- Script Execution ---
// REMEMBER TO RUN THIS SCRIPT WITH SUDO if testing autostart/shutdown:
// 1. Compile: `yarn build:system` (from root)
// 2. Run: `cd packages/system/dist && sudo node main.js`
// Check service status after running: `systemctl status therascript-app.service`
// Check if enabled: `systemctl is-enabled therascript-app.service`
// Check logs after reboot (if script logs): `journalctl -u therascript-app.service`
// -------------------------

// Execute main function and catch any top-level errors
main().catch((error) => {
  console.error('Unhandled error in main execution:', error);
  process.exit(1);
});
