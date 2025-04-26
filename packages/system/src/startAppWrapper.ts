// packages/system/src/startAppWrapper.ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Determine project root directory relative to this script
const __filename = fileURLToPath(import.meta.url);
// Adjust based on build output directory (e.g., 'dist')
const systemPackageDir = path.resolve(__filename, '../..'); // Assumes dist/startAppWrapper.js
const projectRootDir = path.resolve(systemPackageDir, '../..'); // Navigate up twice from packages/system to root

console.log(`[Autostart Wrapper] Script directory: ${path.dirname(__filename)}`);
console.log(`[Autostart Wrapper] System package directory: ${systemPackageDir}`);
console.log(`[Autostart Wrapper] Determined Project Root: ${projectRootDir}`);

// Verify project root
if (!fs.existsSync(path.join(projectRootDir, 'lerna.json')) || !fs.existsSync(path.join(projectRootDir, 'package.json'))) {
    console.error(`[Autostart Wrapper] Error: Could not verify project root at ${projectRootDir}. lerna.json or package.json missing.`);
    process.exit(1);
}

// --- Find yarn executable ---
// Try common locations or rely on PATH
const yarnPath = 'yarn'; // Simplest approach - relies on yarn being in PATH for the service user
// Alternative (more complex): try specific paths like /usr/local/bin/yarn, /usr/bin/yarn, etc.
// --- End Find yarn ---


console.log(`[Autostart Wrapper] Starting 'yarn start' in ${projectRootDir} using '${yarnPath}'...`);

const yarnArgs = ['start']; // Command to run

const child = spawn(yarnPath, yarnArgs, {
    cwd: projectRootDir,
    stdio: 'inherit', // Pass through stdin, stdout, stderr
    shell: true, // Use shell to potentially resolve yarn path issues
    env: {
        ...process.env, // Inherit environment variables
        NODE_ENV: 'production', // Ensure production environment
    },
});

child.on('spawn', () => {
    console.log(`[Autostart Wrapper] 'yarn start' process spawned successfully (PID: ${child.pid}).`);
});

child.on('error', (error) => {
    console.error(`[Autostart Wrapper] Error spawning 'yarn start':`, error);
    process.exit(1); // Exit wrapper if spawn fails
});

child.on('close', (code, signal) => {
    console.log(`[Autostart Wrapper] 'yarn start' process exited with code ${code}, signal ${signal}.`);
    // Optional: Decide if the wrapper should exit or retry based on the code/signal
    process.exit(code ?? 1);
});

// Handle signals for the wrapper itself
process.on('SIGINT', () => {
    console.log('[Autostart Wrapper] Received SIGINT. Terminating child process...');
    if (child && !child.killed) child.kill('SIGTERM'); // Send SIGTERM to the child first
    setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL'); // Force kill if needed
        process.exit(0);
    }, 2000); // Wait 2s
});

process.on('SIGTERM', () => {
    console.log('[Autostart Wrapper] Received SIGTERM. Terminating child process...');
     if (child && !child.killed) child.kill('SIGTERM');
     setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
        process.exit(0);
     }, 2000);
});
