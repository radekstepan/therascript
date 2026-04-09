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
import { unloadActiveModel } from './services/llamaCppService.js';
import { closeDb } from '@therascript/db';
import { closeQueues } from './services/jobQueueService.js';
import {
  initializeIndices,
  checkEsHealth,
  closeElasticsearchClient,
} from '@therascript/elasticsearch-client';

configureDb({
  dbPath: config.db.sqlitePath,
  isDev: !config.server.isProduction,
});
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
}

async function initializeServices() {
  console.log('[Server Startup] Initializing services...');
  await checkLmStudioConnectionOnStartup();

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
      const requestInit: RequestInit = {
        method: req.method,
        headers: req.headers as HeadersInit,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
            ? bodyBuffer
            : undefined,
      };
      try {
        const response = await app.handle(new Request(url, requestInit));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
          if (response.body instanceof ReadableStream) {
            for await (const chunk of response.body) {
              res.write(chunk);
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
    server.listen(config.server.port, () => {
      console.log(`-------------------------------------------------------`);
      console.log(
        `🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`
      );
      console.log(`   Version: ${appVersion}`);
      console.log(`   Mode: ${config.server.nodeEnv}`);
      console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`);
      console.log(`   DB Path: ${config.db.sqlitePath}`);
      console.log(`   LLM URL: ${config.llm.baseURL}`);
      console.log(`   Active Model: ${getActiveModel()} (Active)`);
      console.log(
        `   Configured Context: ${getConfiguredContextSize() ?? 'default'}`
      );
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
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error('[Server] Error closing HTTP server:', err);
          return reject(err);
        }
        console.log('[Server] HTTP server closed.');
        resolve(null);
      });
    });
    // Unload any loaded models before stopping the runtime
    try {
      await unloadActiveModel();
      console.log('[Server] Active model unloaded.');
    } catch (err) {
      console.warn('[Server] Error unloading active model:', err);
    }
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
    closeDb();
    await closeElasticsearchClient();
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err);
  } finally {
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
