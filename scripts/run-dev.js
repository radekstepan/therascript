const { spawn } = require('child_process');
const { exec } = require('node:child_process');
const util = require('node:util');
const execPromise = util.promisify(exec);

const OLLAMA_CONTAINER_NAME = 'ollama_server_managed';
const WHISPER_CONTAINER_NAME = 'therascript_whisper_service';

console.log('[RunDev] Starting development environment...');

// --- Docker Cleanup Function ---
async function stopAndRemoveContainer(containerName) {
    console.log(`[RunDev Cleanup] Attempting to stop and remove container: ${containerName}...`);
    try {
        console.log(`[RunDev Cleanup] Sending stop command to ${containerName}...`);
        // Use docker stop with a timeout
        await execPromise(`docker stop -t 5 ${containerName}`);
        console.log(`[RunDev Cleanup] Container ${containerName} stopped.`);
    } catch (error) {
        // Check common errors indicating container is already stopped or gone
        if (error.stderr?.includes('No such container') || error.message?.includes('No such container') || error.stderr?.includes('is not running')) {
            console.log(`[RunDev Cleanup] Container ${containerName} was not running or already stopped.`);
        } else {
            console.error(`[RunDev Cleanup] Failed to stop container ${containerName}:`, error.stderr || error.message);
            // Continue to removal attempt even if stop fails
        }
    }
    try {
        // Use docker rm
        console.log(`[RunDev Cleanup] Removing container ${containerName}...`);
        await execPromise(`docker rm ${containerName}`);
        console.log(`[RunDev Cleanup] Container ${containerName} removed.`);
    } catch (error) {
        if (error.stderr?.includes('No such container') || error.message?.includes('No such container')) {
            console.log(`[RunDev Cleanup] Container ${containerName} already removed or never existed.`);
        } else {
            console.error(`[RunDev Cleanup] Error removing ${containerName}:`, error.stderr || error.message);
        }
    }
}

async function cleanupDocker() {
    console.log('[RunDev Cleanup] Running Docker container cleanup...');
    // Stop/remove containers - can run in parallel
    await Promise.allSettled([
        stopAndRemoveContainer(OLLAMA_CONTAINER_NAME),
        stopAndRemoveContainer(WHISPER_CONTAINER_NAME) // Let this script handle both now
    ]);
    console.log('[RunDev Cleanup] Docker cleanup process finished.');
}
// --- End Docker Cleanup Function ---


// Command to run using concurrently
const concurrentlyArgs = [
    'concurrently',
    '--kill-others-on-fail', // Important: tries to kill others if one fails
    // '--handle-input', // May help with input/signal handling in some cases
    '--names', 'API,UI,WHISPER',
    '--prefix-colors', 'bgBlue.bold,bgMagenta.bold,bgCyan.bold',
    // Commands need to be properly quoted for shell execution
    '"yarn:dev:api"',
    '"yarn:dev:ui"',
    '"yarn:start:whisper"' // Keep using the whisper start script
];

// Spawn concurrently
// Use { shell: true } for better cross-platform compatibility and quoting
const devProcess = spawn(concurrentlyArgs[0], concurrentlyArgs.slice(1), {
    stdio: 'inherit', // Pass through stdio
    shell: true
});

devProcess.on('spawn', () => {
    console.log('[RunDev] Concurrently process spawned successfully.');
});

devProcess.on('error', (error) => {
    console.error('[RunDev] Error spawning concurrently:', error);
    cleanupDocker().finally(() => process.exit(1)); // Attempt cleanup on spawn error
});

devProcess.on('close', (code, signal) => {
    console.log(`[RunDev] Concurrently process exited with code ${code}, signal ${signal}.`);
    // Cleanup might be redundant if signal handler runs, but good fallback
    if (!isShuttingDown) {
        console.log('[RunDev] Concurrently closed unexpectedly, running cleanup...');
        cleanupDocker().finally(() => {
            process.exit(code ?? 1);
        });
    }
});


// --- Graceful Shutdown Handling for this Wrapper Script ---
let isShuttingDown = false;
async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[RunDev] Received ${signal}. Initiating shutdown...`);

    // 1. Kill the concurrently process (send SIGKILL for more forceful termination)
    console.log('[RunDev] Terminating concurrently process...');
    if (devProcess && !devProcess.killed) {
        // Using SIGKILL as SIGTERM/SIGINT might not reliably kill all children managed by yarn/lerna/nodemon
        const killed = devProcess.kill('SIGKILL');
        console.log(`[RunDev] Kill signal sent to concurrently process (PID: ${devProcess.pid}). Success: ${killed}`);
    } else {
        console.log('[RunDev] Concurrently process already exited or not running.');
    }

    // Wait a moment for processes to terminate
    await new Promise(resolve => setTimeout(resolve, 1500)); // Increased wait time slightly

    // 2. Run Docker cleanup *after* attempting to kill children
    await cleanupDocker();

    console.log('[RunDev] Shutdown complete. Exiting wrapper script.');
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
