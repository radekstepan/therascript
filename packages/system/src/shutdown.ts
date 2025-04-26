// shutdown.ts

import { exec } from 'child_process';
import util from 'util';

// Promisify the exec function for easier async/await usage
const execPromise = util.promisify(exec);

/**
 * Initiates a graceful system shutdown on a Linux system.
 *
 * Sends the 'shutdown -P now' command to the shell.
 * Requires root privileges (run with `sudo`).
 *
 * @returns {Promise<string>} A promise resolving with stdout on successful command dispatch.
 * @throws {Error} If the shutdown command fails.
 */
export async function shutdownSystem(): Promise<string> {
  const command = 'shutdown -P now';
  console.log(`Attempting to execute command: "${command}"`);
  console.warn('Ensure this script is run with root privileges (sudo)!');

  try {
    const { stdout, stderr } = await execPromise(command);
    if (stderr) {
      console.warn(`Shutdown command stderr: ${stderr}`);
    }
    console.log(`Shutdown command executed successfully. System is shutting down...`);
    console.log(`stdout: ${stdout}`);
    return stdout;
  } catch (error: any) {
    console.error(`Failed to execute shutdown command: ${error.message}`);
    if (error.stderr) console.error(`stderr: ${error.stderr}`);
    if (error.stdout) console.error(`stdout: ${error.stdout}`);
    throw new Error(`System shutdown failed: ${error.message}`);
  }
}
