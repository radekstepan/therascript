// Purpose: Provides a function to initiate a system shutdown on Linux.

import { exec } from 'child_process'; // Import exec for running shell commands
import util from 'util'; // Import util for promisify

// Promisify the exec function for easier async/await usage
const execPromise = util.promisify(exec);

/**
 * Initiates a graceful system shutdown on a Linux system.
 * Executes the `shutdown -P now` command, which powers off the machine immediately.
 *
 * IMPORTANT: Requires root privileges (the process calling this function,
 * or the script wrapping it, must be run with `sudo`).
 *
 * @returns {Promise<string>} A promise resolving with the command's standard output upon successful dispatch.
 *                            Note: The system may shut down before this promise fully resolves or the caller receives the result.
 * @throws {Error} If the shutdown command fails (e.g., permission denied, command not found).
 */
export async function shutdownSystem(): Promise<string> {
  // Command breakdown:
  // `shutdown`: The command-line utility for system shutdown/reboot.
  // `-P`: Specifies that the system should power off after shutting down.
  // `now`: Specifies that the shutdown should occur immediately.
  const command = 'shutdown -P now';

  console.log(`[Shutdown Func] Attempting to execute command: "${command}"`);
  // Remind the developer/user about the sudo requirement.
  console.warn(
    '[Shutdown Func] Ensure this function is called with root privileges (sudo)!'
  );

  try {
    // Execute the command and capture stdout/stderr
    const { stdout, stderr } = await execPromise(command);

    // Log any output from the command. stderr might contain broadcast messages.
    if (stderr) {
      console.warn(`[Shutdown Func] Shutdown command stderr: ${stderr}`);
    }
    console.log(
      `[Shutdown Func] Shutdown command executed successfully. System is shutting down...`
    );
    console.log(`[Shutdown Func] stdout: ${stdout}`);

    // Return stdout if successful (though caller might not receive it)
    return stdout;
  } catch (error: any) {
    // Handle errors during command execution
    console.error(
      `[Shutdown Func] Failed to execute shutdown command: ${error.message}`
    );
    if (error.stderr) console.error(`[Shutdown Func] stderr: ${error.stderr}`);
    if (error.stdout) console.error(`[Shutdown Func] stdout: ${error.stdout}`); // Log stdout on error too

    // Throw a more specific error to be caught by the caller
    throw new Error(`System shutdown failed: ${error.message}`);
  }
}
