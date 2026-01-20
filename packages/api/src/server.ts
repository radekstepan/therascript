// Configure the database connection before any other modules are loaded
import { configureDb } from '@therascript/db';
import { configureFileService } from '@therascript/services';
import config from './config/index.js';
configureDb({
  dbPath: config.db.sqlitePath,
  isDev: !config.server.isProduction,
});
configureFileService(config.db.uploadsDir);

import http from 'node:http';
import { WritableStream, ReadableStream } from 'node:stream/web';
import {
  Elysia,
  t,
  ValidationError,
  type Context as ElysiaContext,
  type Static,
  type Cookie,
} from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { standaloneChatRoutes } from './routes/standaloneChatRoutes.js';
import { templateRoutes } from './routes/templateRoutes.js';
import { ollamaRoutes } from './routes/ollamaRoutes.js';
import { dockerRoutes } from './routes/dockerRoutes.js';
import { metaRoutes } from './routes/metaRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js';
import { analysisRoutes } from './routes/analysisRoutes.js';
import { transcriptionRoutes } from './routes/transcriptionRoutes.js';
import { jobsRoutes } from './routes/jobsRoutes.js';
import { usageRoutes } from './routes/usageRoutes.js';
import {
  ApiError,
  InternalServerError,
  ConflictError,
  BadRequestError,
  NotFoundError,
} from './errors.js';
import {
  getActiveModel,
  getConfiguredContextSize,
} from './services/activeModelService.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { closeDb } from '@therascript/db';
import {
  getElasticsearchClient,
  initializeIndices,
  checkEsHealth,
} from '@therascript/elasticsearch-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let appVersion = '0.0.0';
try {
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    appVersion = packageJson.version || appVersion;
    console.log(
      `[Server Init] Read app version from package.json: ${appVersion}`
    );
  } else {
    console.warn(
      `[Server Init] Could not find package.json at ${packageJsonPath} to read version.`
    );
  }
} catch (error) {
  console.error('[Server Init] Error reading package.json version:', error);
}
console.log(
  `[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`
);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error) || 'An unknown error occurred';
  }
};
const getErrorStack = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;
console.log(`[CORS Config] Allowing origin: ${config.server.corsOrigin}`);

const esClient = getElasticsearchClient(config.elasticsearch.url);

