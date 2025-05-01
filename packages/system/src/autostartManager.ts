// Purpose: Provides functions to manage systemd services for autostarting
//          an application on Linux systems. Includes creating, enabling,
//          disabling, removing, and checking the status of services.

import { exec } from 'node:child_process'; // For running shell commands
import util from 'node:util'; // For promisify
import fs from 'node:fs/promises'; // For async file system operations (writing/deleting service files)
import path from 'node:path'; // For path manipulation (joining paths)

// Promisify exec for async/await usage
const execPromise = util.promisify(exec);

// Standard path for system-wide systemd unit files
const SYSTEMD_PATH = '/etc/systemd/system/';

/**
 * Basic validation for systemd service names.
 * Ensures the name follows common conventions and ends with '.service'.
 *
 * @param {string} name - The service name to validate.
 * @returns {boolean} True if the name seems valid, false otherwise.
 */
function isValidServiceName(name: string): boolean {
  // Regex: Starts with letters/numbers/hyphen, contains only those, ends with '.service'
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.service$/.test(name);
}

/**
 * Helper function to execute shell commands and handle potential errors.
 * Logs the command being executed and any resulting stdout/stderr.
 *
 * @param {string} command - The shell command to execute.
 * @returns {Promise<{ stdout: string; stderr: string }>} The standard output and standard error.
 * @throws {Error} If the command execution fails (non-zero exit code).
 */
async function runCommand(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  console.log(`[Sys Mgr] Executing: ${command}`);
  try {
    // Run the command and wait for it to complete
    return await execPromise(command);
  } catch (error: any) {
    // Log detailed error information if the command fails
    console.error(`[Sys Mgr] Command failed: ${command}`);
    console.error(`[Sys Mgr] Error: ${error.message}`);
    if (error.stderr) console.error(`[Sys Mgr] Stderr: ${error.stderr}`);
    if (error.stdout) console.error(`[Sys Mgr] Stdout: ${error.stdout}`); // Log stdout too, might contain info
    throw error; // Re-throw the error to be handled by the caller
  }
}

/**
 * Checks if a systemd service is enabled (configured to start on boot).
 * Uses `systemctl is-enabled`. Requires appropriate permissions (usually root).
 *
 * @param {string} serviceName - The name of the service (e.g., 'my-app.service').
 * @returns {Promise<boolean>} True if the service is enabled, false otherwise or if status cannot be determined.
 * @throws {Error} If the service name format is invalid.
 */
export async function isAutostartEnabled(
  serviceName: string
): Promise<boolean> {
  if (!isValidServiceName(serviceName)) {
    throw new Error(
      `Invalid service name format: "${serviceName}". Should end with '.service'.`
    );
  }
  // Note: Permission warnings are handled by the calling scripts (setup/remove/check)

  // `systemctl is-enabled` has tricky exit codes. It returns 0 if enabled, 1 otherwise.
  // We wrap it to check the command's *output text* instead of relying solely on exit code.
  // This command prints "enabled" or "disabled" (or other statuses) and always exits 0.
  // Redirect stderr to /dev/null to avoid polluting logs if the service doesn't exist.
  const command = `systemctl is-enabled ${serviceName} > /dev/null 2>&1 && echo "enabled" || echo "disabled"`;

  try {
    // runCommand logs execution internally
    const { stdout } = await runCommand(command);
    const result = stdout.trim().toLowerCase(); // Check output text, case-insensitive
    console.log(
      `[Sys Mgr isEnabled] Check result for ${serviceName}: ${result}`
    );
    return result === 'enabled'; // Return true only if the output is exactly "enabled"
  } catch (error: any) {
    // If runCommand fails (unexpectedly, given the wrapper), or systemctl has issues,
    // log the error and assume the service is not enabled.
    console.warn(
      `[Sys Mgr isEnabled] Could not determine status for ${serviceName}, assuming not enabled. Error: ${error.message}`
    );
    return false; // Treat errors (like command not found, permission issues) as 'not enabled'
  }
}

