/* packages/api/src/server.ts */
import http from 'node:http';
import { WritableStream } from 'node:stream/web';
import { Elysia, t, ValidationError } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import ollama from 'ollama';
import config from './config/index.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { ApiError, InternalServerError, ConflictError, BadRequestError } from './errors.js';
// --- Update service imports ---
import { checkModelStatus, listModels, loadOllamaModel, pullOllamaModel } from './services/ollamaService.js';
// --- Import new service functions ---
import { setActiveModelAndContext, getActiveModel, getConfiguredContextSize } from './services/activeModelService.js';
// --- End Update ---
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

// ... (initial setup, version reading, CORS, request logging - unchanged) ...
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let appVersion = '0.0.0';
try { // Read version from package.json
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

console.log(`[Server] Starting Elysia application in ${config.server.nodeEnv} mode...`);
const getErrorMessage = (error: unknown): string => { if (error instanceof Error) return error.message; try { return JSON.stringify(error); } catch { return String(error) || 'An unknown error occurred'; } };
const getErrorStack = (error: unknown): string | undefined => { if (error instanceof Error) return error.stack; return undefined; };
console.log(`[CORS Config] Allowing origin: ${config.server.corsOrigin}`);


// --- Ollama Response/Request Schemas ---
const OllamaModelDetailSchema = t.Object({
    format: t.String(),
    family: t.String(),
    families: t.Union([t.Array(t.String()), t.Null()]),
    parameter_size: t.String(),
    quantization_level: t.String(),
});
const OllamaModelInfoSchema = t.Object({
    name: t.String(),
    modified_at: t.String(),
    size: t.Number(),
    digest: t.String(),
    details: OllamaModelDetailSchema,
    size_vram: t.Optional(t.Number()),
    expires_at: t.Optional(t.String()),
    size_total: t.Optional(t.Number()),
});
const AvailableModelsResponseSchema = t.Object({
    models: t.Array(OllamaModelInfoSchema),
});
// --- Modified OllamaStatusResponseSchema ---
const OllamaStatusResponseSchema = t.Object({
    activeModel: t.String(),
    modelChecked: t.String(),
    loaded: t.Boolean(),
    details: t.Optional(OllamaModelInfoSchema),
    // --- Added configuredContextSize ---
    configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
});
// --- End Schema ---
// --- Modified SetModelBodySchema ---
const SetModelBodySchema = t.Object({
    modelName: t.String({ minLength: 1, error: "Model name is required." }),
    // --- Added optional contextSize ---
    contextSize: t.Optional(t.Union([
        t.Number({ minimum: 1, error: "Context size must be a positive integer." }),
        t.Null() // Allow null to explicitly request default
    ]))
});
// --- End Schema ---
// --- Add PullModelBodySchema (no change) ---
const PullModelBodySchema = t.Object({
    modelName: t.String({ minLength: 1, error: "Model name is required." })
});
// --- End Schema ---


const app = new Elysia()
    .model({
        setModelBody: SetModelBodySchema, // Use updated schema
        pullModelBody: PullModelBodySchema,
        ollamaModelInfo: OllamaModelInfoSchema,
        availableModelsResponse: AvailableModelsResponseSchema,
        ollamaStatusResponse: OllamaStatusResponseSchema, // Use updated schema
    })
    .use(cors({ origin: config.server.corsOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', '*'], }))
    .onRequest(({ request }) => { const origin = request.headers.get('origin'); console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`); })
    .onAfterHandle(({ request, set }) => { console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`); })
    .use(swagger({ path: '/api/docs', exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'], documentation: { info: { title: 'Therascript API (Elysia)', version: appVersion }, tags: [ { name: 'Ollama', description: 'Ollama Management Endpoints' } ] } }))
    .onError(({ code, error, set, request }) => { /* ... (Error Handling unchanged) ... */
         const errorMessage = getErrorMessage(error); let path = 'N/A'; let method = 'N/A'; try { if (request?.url) path = new URL(request.url).pathname; if (request?.method) method = request.method; } catch { }
         console.error(`[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`);
         if (!config.server.isProduction) { const stack = getErrorStack(error); if (stack) console.error("Stack:", stack); if (!(error instanceof Error)) console.error("Full Error Object:", error); }
         if (code === 'UNKNOWN' && method === 'OPTIONS') { console.warn("[Error Handler] Possible CORS preflight failure for OPTIONS request."); set.status = 204; return; }
         if (code === 'NOT_FOUND' && method === 'OPTIONS') { console.warn("[Error Handler] OPTIONS request resulted in 404."); set.status = 204; return; }
         if (error instanceof ApiError) { set.status = error.status; return { error: error.name, message: error.message, details: error.details }; }
         switch (code) {
             case 'NOT_FOUND': set.status = 404; return { error: 'NotFound', message: `Route ${method} ${path} not found.` };
             case 'INTERNAL_SERVER_ERROR': const internalError = new InternalServerError('An unexpected internal error occurred.', error instanceof Error ? error : undefined); set.status = internalError.status; return { error: internalError.name, message: internalError.message, details: internalError.details };
             case 'PARSE': set.status = 400; return { error: 'ParseError', message: 'Failed to parse request body.', details: errorMessage };
             case 'VALIDATION': const validationDetails = error instanceof ValidationError ? error.all : undefined; set.status = 400; return { error: 'ValidationError', message: 'Request validation failed.', details: errorMessage, validationErrors: validationDetails };
             case 'UNKNOWN': console.error("[Error Handler] Unknown Elysia Error Code (Non-OPTIONS):", error); const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined); set.status = unknownInternalError.status; return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
             default: if (method === 'OPTIONS') { set.status = 204; return; } break;
         }
         const sqliteCode = (error as any)?.code;
         if (typeof sqliteCode === 'string' && sqliteCode.startsWith('SQLITE_')) {
             if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteCode.includes('CONSTRAINT')) { const conflictError = new ConflictError('Database constraint violation.', config.server.isProduction ? undefined : errorMessage); set.status = conflictError.status; return { error: conflictError.name, message: conflictError.message, details: conflictError.details }; }
             else { const dbError = new InternalServerError('A database operation failed.', error instanceof Error ? error : undefined); set.status = dbError.status; return { error: dbError.name, message: dbError.message, details: dbError.details }; }
         }
         console.error("[Error Handler] Unhandled Error Type:", error); const fallbackError = new InternalServerError('An unexpected server error occurred.', error instanceof Error ? error : undefined); set.status = fallbackError.status; return { error: fallbackError.name, message: fallbackError.message, details: fallbackError.details };
    })
    // --- Ollama Management Routes ---
    .group('/api/ollama', { detail: { tags: ['Ollama'] } }, (app) => app
        .get('/available-models', async ({ set }) => {
            // ... (available models logic unchanged) ...
            console.log(`[API Models] Requesting available models`);
            try { const models = await listModels(); set.status = 200; return { models }; }
            catch (error: any) { console.error(`[API Models] Error fetching available models:`, error); if (error instanceof InternalServerError) throw error; throw new InternalServerError(`Failed to fetch available models from Ollama.`, error); }
        }, { response: { 200: 'availableModelsResponse', 500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }) }, detail: { summary: 'List locally available Ollama models' } })

        // --- Modified Set Model Endpoint ---
        .post('/set-model', async ({ body, set }) => {
            const { modelName, contextSize } = body; // Destructure contextSize
            const sizeLog = contextSize === undefined ? 'default' : (contextSize === null ? 'explicit default' : contextSize);
            console.log(`[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}`);
            try {
                // 1. Update active model and context size in the state service
                setActiveModelAndContext(modelName, contextSize); // Pass both

                // 2. Trigger load process (uses updated active model implicitly)
                await loadOllamaModel(modelName);

                set.status = 200;
                return { message: `Active model set to ${modelName} (context: ${getConfiguredContextSize() ?? 'default'}). Load initiated. Check status.` };
            } catch (error: any) {
                 console.error(`[API SetModel] Error setting/loading model ${modelName} (context: ${sizeLog}):`, error);
                 if (error instanceof ApiError) throw error;
                 throw new InternalServerError(`Failed to set active model or initiate load for ${modelName}.`, error);
            }
        }, {
            body: 'setModelBody', // Use updated schema
            response: {
                 200: t.Object({ message: t.String() }),
                 400: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()), validationErrors: t.Optional(t.Any()) }),
                 500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) })
             },
            detail: { summary: 'Set the active Ollama model and context size, trigger load' }
        })
        // --- END Modified Set Model ---

        // --- Unload Endpoint (no change needed) ---
        .post('/unload', async ({ set }) => {
            // ... existing code ...
            const modelToUnload = getActiveModel();
            console.log(`[API Unload] Received request to unload active model: ${modelToUnload}`);
            try {
                await ollama.chat({ model: modelToUnload, messages: [{ role: 'user', content: 'unload request' }], keep_alive: 0, stream: false, });
                console.log(`[API Unload] Sent unload request (keep_alive: 0) for active model ${modelToUnload}`);
                set.status = 200;
                return { message: `Unload request sent for model ${modelToUnload}. It will be unloaded shortly.` };
            } catch (error: any) {
                console.error(`[API Unload] Error sending unload request for ${modelToUnload}:`, error);
                if (error.message?.includes('model') && error.message?.includes('not found')) { set.status = 200; return { message: `Model ${modelToUnload} was not found (likely already unloaded).` }; }
                 const isConnectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED');
                 if (isConnectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); }
                throw new InternalServerError(`Failed to send unload request to Ollama service for model ${modelToUnload}.`);
             }
        }, {
             response: { 200: t.Object({ message: t.String() }), 400: t.Object({ /*...*/ }), 500: t.Object({ /*...*/ }) },
             detail: { summary: 'Request Ollama to unload the currently active model' }
        })
        // --- End Unload ---

        // --- Pull Model Endpoint (no change needed) ---
        .post('/pull-model', async ({ body, set }) => {
            // ... existing code ...
             const { modelName } = body;
            console.log(`[API PullModel] Received request to pull model: ${modelName}`);
            try {
                await pullOllamaModel(modelName);
                set.status = 202;
                return { message: `Pull initiated for model ${modelName}. Check available models or Ollama logs for progress.` };
            } catch (error: any) {
                 console.error(`[API PullModel] Error initiating pull for model ${modelName}:`, error);
                 if (error instanceof ApiError) throw error;
                 throw new InternalServerError(`Failed to initiate pull for model ${modelName}.`, error);
            }
        }, {
            body: 'pullModelBody',
            response: { 202: t.Object({ message: t.String() }), /* ... */ },
            detail: { summary: 'Initiate downloading a new Ollama model from the registry' }
        })
        // --- End Pull Model ---

        // --- Updated Status Endpoint ---
        .get('/status', async ({ query, set }) => {
            const currentActiveModel = getActiveModel();
            const currentConfiguredContext = getConfiguredContextSize(); // Get context size
            const modelNameToCheck = query.modelName ?? currentActiveModel;

            console.log(`[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'})`);
            try {
                const loadedModelInfo = await checkModelStatus(modelNameToCheck);
                set.status = 200;
                // --- Return updated structure ---
                return {
                    activeModel: currentActiveModel,
                    modelChecked: modelNameToCheck,
                    loaded: !!loadedModelInfo,
                    details: loadedModelInfo ?? undefined,
                    configuredContextSize: currentConfiguredContext, // Add context size
                };
                // --- End update ---
            } catch (error: any) {
                console.error(`[API Status] Error checking status for ${modelNameToCheck}:`, error);
                if (error instanceof InternalServerError && error.message.includes('Connection refused')) { throw error; }
                throw new InternalServerError(`Failed to check status of model ${modelNameToCheck}.`);
            }
        }, {
            query: t.Optional(t.Object({ modelName: t.Optional(t.String()) })),
            response: { 200: 'ollamaStatusResponse', /* ... errors */ }, // Use updated schema
            detail: { summary: 'Check loaded status & configured context size for active/specific model' }
        })
        // --- End Status ---
    ) // End /api/ollama group

    // --- Existing API Routes (unchanged) ---
    .get('/api/health', ({ set }) => { try { set.status = 200; return { status: 'OK', database: 'connected', timestamp: new Date().toISOString() }; } catch (dbError) { console.error("[Health Check] Database error:", dbError); throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined); } }, { detail: { tags: ['Meta'] } })
    .get('/api/schema', ({ set }) => { set.status = 501; return { message: "Use /api/docs for Swagger UI." }; }, { detail: { tags: ['Meta'] } })
    .use(sessionRoutes)
    .use(chatRoutes);