const app = new Elysia()
  .decorate('esClient', esClient)
  .use(
    cors({
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', '*'],
    })
  )
  .onRequest(({ request }) => {
    const origin = request.headers.get('origin');
    console.log(
      `[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`
    );
  })
  .onAfterHandle(({ request, set }) => {
    console.log(
      `[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`
    );
  })
  .use(
    swagger({
      path: '/api/docs',
      exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'],
      documentation: {
        info: { title: 'Therascript API (Elysia)', version: appVersion },
        tags: [
          { name: 'Session', description: 'Session and Transcript Endpoints' },
          {
            name: 'Chat',
            description: 'Chat Interaction Endpoints (Session & Standalone)',
          },
          { name: 'Standalone Chat', description: 'Standalone Chat Endpoints' },
          {
            name: 'Templates',
            description: 'Manage reusable text templates',
          },
          { name: 'Analysis', description: 'Multi-session analysis jobs' },
          {
            name: 'Search',
            description: 'Elasticsearch Full-Text Search Endpoints',
          },
          { name: 'Jobs', description: 'Background Job Management' },
          {
            name: 'Transcription',
            description: 'Transcription Job Management',
          },
          { name: 'Ollama', description: 'Ollama LLM Management Endpoints' },
          { name: 'Docker', description: 'Docker Container Management' },
          { name: 'System', description: 'System-level Actions' },
          {
            name: 'Admin',
            description: 'Administrative Actions (e.g., re-indexing)',
          },
          { name: 'Meta', description: 'API Metadata and Health' },
          { name: 'Usage', description: 'Usage Tracking and Cost Estimation' },
        ],
      },
    })
  )
  .onError(({ code, error, set, request }) => {
    if ((error as any).meta?.body?.error?.type) {
      console.error(
        '[Error Handler] Elasticsearch Client Error:',
        (error as any).meta.body.error
      );
    }
    const errorMessage = getErrorMessage(error);
    let path = 'N/A';
    let method = 'N/A';
    try {
      if (request?.url) path = new URL(request.url).pathname;
      if (request?.method) method = request.method;
    } catch {}

    console.error(
      `[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`
    );
    if (!config.server.isProduction) {
      const stack = getErrorStack(error);
      if (stack) console.error('Stack:', stack);
      if (!(error instanceof Error)) console.error('Full Error Object:', error);
    }

    if (error instanceof ApiError) {
      set.status = error.status;
      return {
        error: error.name,
        message: error.message,
        details: error.details,
      };
    }

    switch (code) {
      case 'NOT_FOUND':
        set.status = 404;
        return {
          error: 'NotFound',
          message: `Route ${method} ${path} not found.`,
        };
      case 'INTERNAL_SERVER_ERROR':
        const internalError = new InternalServerError(
          'An unexpected internal error occurred.',
          error instanceof Error ? error : undefined
        );
        set.status = internalError.status;
        return {
          error: internalError.name,
          message: internalError.message,
          details: internalError.details,
        };
      case 'PARSE':
        set.status = 400;
        return {
          error: 'ParseError',
          message: 'Failed to parse request body.',
          details: errorMessage,
        };
      case 'VALIDATION':
        const validationDetails =
          error instanceof ValidationError ? error.all : undefined;
        set.status = 400;
        return {
          error: 'ValidationError',
          message: 'Request validation failed.',
          details: errorMessage,
          validationErrors: validationDetails,
        };
      case 'UNKNOWN':
        console.error('[Error Handler] Unknown Elysia Error Code:', error);
        const unknownInternalError = new InternalServerError(
          'An unknown internal error occurred.',
          error instanceof Error ? error : undefined
        );
        set.status = unknownInternalError.status;
        return {
          error: unknownInternalError.name,
          message: unknownInternalError.message,
          details: unknownInternalError.details,
        };
      default:
        break;
    }

    const sqliteCode = (error as any)?.code;
    if (typeof sqliteCode === 'string' && sqliteCode.startsWith('SQLITE_')) {
      if (
        sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
        sqliteCode.includes('CONSTRAINT')
      ) {
        const conflictError = new ConflictError(
          'Database constraint violation.',
          config.server.isProduction ? undefined : errorMessage
        );
        set.status = conflictError.status;
        return {
          error: conflictError.name,
          message: conflictError.message,
          details: conflictError.details,
        };
      } else {
        const dbError = new InternalServerError(
          'A database operation failed.',
          error instanceof Error ? error : undefined
        );
        set.status = dbError.status;
        return {
          error: dbError.name,
          message: dbError.message,
          details: dbError.details,
        };
      }
    }

    console.error('[Error Handler] Unhandled Error Type:', error);
    const fallbackError = new InternalServerError(
      'An unexpected server error occurred.',
      error instanceof Error ? error : undefined
    );
    set.status = fallbackError.status;
    return {
      error: fallbackError.name,
      message: fallbackError.message,
      details: fallbackError.details,
    };
  })
  .use(metaRoutes)
  .use(ollamaRoutes)
  .use(dockerRoutes)
  .use(systemRoutes)
  .use(adminRoutes)
  .use(searchRoutes)
  .use(analysisRoutes)
  .use(transcriptionRoutes)
  .use(jobsRoutes)
  .use(sessionRoutes)
  .use(chatRoutes)
  .use(standaloneChatRoutes)
  .use(templateRoutes)
  .use(usageRoutes);

async function checkOllamaConnectionOnStartup() {
  /* ... */
}

async function initializeServices() {
  console.log('[Server Startup] Initializing services...');
  await checkOllamaConnectionOnStartup();

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
      console.log(`   Ollama URL: ${config.ollama.baseURL}`);
      console.log(`   Ollama Model: ${getActiveModel()} (Active)`);
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
    closeDb(); // Close SQLite connection
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
export type App = typeof app;
