// Configure the database connection before any other modules are loaded
import { configureDb } from '@therascript/db';
import { configureFileService } from '@therascript/services';
import config from '@therascript/config';
import fs from 'node:fs';
import path from 'node:path';
import app, { appVersion, esClient } from './app.js';
import http from 'node:http';
import { ReadableStream } from 'node:stream/web';
import {
  getActiveModel,
  getConfiguredContextSize,
} from './services/activeModelService.js';
import { getLlmRuntime } from './services/llamaCppRuntime.js';
import {
  unloadActiveModel,
  unloadModelAtUrl,
  syncModelStateOnBoot,
} from './services/llamaCppService.js';
import {
  getLoadedBaseUrls as getTrackedLoadedBaseUrls,
  clear as clearLoadedModelsTracker,
} from './services/loadedModelsTracker.js';
import { closeDb, isDbUnlocked } from '@therascript/db';
import { closeQueues } from './services/jobQueueService.js';
import {
  initializeIndices,
  checkEsHealth,
  closeElasticsearchClient,
} from '@therascript/elasticsearch-client';
import { getVaultManager } from './services/vaultManager.js';
import { CLIENT_IP_HEADER } from './api/vaultHandler.js';

// NOTE: configureDb() runs inside initializeServices() now — vault mode
// must enable (recover layout, select vault vs legacy boot) before the
// database layer is configured.
configureFileService(config.db.uploadsDir);

