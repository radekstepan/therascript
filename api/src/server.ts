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
// Re-import Node.js http and WritableStream
import http from 'http';
import { WritableStream } from 'node:stream/web';


console.log(`[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`);

// --- Helper Functions (keep as is) ---
const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); }
    catch { return String(error) || 'An unknown error occurred'; }
};
const getErrorStack = (error: unknown): string | undefined => {
    if (error instanceof Error) return error.stack;
    return undefined;
};

const app = new Elysia()
    // Apply CORS FIRST - Use permissive settings for debugging
    .use(cors({
        origin: '*', // Allow any origin for now (insecure for production!)
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', '*'], // Allow common headers + wildcard for testing
        // credentials: true, // IMPORTANT: MUST be false when origin is '*'
    }))
    // Logging middleware
    .onRequest(({ request }) => {
        // Log details including Origin header if present
        const origin = request.headers.get('origin');
        console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`);
    })
    .onAfterHandle(({ request, set }) => {
        console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`);
    })
    // Swagger
    .use(swagger({
        path: '/api/docs',
        exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'],
        documentation: {
            info: { title: 'Therapy Analyzer API (Elysia)', version: '1.0.0' },
            tags: []
        }
    }))
    // Error Handling
    .onError(({ code, error, set, request }) => {
        const errorMessage = getErrorMessage(error);
        let path = 'N/A';
        let method = 'N/A';
        try {
            if (request?.url) path = new URL(request.url).pathname;
            if (request?.method) method = request.method;
        } catch { }

        // Log more details for debugging CORS/OPTIONS issues
        console.error(`[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`);
        if (method === 'OPTIONS') {
             console.error("[Error] Potentially related to OPTIONS request handling / CORS preflight.");
        }

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
                 // For OPTIONS requests, a 404 might happen if CORS didn't handle it and no route exists
                 if (method === 'OPTIONS') {
                     console.warn("[Error] OPTIONS request resulted in 404. Check CORS middleware order and config.");
                     // Avoid sending a typical JSON 404 body for OPTIONS, let browser handle it
                     set.status = 204; // Often preferred for failed preflight if not handled by CORS middleware
                     return;
                 }
                 return { error: 'NotFound', message: `Route ${method} ${path} not found.` };
            case 'INTERNAL_SERVER_ERROR':
                const internalError = new InternalServerError('An unexpected internal error occurred.', error instanceof Error ? error : undefined);
                set.status = internalError.status;
                return { error: internalError.name, message: internalError.message, details: internalError.details };
            case 'PARSE':
                set.status = 400;
                return { error: 'ParseError', message: 'Failed to parse request body.', details: errorMessage };
            case 'VALIDATION':
                const validationDetails = error instanceof ValidationError ? error.all : undefined;
                set.status = 400; // Use 400 for validation errors
                return { error: 'ValidationError', message: 'Request validation failed.', details: errorMessage, validationErrors: validationDetails };
            case 'UNKNOWN':
                console.error("[Error] Unknown Elysia Error Code:", error);
                const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined);
                set.status = unknownInternalError.status;
                return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
            default:
                 // If it's an OPTIONS request that fell through, likely a CORS config issue
                 if (method === 'OPTIONS') {
                     console.warn(`[Error] OPTIONS request for ${path} was not handled by CORS middleware. Responding 204.`);
                     set.status = 204;
                     return;
                 }
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
    // API Routes
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
    .use(sessionRoutes) // Mount routes AFTER CORS and logging
    .use(chatRoutes)
    .get('/', () => 'Therapy Analyzer Backend API (ElysiaJS)');


// --- Reinstate the http.createServer wrapper ---
console.log(`[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`);
const server = http.createServer((req, res) => {
    // Construct full URL from req.headers.host and req.url
    const host = req.headers.host || `localhost:${config.server.port}`;
    // Ensure req.url is defined, default to '/' if not
    const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/';
    const url = `http://${host}${pathAndQuery}`;

    // Use Elysia's app.handle which expects a standard Request object
    // We need to buffer the body for non-GET/HEAD requests
    let bodyChunks: Buffer[] = [];
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    }).on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks);
        const requestInit: RequestInit = {
            method: req.method,
            headers: req.headers as HeadersInit,
            // Only include body if it exists and method supports it
            body: (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) ? bodyBuffer : undefined,
        };

        app.handle(new Request(url, requestInit)).then(async (response) => {
            // Pipe Elysia's Response back to the Node.js response
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) {
                try {
                    await response.body.pipeTo(new WritableStream({
                        write(chunk) { res.write(chunk); },
                        close() { res.end(); },
                        abort(err) {
                            console.error('Response stream aborted:', err);
                            res.destroy(err instanceof Error ? err : new Error(String(err)));
                        }
                    }));
                } catch (pipeError) {
                     console.error('Error piping response body:', pipeError);
                     if (!res.writableEnded) {
                         res.end();
                     }
                }
            } else {
                res.end();
            }
        }).catch((err) => {
            console.error('Error in app.handle:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
            }
            if (!res.writableEnded) {
                 res.end(JSON.stringify({ error: 'Internal Server Error during request handling' }));
            }
        });
    }).on('error', (err) => {
        console.error('Request stream error:', err);
        if (!res.headersSent) {
             res.writeHead(400, { 'Content-Type': 'application/json' });
        }
        if (!res.writableEnded) {
             res.end(JSON.stringify({ error: 'Bad Request stream' }));
        }
    });
});

server.listen(config.server.port, () => {
    // --- REMOVED THE PROBLEMATIC LOGGING LINE ---
    // Just log the config value which reflects the intended setting
    const intendedCorsOrigin = config.server.corsOrigin; // For '*' debugging, this won't reflect '*'

    console.log(`-------------------------------------------------------`);
    console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`);
    console.log(`   Mode: ${config.server.nodeEnv}`);
    console.log(`   DB Path: ${config.db.sqlitePath}`);
    // Log the origin being used by the cors middleware (currently '*')
    console.log(`   CORS Origin Setting: * (DEBUGGING)`); // Explicitly state we're using '*' for debug
    console.log(`   (Configured CORS Origin: ${config.server.corsOrigin})`); // Show what's in config
    console.log(`   Ollama URL: ${config.ollama.baseURL}`);
    console.log(`   Ollama Model: ${config.ollama.model}`);
    console.log(`-------------------------------------------------------`);
    console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`);
    console.log(`Health Check: http://localhost:${config.server.port}/api/health`);
    console.log(`-------------------------------------------------------`);
});
// --- End reinstate http.createServer wrapper ---

export default app;
export type App = typeof app;
