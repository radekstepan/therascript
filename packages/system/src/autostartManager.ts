// autostartManager.ts

// --- FIX: Add 'node:' prefix to built-in module imports ---
import { exec } from 'node:child_process';
import util from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
// --- END FIX ---

const execPromise = util.promisify(exec);
const SYSTEMD_PATH = '/etc/systemd/system/';

// Helper function to validate service names (simple version)
function isValidServiceName(name: string): boolean {
  return /^[a-zA-Z0-9-]+\.service$/.test(name);
}

// Helper function to run commands, handling potential errors
async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    console.log(`Executing: ${command}`);
    try {
        return await execPromise(command);
    } catch (error: any) {
        console.error(`Command failed: ${command}`);
        console.error(`Error: ${error.message}`);
        if (error.stderr) console.error(`stderr: ${error.stderr}`);
        if (error.stdout) console.error(`stdout: ${error.stdout}`); // Log stdout too, might have info
        throw error; // Re-throw after logging
    }
}


/**
 * Checks if a systemd service is enabled (configured to start on boot).
 * Requires root privileges if checking system-wide services.
 *
 * @param {string} serviceName - The name of the service (e.g., 'my-app.service').
 * @returns {Promise<boolean>} True if the service is enabled, false otherwise.
 * @throws {Error} If the check command fails or the service name is invalid.
 */
export async function isAutostartEnabled(serviceName: string): Promise<boolean> {
  if (!isValidServiceName(serviceName)) {
    throw new Error(`Invalid service name format: "${serviceName}". Should end with '.service'.`);
  }
  // Warning moved to the calling scripts (setup/remove/check) as it's context-dependent
  // console.warn(`Checking autostart for "${serviceName}". Requires root privileges (sudo).`);

  // `systemctl is-enabled` returns exit code 0 and prints "enabled" if enabled.
  // It returns exit code 1 and prints "disabled" or "static" etc. otherwise.
  // We wrap it in a command that always exits 0 to check the output easily.
  const command = `systemctl is-enabled ${serviceName} > /dev/null 2>&1 && echo "enabled" || echo "disabled"`;

  try {
    // Note: runCommand already logs execution
    const { stdout } = await runCommand(command);
    const result = stdout.trim();
    console.log(`[isAutostartEnabled] Check result for ${serviceName}: ${result}`);
    return result === 'enabled';
  } catch (error: any) {
      // Specific handling for 'service not found' might be needed depending on systemctl version
      // For simplicity, we assume any error here means it's not enabled or doesn't exist.
      console.warn(`[isAutostartEnabled] Could not determine status for ${serviceName}, assuming not enabled. Error: ${error.message}`);
      return false; // Treat errors (like service not found) as 'not enabled'
  }
}

/**
 * Creates and enables a systemd service to run a script on boot.
 * Requires root privileges (run with `sudo`).
 *
 * @param {string} scriptPath - Absolute path to the script to run.
 * @param {string} serviceName - Unique name for the service (e.g., 'my-script.service').
 * @param {string} [description='Autostart service'] - Description for the service file.
 * @param {string} [nodePath='/usr/bin/env node'] - Path to the node executable. Adjust if needed.
 * @returns {Promise<void>} Resolves when the service is created and enabled.
 * @throws {Error} If creation or enabling fails, path is not absolute, or service name is invalid.
 */
