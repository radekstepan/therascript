// src/server.ts
import { Elysia, ParseError, ValidationError } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import config from './config/index.js';
import { checkDatabaseHealth } from './db/dbAccess.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { ApiError, NotFoundError, BadRequestError, InternalServerError, ConflictError } from './errors.js';
import type { ActionSchema } from './types/index.js';
import http from 'http';

console.log(`[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`);

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

const app = new Elysia()
  .use(cors({
    origin: config.server.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))
  .use(swagger({
    path: '/api/docs',
    exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'],
    documentation: {
      info: { title: 'Therapy Analyzer API (Elysia)', version: '1.0.0' },
      tags: []
    }
  }))
  .onRequest(({ request }) => {
    console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}`);
  })
  .onAfterHandle(({ request, set }) => {
    console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`);
  })
  .onError(({ code, error, set, request }) => {
    const errorMessage = getErrorMessage(error);
    let path = 'N/A';
    try {
      if (request?.url) path = new URL(request.url).pathname;
    } catch {}

    console.error(`[Error] Code: ${code} | Path: ${path} | Message: ${errorMessage}`);
    if (!config.server.isProduction) {
      const stack = getErrorStack(error);
      if (stack) console.error("Stack:", stack);
      if (!(error instanceof Error)) console.error("Full Error Object:", error);
    }

    if (error instanceof ApiError) {
      set.status = error.status;
      return { error: error.name, message: error.message, details: error.details };
    }
    switch (code) {
      case 'NOT_FOUND':
        set.status = 404;
        return { error: 'NotFound', message: `Route ${request.method} ${path} not found.` };
      case 'INTERNAL_SERVER_ERROR':
        const internalError = new InternalServerError('An unexpected internal error occurred.', error instanceof Error ? error : undefined);
        set.status = internalError.status;
        return { error: internalError.name, message: internalError.message, details: internalError.details };
      case 'PARSE':
        set.status = 400;
        return { error: 'ParseError', message: 'Failed to parse request body.', details: errorMessage };
      case 'VALIDATION':
        const validationDetails = error instanceof ValidationError ? error.all : undefined;
        return { error: 'ValidationError', message: 'Request validation failed.', details: errorMessage, validationErrors: validationDetails };
      case 'UNKNOWN':
        console.error("[Error] Unknown Elysia Error Code:", error);
        const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined);
        set.status = unknownInternalError.status;
        return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
      default:
        break;
    }
    const sqliteCode = (error as any)?.code;
    if (typeof sqliteCode === 'string' && sqliteCode.startsWith('SQLITE_')) {
      if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteCode.includes('CONSTRAINT')) {
        const conflictError = new ConflictError('Database constraint violation.', config.server.isProduction ? undefined : errorMessage);
        set.status = conflictError.status;
        return { error: conflictError.name, message: conflictError.message, details: conflictError.details };
      } else {
        const dbError = new InternalServerError('A database operation failed.', error instanceof Error ? error : undefined);
        set.status = dbError.status;
        return { error: dbError.name, message: dbError.message, details: dbError.details };
      }
    }
    console.error("[Error] Unhandled Error Type:", error);
    const fallbackError = new InternalServerError('An unexpected server error occurred.', error instanceof Error ? error : undefined);
    set.status = fallbackError.status;
    return { error: fallbackError.name, message: fallbackError.message, details: fallbackError.details };
  })
  .get('/api/health', ({ set }) => {
    try {
      checkDatabaseHealth();
      set.status = 200;
      return { status: 'OK', database: 'connected', timestamp: new Date().toISOString() };
    } catch (dbError) {
      console.error("[Health Check] Database error:", dbError);
      throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined);
    }
  }, { detail: { tags: ['Meta'] } })
  .get('/api/schema', ({ set }) => {
    set.status = 501;
    return { message: "Use /api/docs for Swagger UI." };
  }, { detail: { tags: ['Meta'] } })
  .use(sessionRoutes)
  .use(chatRoutes)
  .get('/', () => 'Therapy Analyzer Backend API (ElysiaJS)');

// Adapt Elysia’s handle to Node.js http with proper body buffering and full URL
console.log(`[Server] Starting standalone Node.js server on port ${config.server.port}...`);
const server = http.createServer((req, res) => {
  // Construct full URL from req.headers.host and req.url
  const host = req.headers.host || `localhost:${config.server.port}`;
  const url = `http://${host}${req.url || '/'}`;

  if (req.method === 'GET' || req.method === 'HEAD') {
    // For GET/HEAD, no body is expected
    app.handle(new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
    })).then((response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      response.body?.pipeTo(new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); },
        abort(err) {
          console.error('Response stream aborted:', err);
          res.destroy(err);
        }
      }));
    }).catch((err) => {
      console.error('Error handling request:', err);
      res.writeHead(500);
      res.end('Internal Server Error');
    });
  } else {
    // For methods with potential bodies (POST, PUT, etc.), buffer the body
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      app.handle(new Request(url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: body || undefined, // Pass the buffered string or undefined if empty
      })).then((response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        response.body?.pipeTo(new WritableStream({
          write(chunk) { res.write(chunk); },
          close() { res.end(); },
          abort(err) {
            console.error('Response stream aborted:', err);
            res.destroy(err);
          }
        }));
      }).catch((err) => {
        console.error('Error handling request:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
      });
    });
    req.on('error', (err) => {
      console.error('Request stream error:', err);
      res.writeHead(400);
      res.end('Bad Request');
    });
  }
});

server.listen(config.server.port, () => {
  console.log(`-------------------------------------------------------`);
  console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`);
  console.log(`   Mode: ${config.server.nodeEnv}`);
  console.log(`   DB Path: ${config.db.sqlitePath}`);
  console.log(`   CORS Origin: ${config.server.corsOrigin}`);
  console.log(`   Ollama URL: ${config.ollama.baseURL}`);
  console.log(`   Ollama Model: ${config.ollama.model}`);
  console.log(`-------------------------------------------------------`);
  console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`);
  console.log(`Health Check: http://localhost:${config.server.port}/api/health`);
  console.log(`-------------------------------------------------------`);
});

export default app;
export type App = typeof app;