/**
 * Creates and enables a systemd service file to run a script on boot.
 * IMPORTANT: Requires root privileges (run the calling script with `sudo`).
 *
 * @param {string} scriptPath - Absolute path to the script to run (e.g., the startAppWrapper.js).
 * @param {string} serviceName - Unique name for the service (e.g., 'therascript-app.service').
 * @param {string} [description='Autostart service'] - Description for the service file.
 * @param {string} [nodePath='/usr/bin/env node'] - Path to the node executable. Adjust if node is installed differently (e.g., via NVM).
 * @returns {Promise<void>} Resolves when the service is created and enabled successfully.
 * @throws {Error} If creation or enabling fails, path is not absolute, service name is invalid, or script is not accessible.
 */
export async function setAutostart(
  scriptPath: string,
  serviceName: string,
  description: string = 'Autostart service',
  nodePath: string = '/usr/bin/env node' // Uses env to find node, relies on PATH
): Promise<void> {
  // Note: Permission warnings are handled by the calling scripts

  // --- Input Validation ---
  if (!path.isAbsolute(scriptPath)) {
    throw new Error(`Script path must be absolute: "${scriptPath}"`);
  }
  if (!isValidServiceName(serviceName)) {
    throw new Error(
      `Invalid service name format: "${serviceName}". Should end with '.service'.`
    );
  }
  // --- End Validation ---

  // --- Check Script Accessibility ---
  try {
    // Check if the script file exists and is readable by the process (needs sudo).
    await fs.access(scriptPath, fs.constants.R_OK);
    console.log(
      `[Sys Mgr setAutostart] Script found and readable: ${scriptPath}`
    );
    // Note: Execute permissions (`fs.constants.X_OK`) might be needed depending on the `nodePath`
    // and how systemd resolves it, but typically read is sufficient if node executes the script.
  } catch (err: any) {
    throw new Error(
      `Script not found or not readable at "${scriptPath}". Error: ${err.message}`
    );
  }
  // --- End Script Check ---

  // --- Determine User for Service ---
  // Attempt to determine the user who invoked `sudo` to run the service as that user.
  // This is generally safer than running as root if not strictly necessary.
  // Falls back to 'root' if determination fails.
  let serviceUser = 'root'; // Default to root
  try {
    // `logname` usually gives the original user who logged in.
    const { stdout: lognameOutput } = await execPromise('logname');
    const potentialUser = lognameOutput.trim();
    if (potentialUser) {
      serviceUser = potentialUser;
      console.log(
        `[Sys Mgr setAutostart] Determined sudo invoking user via logname: ${serviceUser}`
      );
    } else {
      // Fallback using `whoami` might work in some contexts if logname fails
      console.warn(
        "[Sys Mgr setAutostart] 'logname' empty, trying 'whoami'..."
      );
      const { stdout: whoamiOutput } = await execPromise('whoami');
      const whoamiUser = whoamiOutput.trim();
      if (whoamiUser && whoamiUser !== 'root') {
        // Avoid setting to root if whoami returns root directly
        serviceUser = whoamiUser;
        console.log(
          `[Sys Mgr setAutostart] Determined user via whoami: ${serviceUser}`
        );
      } else {
        console.warn(
          "[Sys Mgr setAutostart] Could not determine non-root user, defaulting service user to 'root'."
        );
        serviceUser = 'root'; // Ensure fallback is explicit
      }
    }
  } catch (userError) {
    console.warn(
      `[Sys Mgr setAutostart] Error determining invoking user, defaulting service user to 'root'. Error: ${userError}`
    );
    serviceUser = 'root'; // Ensure fallback on error
  }
  // --- End Determine User ---

  // --- Construct NVM Path (if applicable) ---
  // This assumes a standard NVM installation in the determined user's home directory.
  // The Node version (e.g., v23.10.0) MUST match the project's required version (.nvmrc)
  // and MUST be installed for the `serviceUser`.
  // This path is used to set the PATH environment variable within the service definition,
  // crucial if `nodePath` uses `/usr/bin/env node` or if the script relies on global npm packages.
  // TODO: Make the Node version dynamic based on .nvmrc? Requires reading the file.
  const nvmDir = `/home/${serviceUser}/.nvm`;
  const nvmNodeVersion = 'v23.10.0'; // Hardcoded based on .nvmrc - ensure consistency!
  const nvmNodePath = `${nvmDir}/versions/node/${nvmNodeVersion}/bin`;
  // Prepend the NVM path to the standard system PATH. Adjust if necessary.
  const pathEnv = `PATH=/usr/bin:/usr/local/bin:${nvmNodePath}`;
  console.log(
    `[Sys Mgr setAutostart] Using PATH environment for service: ${pathEnv}`
  );
  // --- End NVM Path ---

  // --- Systemd Service File Content ---
  // Defines the unit configuration for systemd.
  const serviceContent = `
[Unit]
Description=${description}
# Ensures the service starts after network interfaces are up. Critical if the app needs network.
After=network.target network-online.target
Wants=network-online.target # Stronger dependency on network being fully online

[Service]
Type=simple
# Command to execute. Uses the specified nodePath and the scriptPath.
ExecStart=${nodePath} ${scriptPath}
# Set the working directory to the directory containing the script. Important for relative paths in the script.
WorkingDirectory=${path.dirname(scriptPath)}
# Restart the service automatically if it fails.
Restart=on-failure
# Wait 5 seconds before attempting a restart.
RestartSec=5s
# Run the service as the determined user (or root fallback).
User=${serviceUser}
# Run the service under the user's primary group.
Group=${serviceUser}
# Set environment variables for the service process.
Environment="NODE_ENV=production"
# Set the PATH to include the NVM node version. Critical for finding the correct Node binary.
Environment="${pathEnv}"
# Redirect standard output and error to the systemd journal for logging (view with journalctl -u serviceName).
StandardOutput=journal
StandardError=journal

[Install]
# Enable the service for the multi-user target (standard system startup).
WantedBy=multi-user.target
  `.trim(); // Remove leading/trailing whitespace
  // --- End Service File Content ---

  const serviceFilePath = path.join(SYSTEMD_PATH, serviceName);

  try {
    // 1. Write the service file content to the systemd directory.
    console.log(
      `[Sys Mgr setAutostart] Writing service file to: ${serviceFilePath}`
    );
    // Use mode 0o644 (owner read/write, group/other read) - standard for systemd units.
    await fs.writeFile(serviceFilePath, serviceContent, {
      encoding: 'utf8',
      mode: 0o644,
    });
    console.log(`[Sys Mgr setAutostart] Service file ${serviceName} created.`);

    // 2. Reload systemd daemon to make it aware of the new/changed service file.
    await runCommand('systemctl daemon-reload');
    console.log('[Sys Mgr setAutostart] Systemd daemon reloaded.');

    // 3. Enable the service, creating the necessary symlinks for it to start on boot.
    await runCommand(`systemctl enable ${serviceName}`);
    console.log(
      `[Sys Mgr setAutostart] Service ${serviceName} enabled successfully.`
    );
  } catch (error: any) {
    console.error(
      `[Sys Mgr setAutostart] Failed to set up autostart service "${serviceName}".`
    );
    // --- Cleanup on Failure ---
    // Attempt to remove the potentially created service file if setup fails midway.
    try {
      await fs.unlink(serviceFilePath);
      console.log(
        `[Sys Mgr Cleanup] Cleaned up potentially created service file: ${serviceFilePath}`
      );
    } catch (cleanupError: any) {
      // Ignore ENOENT (file not found) errors during cleanup, but log others.
      if (cleanupError.code !== 'ENOENT') {
        console.error(
          `[Sys Mgr Cleanup] Error during cleanup: ${cleanupError.message}`
        );
      }
    }
    // --- End Cleanup ---
    throw new Error(`Failed to set autostart: ${error.message}`); // Rethrow the original error
  }
}

