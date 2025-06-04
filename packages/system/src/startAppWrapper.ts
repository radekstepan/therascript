// Purpose: This script acts as a wrapper to start the main Therascript application
//          using a specific yarn script. It's designed to be the executable target for the
//          systemd service defined by `autostartManager.ts`.

import { spawn } from 'node:child_process'; // For spawning the yarn process
import path from 'node:path'; // For path manipulation
import fs from 'node:fs'; // For checking file existence (project root verification)
import { fileURLToPath } from 'node:url'; // For getting current file path

// --- Determine Project Root Directory ---
// Get the directory of the current script file (`startAppWrapper.js`)
const __filename = fileURLToPath(import.meta.url);
// Resolve paths relative to the *compiled* script location (likely `dist/`)
// Assumes structure: .../packages/system/dist/startAppWrapper.js
const systemPackageDir = path.resolve(__filename, '../..'); // Up two levels to packages/system
const projectRootDir = path.resolve(systemPackageDir, '../..'); // Up two levels to project root

console.log(
  `[Autostart Wrapper] Script directory: ${path.dirname(__filename)}`
);
console.log(
  `[Autostart Wrapper] System package directory: ${systemPackageDir}`
);
console.log(`[Autostart Wrapper] Determined Project Root: ${projectRootDir}`);
// --- End Project Root Determination ---

// --- Verify Project Root ---
// Basic sanity check to ensure the determined root directory looks correct.
if (
  !fs.existsSync(path.join(projectRootDir, 'lerna.json')) ||
  !fs.existsSync(path.join(projectRootDir, 'package.json'))
) {
  console.error(
    `[Autostart Wrapper] Error: Could not verify project root at ${projectRootDir}. Key files (lerna.json/package.json) missing.`
  );
  process.exit(1); // Exit if the root path seems incorrect
}
// --- End Verification ---

// --- Find Yarn Executable ---
// Use 'yarn' directly, relying on it being in the PATH for the user running the service.
const yarnPath = 'yarn';

console.log(
  `[Autostart Wrapper] Starting application in ${projectRootDir} using executable '${yarnPath}'...`
);

// Define the arguments for the yarn command.
// MODIFIED: Target 'start:api:prod' script specifically for the systemd environment.
// This script ('start:api:prod') in the root package.json should build the API
// and run it with production environment variables (e.g., from .env.api.prod).
const yarnArgs = ['start:api:prod'];

// --- Spawn the Yarn Process ---
// Use `spawn` to create a new child process.
const child = spawn(yarnPath, yarnArgs, {
  cwd: projectRootDir, // Set the working directory to the project root
  stdio: 'inherit', // Pass through stdin, stdout, stderr to the wrapper's console/journald
  shell: true, // Use shell=true for better cross-platform compatibility and path resolution for 'yarn'
  env: {
    ...process.env, // Inherit environment variables from the wrapper process (set by systemd)
    NODE_ENV: 'production', // Ensure the application runs in production mode
    // Note: The `start:api:prod` script itself should handle loading specific .env files (e.g., .env.api.prod)
  },
});
// --- End Spawn Process ---

// --- Child Process Event Handling ---
child.on('spawn', () => {
  console.log(
    `[Autostart Wrapper] 'yarn ${yarnArgs.join(' ')}' process spawned successfully (PID: ${child.pid}).`
  );
});

child.on('error', (error) => {
  // Handle errors during the spawning process itself (e.g., 'yarn' not found)
  console.error(
    `[Autostart Wrapper] Error spawning 'yarn ${yarnArgs.join(' ')}':`,
    error
  );
  process.exit(1); // Exit the wrapper script if spawning fails
});

child.on('close', (code, signal) => {
  // Handle when the child process exits
  console.log(
    `[Autostart Wrapper] 'yarn ${yarnArgs.join(' ')}' process exited with code ${code}, signal ${signal}.`
  );
  process.exit(code ?? 1); // Exit wrapper with the child's exit code (or 1 if null)
});
// --- End Event Handling ---

// --- Wrapper Signal Handling ---
// Ensure the wrapper script handles termination signals gracefully and attempts
// to terminate the child process it spawned.

process.on('SIGINT', () => {
  // Ctrl+C
  console.log(
    '[Autostart Wrapper] Received SIGINT. Terminating child process...'
  );
  if (child && !child.killed) child.kill('SIGTERM');
  setTimeout(() => {
    if (child && !child.killed) {
      console.warn(
        '[Autostart Wrapper] Child process did not exit after SIGTERM, sending SIGKILL.'
      );
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  // systemctl stop
  console.log(
    '[Autostart Wrapper] Received SIGTERM. Terminating child process...'
  );
  if (child && !child.killed) child.kill('SIGTERM');
  setTimeout(() => {
    if (child && !child.killed) {
      console.warn(
        '[Autostart Wrapper] Child process did not exit after SIGTERM, sending SIGKILL.'
      );
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, 2000);
});
// --- End Wrapper Signal Handling ---