// --- Server Creation & Start (unchanged) ---
console.log(`[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`);
const server = http.createServer((req, res) => { /* ... wrapper logic ... */
    const host = req.headers.host || `localhost:${config.server.port}`; const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/'; const url = `http://${host}${pathAndQuery}`;
    let bodyChunks: Buffer[] = []; req.on('data', chunk => { bodyChunks.push(chunk); }).on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks); const requestInit: RequestInit = { method: req.method, headers: req.headers as HeadersInit, body: (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) ? bodyBuffer : undefined, };
        app.handle(new Request(url, requestInit)).then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) { try { if (response.body instanceof ReadableStream) { await response.body.pipeTo(new WritableStream({ write(chunk) { res.write(chunk); }, close() { res.end(); }, abort(err) { console.error('Response stream aborted:', err); res.destroy(err instanceof Error ? err : new Error(String(err))); } })); } else { console.warn('Response body is not a ReadableStream:', typeof response.body); res.end(response.body); } } catch (pipeError) { console.error('Error piping response body:', pipeError); if (!res.writableEnded) { res.end(); } } } else { res.end(); }
        }).catch((err) => { console.error('Error in app.handle:', err); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Internal Server Error during request handling' })); } });
    }).on('error', (err) => { console.error('Request stream error:', err); if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Bad Request stream' })); } });
});
server.listen(config.server.port, () => { console.log(`-------------------------------------------------------`); console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`); console.log(`   Version: ${appVersion}`); console.log(`   Mode: ${config.server.nodeEnv}`); console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`); console.log(`   DB Path: ${config.db.sqlitePath}`); console.log(`   Ollama URL: ${config.ollama.baseURL}`); console.log(`   Ollama Model: ${getActiveModel()} (Active)`); console.log(`   Configured Context: ${getConfiguredContextSize() ?? 'default'}`); console.log(`-------------------------------------------------------`); console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`); console.log(`Health Check: http://localhost:${config.server.port}/api/health`); console.log(`-------------------------------------------------------`); });


export default app;
export type App = typeof app;
