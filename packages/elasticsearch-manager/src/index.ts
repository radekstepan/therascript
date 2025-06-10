import {
  ensureElasticsearchRunning,
  stopElasticsearchService,
} from './dockerManager.js';

let isRunning = false;

async function main() {
  console.log('--- Elasticsearch Service Manager ---');
  try {
    await ensureElasticsearchRunning();
    isRunning = true;
    console.log('✅ Elasticsearch service manager initialization successful.');
    console.log(
      '   (Manager process will keep running to handle shutdown signals)'
    );
    console.log(
      '   (Starting keep-alive interval - press Ctrl+C to stop dev environment)'
    );
    setInterval(() => {}, 1 << 30);
  } catch (error: any) {
    console.error(
      '❌ Fatal Error during Elasticsearch service startup:',
      error.message
    );
    console.error('   >>> API calls to Elasticsearch will likely fail. <<<');
    process.exit(1);
  }
}

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) {
    console.log(
      `[ES Manager] Shutdown already in progress, ignoring signal: ${signal}`
    );
    return;
  }
  isShuttingDown = true;
  console.log(
    `\n🚦 Received ${signal}. Initiating Elasticsearch service shutdown...`
  );

  if (isRunning) {
    try {
      await stopElasticsearchService();
      console.log(
        '[ES Manager] Elasticsearch service container stop command issued.'
      );
    } catch (error) {
      console.error(
        '[ES Manager] Error during Docker stop on shutdown:',
        error
      );
    }
  } else {
    console.log(
      '[ES Manager] Skipping Docker stop as initial startup did not complete successfully.'
    );
  }
  console.log('🚪 Elasticsearch Service Manager process is exiting.');
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', (code) => {
  if (!isShuttingDown) {
    console.error(`[ES Manager] Exited unexpectedly with code ${code}.`);
    console.error(
      `   If the Elasticsearch container was running, consider stopping it manually.`
    );
  } else {
    console.log(`[ES Manager] Final process exit with code ${code}.`);
  }
});

main();