const ensureDirectoryExists = (dirPath: string, dirNameForLog: string) => {
  if (!fs.existsSync(dirPath)) {
    console.log(`[Config] Creating ${dirNameForLog} directory: ${dirPath}`);
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[Config] Successfully created ${dirNameForLog} directory.`);
    } catch (err) {
      console.error(
        `[Config] FATAL: Error creating ${dirNameForLog} directory at ${dirPath}:`,
        err
      );
      process.exit(1);
    }
  }
};
ensureDirectoryExists(path.dirname(config.db.sqlitePath), 'database');
ensureDirectoryExists(config.db.uploadsDir, 'uploads');

console.log(
  `[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`
);

async function checkLmStudioConnectionOnStartup() {
  const runtime = getLlmRuntime();
  console.log(
    `[Server Startup] Ensuring LM Studio is ready (runtime: ${runtime.type})...`
  );
  try {
    await runtime.ensureReady();
    console.log('[Server Startup] ✅ LM Studio daemon and server are up.');
  } catch (err) {
    console.error('-------------------------------------------------------');
    console.error('[Server Startup] ⚠️ LM Studio failed to start:', err);
    console.error(
      '   LLM features will be unavailable until the service is running.'
    );
    console.error('-------------------------------------------------------');
  }

  // One-shot reconciliation of persisted model state with whatever LM Studio
  // currently has loaded. Runs after the startup attempt regardless of
  // outcome — if LM Studio is down, the sync will detect that and clear
  // stale model + context so the UI doesn't show a phantom loaded model.
  // Never invoked from request handlers: see syncModelStateOnBoot.
  // Skipped while the vault is locked (no database to reconcile with).
  if (!isDbUnlocked()) {
    console.log(
      '[Server Startup] Vault locked: skipping active model state sync until unlock.'
    );
    return;
  }
  try {
    console.log(
      '[Server Startup] Syncing active model state with LM Studio (one-shot)...'
    );
    await syncModelStateOnBoot();
    console.log('[Server Startup] ✅ Active model state synced.');
  } catch (syncErr) {
    console.warn(
      '[Server Startup] ⚠️ Failed to sync active model state:',
      syncErr
    );
  }
}

async function initializeServices() {
  console.log('[Server Startup] Initializing services...');

  // Vault first: recovers the generation layout, resumes interrupted
  // cleanup, and selects vault vs legacy-plaintext boot. Vault mode
  // starts HTTP locked (the database attaches on unlock); the legacy
  // fallback keeps the historical eager-open behavior. Fails closed
  // when a vault exists but cipher support is missing.
  const bootMode = await getVaultManager().enable();
  if (bootMode === 'vault') {
    configureDb({ dbPath: config.db.sqlitePath, isDev: false });
    console.log(
      '[Server Startup] 🔒 Vault mode: HTTP is up but locked; unlock to attach the database.'
    );
  } else {
    configureDb({
      dbPath: config.db.sqlitePath,
      isDev: !config.server.isProduction,
      mode: 'legacy-plaintext',
    });
    console.log('[Server Startup] Legacy fallback boot: opening database.');
    const { db } = await import('@therascript/db');
    db.prepare('SELECT 1').get();
  }

  await checkLmStudioConnectionOnStartup();

  // Vault mode serves search from the in-database FTS5 indexes and keeps
  // no Elasticsearch state; skip the ES dependency entirely.
  if (getVaultManager().isProtectionActive()) {
    console.log(
      '[Server Startup] Vault mode: skipping Elasticsearch (FTS5 search).'
    );
    return;
  }

  try {
    console.log(
      '[Server Startup] Checking Elasticsearch connection and indices...'
    );
    const esIsHealthy = await checkEsHealth(esClient);
    if (esIsHealthy) {
      await initializeIndices(esClient);
      console.log(
        '[Server Startup] ✅ Elasticsearch connection healthy and indices initialized.'
      );
    } else {
      console.error('-------------------------------------------------------');
      console.error(
        '[Server Startup] ⚠️ Elasticsearch service NOT HEALTHY or unreachable.'
      );
      console.error('   Search functionality will be impaired or unavailable.');
      console.error(
        '   Ensure Elasticsearch container is running and healthy (check Docker logs).'
      );
      console.error('-------------------------------------------------------');
    }
  } catch (esInitError) {
    console.error('-------------------------------------------------------');
    console.error(
      '[Server Startup] ❌ Error initializing Elasticsearch client or indices:',
      esInitError
    );
    console.error('   Search functionality will be impaired or unavailable.');
    console.error('-------------------------------------------------------');
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${config.server.port}`;
  const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/';
  const url = `http://${host}${pathAndQuery}`;
  let bodyChunks: Buffer[] = [];
  req
    .on('data', (chunk) => {
      bodyChunks.push(chunk);
    })
    .on('end', async () => {
      const bodyBuffer = Buffer.concat(bodyChunks);
      // Stamp the socket address for vault rate limiting. Assigned here
      // (not trusted from the client): any client-sent value is
      // overwritten with the authoritative remote address.
      const forwardedHeaders: Record<string, string | string[] | undefined> = {
        ...req.headers,
        [CLIENT_IP_HEADER]: req.socket.remoteAddress ?? 'unknown',
      };
      const requestInit: RequestInit = {
        method: req.method,
        headers: forwardedHeaders as HeadersInit,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
            ? bodyBuffer
            : undefined,
      };
      try {
        const response = await app.handle(new Request(url, requestInit));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        // Flush response headers immediately so proxies (nginx, Tailscale
        // Funnel, Cloudflare) and the client's HTTP stack begin forwarding
        // bytes on the very first event-loop tick, instead of waiting for
        // the first res.write() — important for SSE so the browser starts
        // parsing data: lines token-by-token rather than holding the
        // response until the first chunk arrives from upstream.
        res.flushHeaders();
        if (response.body) {
          if (response.body instanceof ReadableStream) {
            for await (const chunk of response.body) {
              res.write(chunk);
              // Optional flush — present on compression wrappers, no-op on
              // plain http.ServerResponse. Call it if it exists to push
              // bytes to the socket immediately on each chunk.
              (res as unknown as { flush?: () => void }).flush?.();
            }
            res.end();
          } else if (
            typeof response.body === 'string' ||
            Buffer.isBuffer(response.body)
          ) {
            res.end(response.body);
          } else {
            res.end(JSON.stringify(await (response as any).json()));
          }
        } else {
          res.end();
        }
      } catch (err) {
        console.error('Error in app.handle or response processing:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        if (!res.writableEnded) {
          res.end(
            JSON.stringify({
              error: 'Internal Server Error during request handling',
            })
          );
        }
      }
    })
    .on('error', (err) => {
      console.error('Request stream error:', err);
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: 'Bad Request stream' }));
      }
    });
});

// Configure server timeouts to handle large file uploads
// Node.js default is often 5 minutes (300,000ms), which can be too short for slow uploads of large audio files.
server.timeout = 0; // Disable idle timeout
server.headersTimeout = 0; // Disable headers timeout
server.requestTimeout = 0; // Disable request timeout (this is likely the 5m timeout)
server.keepAliveTimeout = 0; // Disable keep-alive timeout if needed

