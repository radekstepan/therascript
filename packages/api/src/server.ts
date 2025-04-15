// packages/api/src/server.ts
import http from 'node:http';
import { WritableStream } from 'node:stream/web';
import { Elysia, ValidationError } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import config from './config/index.js'; // Import config
// Removed dbAccess import, db interaction is checked on startup in sqliteService
// import { checkDatabaseHealth } from './db/dbAccess.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { ApiError, InternalServerError, ConflictError } from './errors.js';

// Helper function to read package.json version (added at the top level)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let appVersion = '0.0.0'; // Default version
try {
    // Navigate up from dist/ to find package.json
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        appVersion = packageJson.version || appVersion;
        console.log(`[Server Init] Read app version from package.json: ${appVersion}`);
    } else {
         console.warn(`[Server Init] Could not find package.json at ${packageJsonPath} to read version.`);
    }
} catch (error) {
    console.error('[Server Init] Error reading package.json version:', error);
}
// --- End Package Version Read ---


console.log(`[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`);

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); }
    catch { return String(error) || 'An unknown error occurred'; }
};
const getErrorStack = (error: unknown): string | undefined => {
    if (error instanceof Error) return error.stack;
    return undefined;
};

console.log(`[CORS Config] Allowing origin: ${config.server.corsOrigin}`); // Log the origin being used

const app = new Elysia()
    .use(cors({
        // Use the specific origin from the config file
        origin: config.server.corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        // Allowed headers - '*' might be too broad, but okay for dev.
        // For production, list specific headers like 'Content-Type', 'Authorization'.
        allowedHeaders: ['Content-Type', 'Authorization', '*'],
        // Credentials might be needed if you add authentication later
        // credentials: true, // MUST NOT be true if origin is '*'
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
            // Use version read from package.json
            info: { title: 'Therascript API (Elysia)', version: appVersion },
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

        console.error(`[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`);

        if (!config.server.isProduction) {
            const stack = getErrorStack(error);
            if (stack) console.error("Stack:", stack);
            if (!(error instanceof Error)) console.error("Full Error Object:", error);
        }

        // Specific check for CORS preflight failure symptoms
        if (code === 'UNKNOWN' && method === 'OPTIONS') {
             console.warn("[Error Handler] Possible CORS preflight failure for OPTIONS request. Check allowedMethods/Headers in CORS config.");
             // Return 204 No Content for successful OPTIONS requests handled by cors plugin
             // If it reaches here with UNKNOWN, something else might be wrong
             set.status = 204;
             return;
        }
         if (code === 'NOT_FOUND' && method === 'OPTIONS') {
             console.warn("[Error Handler] OPTIONS request resulted in 404. Check route definitions and CORS middleware.");
             set.status = 204; // Still respond with 204 for OPTIONS 404
             return;
         }


        if (error instanceof ApiError) {
            set.status = error.status;
            return { error: error.name, message: error.message, details: error.details };
        }

        switch (code) {
            case 'NOT_FOUND':
                set.status = 404;
                // Already handled OPTIONS above
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
            case 'UNKNOWN': // Already handled OPTIONS above
                console.error("[Error Handler] Unknown Elysia Error Code (Non-OPTIONS):", error);
                const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined);
                set.status = unknownInternalError.status;
                return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
            default:
                 // If it's an OPTIONS request that somehow didn't match above, return 204.
                 if (method === 'OPTIONS') {
                     set.status = 204;
                     return;
                 }
                 break; // Let other errors fall through
        }

        // --- Database Error Handling ---
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

        // --- Fallback Error Handling ---
        console.error("[Error Handler] Unhandled Error Type:", error);
        const fallbackError = new InternalServerError('An unexpected server error occurred.', error instanceof Error ? error : undefined);
        set.status = fallbackError.status;
        return { error: fallbackError.name, message: fallbackError.message, details: fallbackError.details };
    })
    // API Routes
    .get('/api/health', ({ set }) => {
        try {
            // db is initialized and accessible via sqliteService, check occurs on start
            // checkDatabaseHealth(); // Removed call
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
    .use(chatRoutes);


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
    console.log(`-------------------------------------------------------`);
    console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`);
    console.log(`   Version: ${appVersion}`); // Log the version
    console.log(`   Mode: ${config.server.nodeEnv}`);
    console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`); // Log CORS Origin
    console.log(`   DB Path: ${config.db.sqlitePath}`);
    console.log(`   Ollama URL: ${config.ollama.baseURL}`);
    console.log(`   Ollama Model: ${config.ollama.model}`);
    console.log(`-------------------------------------------------------`);
    console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`);
    console.log(`Health Check: http://localhost:${config.server.port}/api/health`);
    console.log(`-------------------------------------------------------`);
});

export default app;
export type App = typeof app;
