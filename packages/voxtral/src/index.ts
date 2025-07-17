import { ensureVoxtralRunning, stopVoxtralService } from './dockerManager.js';

let isRunning = false;

async function main() {
  console.log('--- Voxtral Service Manager ---');
  try {
    await ensureVoxtralRunning();
    isRunning = true;
    console.log('✅ Voxtral service manager initialization successful.');
    console.log(
      '   (Manager process will keep running to handle shutdown signals)'
    );
    setInterval(() => {}, 1 << 30);
  } catch (error: any) {
    console.error(
      '❌ Fatal Error during Voxtral service startup:',
      error.message
    );
    console.error('   >>> API calls to Voxtral will likely fail. <<<');
    process.exit(1);
  }
}

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(
    `\n�� Received ${signal}. Initiating Voxtral service shutdown...`
  );

  if (isRunning) {
    try {
      await stopVoxtralService();
      console.log(
        '[Voxtral Manager] Voxtral service container stop command issued.'
      );
    } catch (error) {
      console.error(
        '[Voxtral Manager] Error during Docker stop on shutdown:',
        error
      );
    }
  }
  console.log('🚪 Voxtral Service Manager process is exiting.');
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
