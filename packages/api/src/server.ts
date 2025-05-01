import http from 'node:http';
import { WritableStream, ReadableStream } from 'node:stream/web';
import {
  Elysia,
  t,
  ValidationError,
  type Context as ElysiaContext,
  type Static,
} from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import ollama from 'ollama';
import config from './config/index.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js'; // Routes for session chats
import { standaloneChatRoutes } from './routes/standaloneChatRoutes.js'; // Routes for standalone chats
import { ollamaRoutes } from './routes/ollamaRoutes.js';
import { dockerRoutes } from './routes/dockerRoutes.js';
import { metaRoutes } from './routes/metaRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js'; // <-- Import Search routes
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
import { closeDb } from './db/sqliteService.js'; // Import closeDb

// --- Initial setup, version reading, CORS, request logging ---
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
const getErrorStack = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.stack;
  return undefined;
};
console.log(`[CORS Config] Allowing origin: ${config.server.corsOrigin}`);

const app = new Elysia()
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
            description:
              'Chat Interaction Endpoints (within a session or global)',
          }, // Combined Chat Tag
          {
            name: 'Standalone Chat',
            description: 'Chat Interaction Endpoints (not tied to a session)',
          }, // New Tag
          { name: 'Search', description: 'Full-Text Search Endpoints' }, // <-- Added Search tag
          {
            name: 'Transcription',
            description: 'Transcription Job Management',
          },
          { name: 'Ollama', description: 'Ollama LLM Management Endpoints' },
          { name: 'Docker', description: 'Docker Container Management' },
          {
            name: 'System',
            description: 'System-level Actions (Shutdown, etc.)',
          },
          { name: 'Meta', description: 'API Metadata and Health' },
        ],
      },
    })
  )
  .onError(({ code, error, set, request }) => {
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
    // Removed specific NotFoundError/ConflictError handling here, use ApiError base

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

  // --- Core Application Routes ---
  .use(metaRoutes) // Handles /api/health, /api/schema, /api/starred-messages
  .use(ollamaRoutes) // Handles /api/ollama/*
  .use(dockerRoutes) // Handles /api/docker/*
  .use(systemRoutes) // Handles /api/system/*
  .use(searchRoutes) // Handles /api/search/* <-- Added Search routes
  .use(sessionRoutes) // Handles /api/sessions/* and /api/transcription/*
  .use(chatRoutes) // Handles /api/sessions/:sessionId/chats/*
  .use(standaloneChatRoutes); // Handles /api/chats/*

// --- Server Startup Check ---
async function checkOllamaConnectionOnStartup() {
  console.log(
    `[Server Startup] Checking Ollama connection at ${config.ollama.baseURL}...`
  );
  try {
    await axios.get(config.ollama.baseURL, { timeout: 2000 });
    console.log('[Server Startup] ✅ Ollama connection successful.');
    return true;
  } catch (error: any) {
    console.warn('-------------------------------------------------------');
    console.warn(
      `[Server Startup] ⚠️ Ollama service NOT DETECTED at ${config.ollama.baseURL}`
    );
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        console.warn(
          '   Reason: Connection refused. (This is expected if not started yet).'
        );
      } else {
        console.warn(`   Reason: ${error.message}`);
      }
    } else {
      console.warn(`   Reason: An unexpected error occurred: ${error.message}`);
    }
    console.warn(
      '   Ollama service will be started on demand when needed (e.g., loading a model).'
    );
    console.warn('-------------------------------------------------------');
    return false;
  }
}

// --- Server Creation & Start ---
console.log(
  `[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`
);
const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${config.server.port}`;
  const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/';
  const url = `http://${host}${pathAndQuery}`;
  let bodyChunks: Buffer[] = [];
  req
    .on('data', (chunk) => {
      bodyChunks.push(chunk);
    })
    .on('end', () => {
      const bodyBuffer = Buffer.concat(bodyChunks);
      const requestInit: RequestInit = {
        method: req.method,
        headers: req.headers as HeadersInit,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
            ? bodyBuffer
            : undefined,
      };
      app
        .handle(new Request(url, requestInit))
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body) {
            try {
              if (response.body instanceof ReadableStream) {
                await response.body.pipeTo(
                  new WritableStream({
                    write(chunk) {
                      res.write(chunk);
                    },
                    close() {
                      res.end();
                    },
                    abort(err) {
                      console.error('Response stream aborted:', err);
                      res.destroy(
                        err instanceof Error ? err : new Error(String(err))
                      );
                    },
                  })
                );
              } else {
                res.end(response.body);
              }
            } catch (pipeError) {
              console.error('Error piping response body:', pipeError);
              if (!res.writableEnded) {
                res.end();
              }
            }
          } else {
            res.end();
          }
        })
        .catch((err) => {
          console.error('Error in app.handle:', err);
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
        });
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

checkOllamaConnectionOnStartup().then(() => {
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
    console.log(`-------------------------------------------------------`);
    console.log(
      `Access API Docs at: http://localhost:${config.server.port}/api/docs`
    );
    console.log(
      `Health Check: http://localhost:${config.server.port}/api/health`
    );
    console.log(`-------------------------------------------------------`);
  });
});

// --- Graceful Shutdown ---
let isShuttingDown = false;
async function shutdown(signal: string) {
  console.log(
    `[API Server Shutdown] Received signal: ${signal}. Checking shutdown status.`
  );
  if (isShuttingDown) {
    console.log(
      '[API Server Shutdown] Already shutting down. Ignoring signal.'
    );
    return;
  }
  isShuttingDown = true;
  console.log(
    `[API Server Shutdown] Initiating graceful shutdown (Docker cleanup handled externally)...`
  );
  console.log('[API Server Shutdown] Closing HTTP server...');
  server.close((err) => {
    if (err)
      console.error('[API Server Shutdown] Error closing HTTP server:', err);
    else console.log('[API Server Shutdown] HTTP server closed successfully.');
    console.log('[API Server Shutdown] Closing database connection...');
    closeDb();
    console.log(
      '🚪 [API Server Shutdown] Shutdown sequence complete. Exiting process.'
    );
    process.exitCode = err ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 100);
  });
  setTimeout(() => {
    console.error(
      '🛑 [API Server Shutdown] Shutdown timed out after 10 seconds. Forcing exit.'
    );
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }, 10000);
}
process.on('SIGINT', () => {
  console.log('[API Server Process] SIGINT received.');
  shutdown('SIGINT').catch((e) =>
    console.error('[API Server Process] Error during SIGINT shutdown:', e)
  );
});
process.on('SIGTERM', () => {
  console.log('[API Server Process] SIGTERM received.');
  shutdown('SIGTERM').catch((e) =>
    console.error('[API Server Process] Error during SIGTERM shutdown:', e)
  );
});
process.on('uncaughtException', (error, origin) => {
  console.error(`[API Server FATAL] Uncaught Exception at: ${origin}`, error);
  if (!isShuttingDown) {
    try {
      closeDb();
    } catch {}
  }
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(
    '[API Server FATAL] Unhandled Rejection at:',
    promise,
    'reason:',
    reason
  );
  if (!isShuttingDown) {
    try {
      closeDb();
    } catch {}
  }
  process.exit(1);
});

export default app;
export type App = typeof app;
