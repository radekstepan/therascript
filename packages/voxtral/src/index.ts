// Entry point process that manages the Voxtral vLLM Docker service lifecycle.
// Entry point for managing the Voxtral vLLM server lifecycle during dev

import { ensureVoxtralRunning, stopVoxtralService } from './dockerManager.js';

let isRunning = false;
let isShuttingDown = false;

async function main() {
  console.log('--- Voxtral Service Manager ---');
  try {
    await ensureVoxtralRunning();
    isRunning = true;
    console.log('✅ Voxtral service manager initialized.');
    console.log('   (Manager will keep running to handle shutdown signals)');

    // keep-alive
    setInterval(() => {}, 1 << 30);
  } catch (error: any) {
    console.error('❌ Fatal error during Voxtral startup:', error.message);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  if (isShuttingDown) {
    console.log(
      `[Voxtral Manager] Shutdown already in progress, ignoring ${signal}`
    );
    return;
  }
  isShuttingDown = true;
  console.log(`\n🚦 Received ${signal}. Shutting down Voxtral service...`);
  if (isRunning) {
    try {
      await stopVoxtralService();
      console.log('[Voxtral Manager] Stop command issued to container.');
    } catch (err) {
      console.error('[Voxtral Manager] Error while stopping container:', err);
    }
  } else {
    console.log(
      '[Voxtral Manager] Skipping Docker stop as initial startup did not complete.'
    );
  }
  console.log('🚪 Voxtral Service Manager exiting.');
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
  if (!isShuttingDown) {
    console.error(`[Voxtral Manager] Exited unexpectedly with code ${code}.`);
  } else {
    console.log(`[Voxtral Manager] Final process exit with code ${code}.`);
  }
});

main();