export async function setAutostart(
    scriptPath: string,
    serviceName: string,
    description: string = 'Autostart service',
    nodePath: string = '/usr/bin/env node' // Common path, adjust if node is elsewhere
): Promise<void> {

  // Warning moved to the calling scripts
  // console.warn(`Setting up autostart for "${scriptPath}" as "${serviceName}". Requires root privileges (sudo).`);

  if (!path.isAbsolute(scriptPath)) {
      throw new Error(`Script path must be absolute: "${scriptPath}"`);
  }
  if (!isValidServiceName(serviceName)) {
    throw new Error(`Invalid service name format: "${serviceName}". Should end with '.service'.`);
  }

  // Check if the script exists (basic check)
  try {
      // Check read permissions are sufficient for systemd
      await fs.access(scriptPath, fs.constants.R_OK);
      console.log(`[setAutostart] Script found and readable: ${scriptPath}`);
      // Note: Execute permissions might be needed depending on how nodePath is resolved/used by systemd
      // await fs.access(scriptPath, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err: any) { // Catch specific error type if possible
      throw new Error(`Script not found or not readable at "${scriptPath}". Error: ${err.message}`);
  }

  const serviceFilePath = path.join(SYSTEMD_PATH, serviceName);

  // --- Determine user running the script ---
  // This gets the username of the user who invoked sudo, not necessarily 'root'
  // Requires `logname` command to be available. Fallback to 'root' if needed.
  let serviceUser = 'root'; // Default to root
  try {
      // Use 'whoami' as a fallback or primary method if 'logname' isn't reliable in sudo context
      // const { stdout: whoamiOutput } = await execPromise('whoami'); // Alternative
      const { stdout: lognameOutput } = await execPromise('logname');
      const potentialUser = lognameOutput.trim();
      if (potentialUser) {
          serviceUser = potentialUser;
          console.log(`[setAutostart] Determined sudo invoking user as: ${serviceUser}`);
      } else {
          console.warn("[setAutostart] 'logname' command didn't return a user, defaulting service user to 'root'.");
      }
  } catch (lognameError) {
       console.warn(`[setAutostart] Could not determine invoking user via 'logname', defaulting service user to 'root'. Error: ${lognameError}`);
  }
  // --- End Determine User ---

  // Construct the correct NVM path for the determined user
  // This assumes a standard NVM installation in the user's home directory
  // Make sure the Node version (v23.10.0) matches your .nvmrc and is installed for that user
  const nvmNodePath = `/home/${serviceUser}/.nvm/versions/node/v23.10.0/bin`;
  const pathEnv = `PATH=/usr/bin:/usr/local/bin:${nvmNodePath}`; // Prepend NVM path
  console.log(`[setAutostart] Using PATH environment for service: ${pathEnv}`);


  // Define the content of the .service file
  const serviceContent = `
[Unit]
Description=${description}
After=network.target network-online.target # Wait for network connectivity

[Service]
Type=simple
# Use the full path to node determined above if not using /usr/bin/env node
# IMPORTANT: If nodePath is '/usr/bin/env node', the PATH env below is critical
ExecStart=${nodePath} ${scriptPath}
WorkingDirectory=${path.dirname(scriptPath)} # Set working directory to script's location
Restart=on-failure
RestartSec=5s      # Wait 5 seconds before restarting
User=${serviceUser} # Run as the determined user (or root fallback)
Group=${serviceUser} # Use the same group.
Environment="NODE_ENV=production"
# Set the PATH environment variable to include the correct NVM node version
# This is crucial if nodePath is '/usr/bin/env node' or if the script relies on other NVM tools
Environment="${pathEnv}"
StandardOutput=journal # Send stdout to journald
StandardError=journal  # Send stderr to journald

[Install]
WantedBy=multi-user.target # For system-wide service
  `.trim();

  try {
    // 1. Write the service file
    console.log(`[setAutostart] Writing service file to: ${serviceFilePath}`);
    await fs.writeFile(serviceFilePath, serviceContent, { encoding: 'utf8', mode: 0o644 });
    console.log(`[setAutostart] Service file ${serviceName} created.`);

    // 2. Reload systemd daemon to recognize the new service
    await runCommand('systemctl daemon-reload');
    console.log('[setAutostart] Systemd daemon reloaded.');

    // 3. Enable the service to start on boot
    await runCommand(`systemctl enable ${serviceName}`);
    console.log(`[setAutostart] Service ${serviceName} enabled successfully.`);

  } catch (error: any) {
    console.error(`[setAutostart] Failed to set up autostart service "${serviceName}".`);
    // Attempt cleanup if file was created
    try {
      await fs.unlink(serviceFilePath);
      console.log(`[setAutostart Cleanup] Cleaned up potentially created service file: ${serviceFilePath}`);
    } catch (cleanupError: any) {
      // Ignore cleanup error if file didn't exist or permissions denied (ENOENT)
      if (cleanupError.code !== 'ENOENT') {
          console.error(`[setAutostart Cleanup] Error during cleanup: ${cleanupError.message}`);
      }
    }
    throw new Error(`Failed to set autostart: ${error.message}`);
  }
}