initializeServices()
  .then(() => {
    server.listen(config.server.port, config.server.host, () => {
      const vaultMode = getVaultManager().getBootMode() ?? 'legacy-fallback';
      const activeModel = (() => {
        try {
          return isDbUnlocked() ? getActiveModel() : '(locked)';
        } catch {
          return '(unavailable)';
        }
      })();
      const configuredContext = (() => {
        try {
          return isDbUnlocked()
            ? (getConfiguredContextSize() ?? 'default')
            : '(locked)';
        } catch {
          return '(unavailable)';
        }
      })();
      console.log(`-------------------------------------------------------`);
      console.log(
        `🚀 Therapy Analyzer Backend (Elysia/Node) listening on ${config.server.host}:${config.server.port}`
      );
      console.log(`   Version: ${appVersion}`);
      console.log(`   Mode: ${config.server.nodeEnv}`);
      console.log(`   Vault: ${vaultMode}`);
      console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`);
      console.log(`   DB Path: ${config.db.sqlitePath}`);
      console.log(`   LLM URL: ${config.llm.baseURL}`);
      console.log(`   Active Model: ${activeModel} (Active)`);
      console.log(`   Configured Context: ${configuredContext}`);
      console.log(`   Elasticsearch URL: ${config.elasticsearch.url}`);
      console.log(`-------------------------------------------------------`);
      console.log(
        `Access API Docs at: http://localhost:${config.server.port}/api/docs`
      );
      console.log(
        `Health Check: http://localhost:${config.server.port}/api/health`
      );
      console.log(`-------------------------------------------------------`);
    });
  })
  .catch((initError) => {
    console.error('Failed to initialize services:', initError);
    process.exit(1);
  });

let isShuttingDown = false;
let forceExitTimer: ReturnType<typeof setTimeout> | null = null;
async function shutdown(signal: string) {
  if (isShuttingDown) {
    // Second signal (or a crash mid-shutdown): never trap the user in a
    // hanging shutdown. Keys live only in process memory and die here.
    console.log('\n[Server] Shutdown already in progress; forcing exit.');
    process.exit(1);
    return;
  }
  isShuttingDown = true;
  // Backstop above the longest graceful wait (10s request drain + model
  // unloads + blocked keep-alive connections): the vault lock inside
  // completes well before this; if anything hangs, exit anyway.
  forceExitTimer = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out; forcing exit.');
    process.exit(1);
  }, 25_000);
  forceExitTimer.unref?.();
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  try {
    // Stop accepting new connections, then abort active streams so
    // server.close() cannot hang on an open SSE connection. The vault stays
    // open here because model unload reads the active LLM settings from the
    // database; the final lock runs after the unloads below.
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error('[Server] Error closing HTTP server:', err);
          return reject(err);
        }
        console.log('[Server] HTTP server closed.');
        resolve();
      });
    });
    server.closeIdleConnections?.();
    try {
      await getVaultManager().prepareShutdown();
    } catch (err) {
      console.warn('[Server] Error preparing vault shutdown:', err);
    }
    await serverClosed;
    // Unload any loaded models before stopping the runtime
    try {
      await unloadActiveModel();
      console.log('[Server] Active model unloaded.');
    } catch (err) {
      console.warn('[Server] Error unloading active model:', err);
    }
    // Unload any models that were loaded against per-request remote URLs
    // (e.g. one-off analysis jobs) that the active-URL unload above did
    // not touch. Best-effort: failures are logged and shutdown continues.
    const otherLoadedUrls = getTrackedLoadedBaseUrls();
    if (otherLoadedUrls.length > 0) {
      console.log(
        `[Server] Unloading ${otherLoadedUrls.length} additional tracked URL(s): ${otherLoadedUrls.join(', ')}`
      );
      await Promise.allSettled(
        otherLoadedUrls.map(async (url) => {
          try {
            const count = await unloadModelAtUrl(url);
            console.log(
              `[Server] Unloaded ${count} model instance(s) from ${url}`
            );
          } catch (err: any) {
            console.warn(
              `[Server] Failed to unload models from ${url}: ${err.message ?? err}`
            );
          }
        })
      );
    }
    clearLoadedModelsTracker();
    // Stop the LLM runtime (docker container or native process)
    try {
      const runtime = getLlmRuntime();
      if (runtime.stop) {
        await runtime.stop();
        console.log('[Server] LLM runtime stopped.');
      }
    } catch (err) {
      console.warn('[Server] Error stopping LLM runtime:', err);
    }
    await closeQueues();
    // Final vault lock: stops the supervised worker, closes the database,
    // and clears keys. Runs inside the wrapper's shutdown grace window. The
    // direct closeDb covers the legacy fallback boot.
    try {
      await getVaultManager().shutdown();
    } catch (err) {
      console.warn('[Server] Error during vault shutdown:', err);
    }
    closeDb();
    await closeElasticsearchClient();
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err);
  } finally {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    console.log('[Server] Shutdown complete.');
    process.exit(
      signal === 'SIGINT' ? 0 : 128 + (signal === 'SIGTERM' ? 15 : 0)
    );
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err, origin) => {
  console.error(`[Server UncaughtException] Origin: ${origin}, Error:`, err);
  shutdown('uncaughtException').finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(
    '[Server UnhandledRejection] Reason:',
    reason,
    'Promise:',
    promise
  );
  shutdown('unhandledRejection').finally(() => process.exit(1));
});

export default app;
export type { App } from './app.js';
