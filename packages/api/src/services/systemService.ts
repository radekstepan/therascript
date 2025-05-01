// Purpose: Provides functions for interacting with the operating system,
//          specifically for triggering a system shutdown.
import { exec } from 'node:child_process'; // Node.js module for running external commands
import path from 'node:path'; // Node.js module for working with file paths
import { fileURLToPath } from 'node:url'; // Helper to convert file URL to path
import util from 'node:util'; // Node.js utilities, used here for promisify
import { InternalServerError, ApiError } from '../errors.js'; // Custom error classes

// Promisify `exec` to use async/await syntax
const execPromise = util.promisify(exec);

// --- Determine absolute path to the shutdown trigger script ---
// The actual shutdown logic is delegated to a separate script (`shutdownTrigger.js`)
// within the `system` package. This service needs to find the absolute path to that script.
let shutdownScriptPath: string | null = null;
try {
  // Get the path of the current file (systemService.ts)
  const __filename = fileURLToPath(import.meta.url);
  // Resolve the root directory of the 'api' package relative to the built output location.
  // Assumes this file is in `packages/api/dist/services/` after build.
  const apiPackageDir = path.resolve(__filename, '../../..');
  // Navigate to the sibling 'system' package directory.
  const systemPackageDir = path.resolve(apiPackageDir, '../system');
  // Construct the path to the *compiled* shutdown trigger script within the 'system' package's dist folder.
  shutdownScriptPath = path.resolve(
    systemPackageDir,
    'dist/shutdownTrigger.js'
  );
  console.log(
    `[SystemService] Determined shutdown trigger script path: ${shutdownScriptPath}`
  );
  // Basic sanity check on the calculated path
  if (
    !shutdownScriptPath.includes('system') ||
    !shutdownScriptPath.includes('dist')
  ) {
    throw new Error(
      'Calculated path seems incorrect. Check relative path assumptions.'
    );
  }
} catch (error) {
  // If path resolution fails, log a fatal error and set the path to null.
  // The executeShutdown function will fail gracefully if the path is null.
  console.error(
    '[SystemService] FATAL ERROR determining shutdown script path:',
    error
  );
  shutdownScriptPath = null;
}
// --- End Path Determination ---

/**
 * Executes the system shutdown command by running the `shutdownTrigger.js` script via `sudo`.
 *
 * IMPORTANT: This function requires significant security considerations and setup.
 * The Node.js process running the API server MUST have pre-configured passwordless `sudo`
 * permissions specifically for executing the target `shutdownTrigger.js` script with Node.
 * Failure to configure this correctly will result in permission errors.
 *
 * Example `visudo` configuration (use `sudo visudo` to edit):
 * ```
 * # Allow the user running the API server (e.g., 'www-data', 'nodeuser') to run the specific script as root
 * your_api_user ALL=(root) NOPASSWD: /usr/bin/node /absolute/path/to/project/packages/system/dist/shutdownTrigger.js
 * ```
 * Replace 'your_api_user' and the absolute paths with your actual user and paths.
 *
 * @returns {Promise<{ message: string }>} A promise resolving to a success message if the command is dispatched.
 * @throws {InternalServerError} If the shutdown script path is invalid or the command fails for reasons other than permissions.
 * @throws {ApiError} (Status 503) If the command fails due to missing `sudo` permissions or password requirement.
 */
export const executeShutdown = async (): Promise<{ message: string }> => {
  // First, check if the script path was determined successfully.
  if (!shutdownScriptPath) {
    throw new InternalServerError(
      'Shutdown script path configuration is invalid. Cannot execute shutdown.'
    );
  }

  // Construct the command: `sudo /path/to/node /path/to/shutdownTrigger.js`
  // Ensure you use the correct, absolute path to the node executable if it's not in the default PATH for the root user.
  // Typically `/usr/bin/node` or `/usr/local/bin/node`.
  const command = `sudo /usr/bin/node ${shutdownScriptPath}`;

  // Log a prominent security warning whenever this function is called.
  console.warn('******************************************************');
  console.warn('!!! SECURITY WARNING !!!');
  console.warn('Attempting to execute shutdown command via sudo:');
  console.warn(`    ${command}`);
  console.warn('This requires the API process user to have passwordless');
  console.warn('sudo permissions for this specific command.');
  console.warn('Ensure this is properly configured and secured.');
  console.warn('******************************************************');

  try {
    // Execute the command using the promisified exec
    const { stdout, stderr } = await execPromise(command);

    // Log stdout and stderr from the command execution.
    // Stderr might contain informational messages from `shutdown` command itself.
    console.log(`[SystemService Shutdown] STDOUT: ${stdout}`);
    if (stderr) {
      console.warn(`[SystemService Shutdown] STDERR: ${stderr}`);
    }

    // If the command executes without throwing an error, assume it was successful.
    // The system will likely shut down before the API can fully process further.
    return { message: 'Shutdown command issued successfully.' };
  } catch (error: any) {
    // --- Error Handling for `execPromise` ---
    console.error(
      `[SystemService Shutdown] Failed to execute command: ${command}`
    );
    console.error(`[SystemService Shutdown] Error Code: ${error.code}`); // Exit code of the child process
    console.error(`[SystemService Shutdown] Error Signal: ${error.signal}`); // Signal that terminated the process (if any)
    // Log stdout/stderr from the failed command, as they might contain useful error info (e.g., sudo prompt)
    if (error.stderr)
      console.error(`[SystemService Shutdown] STDERR: ${error.stderr}`);
    if (error.stdout)
      console.error(`[SystemService Shutdown] STDOUT: ${error.stdout}`);

    // --- Specific Error Interpretation ---
    // Check for common failure modes and throw appropriate API errors.

    // 'command not found' or exit code 127 typically means node or the script itself wasn't found.
    if (error.message?.includes('command not found') || error.code === 127) {
      throw new InternalServerError(
        `Shutdown command failed: Node executable or script not found at specified path. Command: ${command}`,
        error
      );
    }
    // Check stderr for the classic sudo password prompt.
    if (
      error.stderr?.includes('sudo: a password is required') ||
      error.stderr?.includes(
        'sudo: no tty present and no askpass program specified'
      )
    ) {
      throw new ApiError(
        503,
        'Shutdown failed: Server lacks necessary permissions (sudo configuration required).',
        error.stderr
      );
    }
    // General permission denied errors.
    if (error.message?.includes('permission denied') || error.code === 1) {
      // Exit code 1 can sometimes indicate permission issues with sudo
      throw new ApiError(
        503,
        'Shutdown failed: Permission denied executing script or sudo command.',
        error.message
      );
    }

    // Fallback for other errors.
    throw new InternalServerError(
      'Failed to execute system shutdown command.',
      error
    );
  }
};