/**
 * Disables and removes a systemd service file configured for autostart.
 * IMPORTANT: Requires root privileges (run the calling script with `sudo`).
 *
 * @param {string} serviceName - The name of the service to remove (e.g., 'my-script.service').
 * @returns {Promise<void>} Resolves when the service is disabled and removed successfully.
 * @throws {Error} If disabling or removal fails, or the service name is invalid.
 */
export async function removeAutostart(serviceName: string): Promise<void> {
  if (!isValidServiceName(serviceName)) {
    throw new Error(
      `Invalid service name format: "${serviceName}". Should end with '.service'.`
    );
  }
  // Note: Permission warnings are handled by the calling scripts

  const serviceFilePath = path.join(SYSTEMD_PATH, serviceName);

  try {
    // 1. Disable the service (prevent it from starting on boot).
    // Use `--now` to also stop the service if it is currently running.
    try {
      await runCommand(`systemctl disable --now ${serviceName}`);
      console.log(
        `[Sys Mgr removeAutostart] Service ${serviceName} disabled and stopped.`
      );
    } catch (disableError: any) {
      // `systemctl disable` can fail if the service wasn't enabled or doesn't exist.
      // We should treat these "failures" as warnings and proceed with file removal.
      const msg = (disableError?.message ?? '').toLowerCase();
      const stderr = (disableError?.stderr ?? '').toLowerCase();
      const isNotFoundError =
        msg.includes('does not exist') ||
        stderr.includes('does not exist') ||
        msg.includes('no such file or directory') ||
        stderr.includes('no such file or directory') ||
        msg.includes('not loaded') || // Service exists but isn't active
        stderr.includes('not loaded') ||
        msg.includes('no vendor preset') || // Another possible message indicating not enabled
        stderr.includes('no vendor preset');

      if (isNotFoundError) {
        // Service wasn't enabled or found, which is acceptable for removal.
        console.log(
          `[Sys Mgr removeAutostart] Service ${serviceName} was not found or not loaded/enabled. Proceeding with cleanup.`
        );
      } else {
        // Log other disable errors as warnings but don't stop the removal process.
        console.warn(
          `[Sys Mgr removeAutostart] Warning during disable command (may indicate service wasn't running or enabled): ${disableError.message}`
        );
        // Decide whether to re-throw based on error severity. For now, allow cleanup.
        // throw disableError;
      }
    }

    // 2. Remove the service file from the systemd directory.
    try {
      await fs.unlink(serviceFilePath);
      console.log(
        `[Sys Mgr removeAutostart] Service file ${serviceFilePath} removed.`
      );
    } catch (unlinkError: any) {
      // If the file doesn't exist (ENOENT), it's fine (might have failed creation or already removed).
      if (unlinkError.code === 'ENOENT') {
        console.log(
          `[Sys Mgr removeAutostart] Service file ${serviceFilePath} did not exist.`
        );
      } else {
        // Other file system errors during unlink are problematic.
        console.error(
          `[Sys Mgr removeAutostart] Error removing service file ${serviceFilePath}: ${unlinkError.message}`
        );
        throw unlinkError; // Re-throw serious file errors
      }
    }

    // 3. Reload systemd daemon to apply the changes (recognize the file removal).
    await runCommand('systemctl daemon-reload');
    console.log('[Sys Mgr removeAutostart] Systemd daemon reloaded.');

    console.log(
      `[Sys Mgr removeAutostart] Autostart service ${serviceName} removed successfully.`
    );
  } catch (error: any) {
    console.error(
      `[Sys Mgr removeAutostart] Failed to remove autostart service "${serviceName}".`
    );
    // Avoid wrapping the error message multiple times if it was already thrown
    if (
      !(
        error instanceof Error &&
        error.message.startsWith('Failed to remove autostart:')
      )
    ) {
      throw new Error(`Failed to remove autostart: ${error.message}`);
    } else {
      throw error; // Re-throw the original specific error
    }
  }
}
