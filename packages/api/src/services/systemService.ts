// packages/api/src/services/systemService.ts
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';
import { InternalServerError, ApiError } from '../errors.js';

const execPromise = util.promisify(exec);

// --- Determine absolute path to the shutdown trigger script ---
let shutdownScriptPath: string | null = null;
try {
    const __filename = fileURLToPath(import.meta.url);
    // Adjust path based on build output location ('dist/')
    const apiPackageDir = path.resolve(__filename, '../../..'); // Navigate up from packages/api/dist/services
    const systemPackageDir = path.resolve(apiPackageDir, '../system'); // Go to sibling system package
    shutdownScriptPath = path.resolve(systemPackageDir, 'dist/shutdownTrigger.js'); // Point to the compiled script
    console.log(`[SystemService] Determined shutdown trigger script path: ${shutdownScriptPath}`);
    // Basic check if the path seems plausible (e.g., contains 'system' and 'dist')
    if (!shutdownScriptPath.includes('system') || !shutdownScriptPath.includes('dist')) {
        throw new Error("Calculated path seems incorrect.");
    }
} catch (error) {
    console.error("[SystemService] FATAL ERROR determining shutdown script path:", error);
    shutdownScriptPath = null; // Ensure it's null if resolution failed
}
// --- End Path Determination ---

/**
 * Executes the system shutdown command.
 * IMPORTANT: This requires the API process to have passwordless sudo permissions
 * specifically for executing the `shutdownTrigger.js` script with Node.
 * This is a significant security risk and should be carefully configured.
 *
 * Example visudo configuration (use `sudo visudo` to edit):
 * # Allow the user running the API server (e.g., 'www-data', 'nodeuser') to run the specific script as root
 * your_api_user ALL=(root) NOPASSWD: /usr/bin/node /absolute/path/to/project/packages/system/dist/shutdownTrigger.js
 *
 * Replace 'your_api_user' and the paths accordingly.
 *
 * @throws {InternalServerError} If the shutdown command fails or the script path is invalid.
 */
export const executeShutdown = async (): Promise<{ message: string }> => {
    if (!shutdownScriptPath) {
        throw new InternalServerError("Shutdown script path configuration is invalid. Cannot execute shutdown.");
    }

    // Construct the command with sudo and the absolute path
    const command = `sudo /usr/bin/node ${shutdownScriptPath}`; // Use absolute path to node if needed

    console.warn("******************************************************");
    console.warn("!!! SECURITY WARNING !!!");
    console.warn("Attempting to execute shutdown command via sudo:");
    console.warn(`    ${command}`);
    console.warn("This requires the API process user to have passwordless");
    console.warn("sudo permissions for this specific command.");
    console.warn("Ensure this is properly configured and secured.");
    console.warn("******************************************************");

    try {
        const { stdout, stderr } = await execPromise(command);
        console.log(`[SystemService Shutdown] STDOUT: ${stdout}`);
        if (stderr) {
            // Shutdown commands might output info to stderr (like broadcast messages)
            console.warn(`[SystemService Shutdown] STDERR: ${stderr}`);
        }
        // If the command executes without throwing, assume it was successful
        // The system will shut down before we get much further response.
        return { message: "Shutdown command issued successfully." };

    } catch (error: any) {
        console.error(`[SystemService Shutdown] Failed to execute command: ${command}`);
        console.error(`[SystemService Shutdown] Error Code: ${error.code}`);
        console.error(`[SystemService Shutdown] Error Signal: ${error.signal}`);
        if (error.stderr) console.error(`[SystemService Shutdown] STDERR: ${error.stderr}`);
        if (error.stdout) console.error(`[SystemService Shutdown] STDOUT: ${error.stdout}`); // Log stdout too, might have sudo prompt failure

        // Specific error handling
        if (error.message?.includes('command not found') || error.code === 127) {
            throw new InternalServerError('Shutdown command failed: Node or script not found.', error);
        }
        if (error.stderr?.includes('sudo: a password is required')) {
            throw new ApiError(503, 'Shutdown failed: Server lacks necessary permissions (sudo configuration required).', error.stderr);
        }
        if (error.message?.includes('permission denied')) {
             throw new ApiError(503, 'Shutdown failed: Permission denied executing script.', error.message);
        }

        throw new InternalServerError('Failed to execute system shutdown command.', error);
    }
};