/**
 * Disables and removes a systemd service configured for autostart.
 * Requires root privileges (run with `sudo`).
 *
 * @param {string} serviceName - The name of the service to remove (e.g., 'my-script.service').
 * @returns {Promise<void>} Resolves when the service is disabled and removed.
 * @throws {Error} If disabling or removal fails, or service name is invalid.
 */
export async function removeAutostart(serviceName: string): Promise<void> {
    if (!isValidServiceName(serviceName)) {
        throw new Error(`Invalid service name format: "${serviceName}". Should end with '.service'.`);
    }
    // Warning moved to calling script
    // console.warn(`Removing autostart service "${serviceName}". Requires root privileges (sudo).`);

    const serviceFilePath = path.join(SYSTEMD_PATH, serviceName);

    try {
        // 1. Disable the service (stop it from starting on boot)
        // Use --now to also stop it if it's running
        try {
            await runCommand(`systemctl disable --now ${serviceName}`);
            console.log(`[removeAutostart] Service ${serviceName} disabled and stopped.`);
        } catch (disableError: any) {
            // Ignore "service not loaded" or "does not exist" errors during disable
             // Check for common error messages indicating the service wasn't enabled/found
             // --- FIX: Avoid optional chaining ---
             const msg = (disableError && disableError.message && typeof disableError.message.toLowerCase === 'function') ? disableError.message.toLowerCase() : '';
             const stderr = (disableError && disableError.stderr && typeof disableError.stderr.toLowerCase === 'function') ? disableError.stderr.toLowerCase() : '';
             // --- END FIX ---

             if (msg.includes('does not exist') ||
                 stderr.includes('does not exist') ||
                 msg.includes('no such file or directory') ||
                 stderr.includes('no such file or directory') ||
                 msg.includes('not loaded') ||
                 stderr.includes('not loaded') ||
                 msg.includes('no vendor preset') || // Another possible message
                 stderr.includes('no vendor preset'))
            {
                console.log(`[removeAutostart] Service ${serviceName} was not found or not loaded/enabled, proceeding with cleanup.`);
            } else {
                console.warn(`[removeAutostart] Warning during disable command (may indicate service wasn't running or enabled): ${disableError.message}`);
                // Don't re-throw unless it's a critical error, allow cleanup to proceed
                // throw disableError;
            }
        }


        // 2. Remove the service file
        try {
            await fs.unlink(serviceFilePath);
            console.log(`[removeAutostart] Service file ${serviceFilePath} removed.`);
        } catch (unlinkError: any) {
            if (unlinkError.code === 'ENOENT') {
                 console.log(`[removeAutostart] Service file ${serviceFilePath} did not exist.`);
            } else {
                console.error(`[removeAutostart] Error removing service file ${serviceFilePath}: ${unlinkError.message}`);
                throw unlinkError; // Re-throw other file errors
            }
        }

        // 3. Reload systemd daemon
        await runCommand('systemctl daemon-reload');
        console.log('[removeAutostart] Systemd daemon reloaded.');

        console.log(`[removeAutostart] Autostart service ${serviceName} removed successfully.`);

    } catch (error: any) {
        console.error(`[removeAutostart] Failed to remove autostart service "${serviceName}".`);
        // Avoid throwing generic 'Failed to remove' if specific error was already thrown
        if (!(error instanceof Error && error.message.startsWith('Failed to remove autostart:'))) {
           throw new Error(`Failed to remove autostart: ${error.message}`);
        } else {
             throw error; // Re-throw the original error
        }
    }
}
