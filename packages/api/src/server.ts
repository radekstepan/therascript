// packages/api/src/server.ts
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
import { checkModelStatus, listModels, loadOllamaModel } from './services/ollamaService.js';
import { setActiveModel, getActiveModel } from './services/activeModelService.js'; // Added state management
// --- End Update ---
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

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
    modified_at: t.String(), // Expecting string from service layer now
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
// Added modelChecked field
const OllamaStatusResponseSchema = t.Object({
    activeModel: t.String(), // The model name currently active in the backend state
    modelChecked: t.String(), // The specific model name whose status was checked
    loaded: t.Boolean(),         // Whether modelChecked is loaded
    details: t.Optional(OllamaModelInfoSchema) // Details if modelChecked is loaded
});
// --- End Schema ---
// --- Rename LoadModelBodySchema to SetModelBodySchema ---
const SetModelBodySchema = t.Object({
    modelName: t.String({ minLength: 1, error: "Model name is required." })
});
// --- End Schema ---


const app = new Elysia()
    .model({
        setModelBody: SetModelBodySchema, // Use new name
        ollamaModelInfo: OllamaModelInfoSchema, // Add for reuse
        availableModelsResponse: AvailableModelsResponseSchema,
        ollamaStatusResponse: OllamaStatusResponseSchema, // Use updated schema
    })
    .use(cors({ origin: config.server.corsOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', '*'], }))
    .onRequest(({ request }) => { const origin = request.headers.get('origin'); console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`); })
    .onAfterHandle(({ request, set }) => { console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`); })
    .use(swagger({ path: '/api/docs', exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'], documentation: { info: { title: 'Therascript API (Elysia)', version: appVersion }, tags: [ { name: 'Ollama', description: 'Ollama Management Endpoints' } ] } }))
    .onError(({ code, error, set, request }) => { // Standard Error Handling Logic
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
            console.log(`[API Models] Requesting available models`);
            try { const models = await listModels(); set.status = 200; return { models }; }
            catch (error: any) { console.error(`[API Models] Error fetching available models:`, error); if (error instanceof InternalServerError) throw error; throw new InternalServerError(`Failed to fetch available models from Ollama.`, error); }
        }, { response: { 200: 'availableModelsResponse', 500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }) }, detail: { summary: 'List locally available Ollama models' } })

        // --- NEW: Set Model Endpoint ---
        .post('/set-model', async ({ body, set }) => {
            const { modelName } = body;
            console.log(`[API SetModel] Received request to set active model to: ${modelName}`);
            try {
                // 1. Update the active model in the state service
                setActiveModel(modelName);

                // 2. Trigger the load process for the new active model
                // (This uses generate/chat to ensure Ollama attempts loading)
                await loadOllamaModel(modelName); // This might throw if model not found locally

                set.status = 200; // OK - state updated, load triggered
                return { message: `Active model set to ${modelName}. Load initiated. Check status.` };
            } catch (error: any) {
                 console.error(`[API SetModel] Error setting or loading model ${modelName}:`, error);
                 // Don't revert active model on load error? Or should we? For now, leave it set.
                 if (error instanceof ApiError) throw error; // Re-throw known errors (like BadRequest if model not found)
                 throw new InternalServerError(`Failed to set active model or initiate load for ${modelName}.`, error);
            }
        }, {
            body: 'setModelBody', // Use the schema model
            response: {
                 200: t.Object({ message: t.String() }), // Changed status code to 200 OK
                 400: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()), validationErrors: t.Optional(t.Any()) }),
                 500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) })
             },
            detail: { summary: 'Set the active Ollama model for the backend and trigger its load' }
        })
        // --- END NEW ---

        // --- Modified Unload Endpoint ---
        .post('/unload', async ({ set }) => {
            const modelToUnload = getActiveModel(); // Unload the currently active model
            console.log(`[API Unload] Received request to unload active model: ${modelToUnload}`);
            try {
                // Use keep_alive: 0 on a chat request for the *active* model
                await ollama.chat({
                    model: modelToUnload, // Target the active model
                    messages: [{ role: 'user', content: 'unload request' }],
                    keep_alive: 0,
                    stream: false,
                });
                console.log(`[API Unload] Sent unload request (keep_alive: 0) for active model ${modelToUnload}`);
                // Note: We don't reset the activeModel state here, /status will reflect it's not loaded
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
        // --- End Modified Unload ---

        // --- Updated Status Endpoint ---
        .get('/status', async ({ query, set }) => {
            const currentActiveModel = getActiveModel(); // Get dynamically active model
            // Check specific model if requested, otherwise check the active model
            const modelNameToCheck = query.modelName ?? currentActiveModel;

            console.log(`[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel})`);
            try {
                const loadedModelInfo = await checkModelStatus(modelNameToCheck);
                set.status = 200;
                // --- Return updated structure ---
                return {
                    activeModel: currentActiveModel, // Report the dynamic active model
                    modelChecked: modelNameToCheck,     // Return the name we actually checked
                    loaded: !!loadedModelInfo,          // Status of the checked model
                    details: loadedModelInfo ?? undefined, // Details of the checked model (if loaded)
                };
                // --- End update ---
            } catch (error: any) {
                console.error(`[API Status] Error checking status for ${modelNameToCheck}:`, error);
                if (error instanceof InternalServerError && error.message.includes('Connection refused')) { throw error; }
                throw new InternalServerError(`Failed to check status of model ${modelNameToCheck}.`);
            }
        }, {
            query: t.Optional(t.Object({ // Make query param optional
                modelName: t.Optional(t.String())
            })),
            response: {
                200: 'ollamaStatusResponse', // Use the updated schema
                500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) })
            },
            detail: { summary: 'Check if a specific (or the currently active) Ollama model is loaded & get details' }
        })
        // --- End Update ---
    ) // End /api/ollama group

    // --- Existing API Routes ---
    .get('/api/health', ({ set }) => { try { set.status = 200; return { status: 'OK', database: 'connected', timestamp: new Date().toISOString() }; } catch (dbError) { console.error("[Health Check] Database error:", dbError); throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined); } }, { detail: { tags: ['Meta'] } })
    .get('/api/schema', ({ set }) => { set.status = 501; return { message: "Use /api/docs for Swagger UI." }; }, { detail: { tags: ['Meta'] } })
    .use(sessionRoutes)
    .use(chatRoutes);

// --- Server Creation & Start ---
console.log(`[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`);
const server = http.createServer((req, res) => { // Request handling wrapper
    const host = req.headers.host || `localhost:${config.server.port}`; const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/'; const url = `http://${host}${pathAndQuery}`;
    let bodyChunks: Buffer[] = []; req.on('data', chunk => { bodyChunks.push(chunk); }).on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks); const requestInit: RequestInit = { method: req.method, headers: req.headers as HeadersInit, body: (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) ? bodyBuffer : undefined, };
        app.handle(new Request(url, requestInit)).then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) { try { if (response.body instanceof ReadableStream) { await response.body.pipeTo(new WritableStream({ write(chunk) { res.write(chunk); }, close() { res.end(); }, abort(err) { console.error('Response stream aborted:', err); res.destroy(err instanceof Error ? err : new Error(String(err))); } })); } else { console.warn('Response body is not a ReadableStream:', typeof response.body); res.end(response.body); } } catch (pipeError) { console.error('Error piping response body:', pipeError); if (!res.writableEnded) { res.end(); } } } else { res.end(); }
        }).catch((err) => { console.error('Error in app.handle:', err); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Internal Server Error during request handling' })); } });
    }).on('error', (err) => { console.error('Request stream error:', err); if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Bad Request stream' })); } });
});
server.listen(config.server.port, () => { console.log(`-------------------------------------------------------`); console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`); console.log(`   Version: ${appVersion}`); console.log(`   Mode: ${config.server.nodeEnv}`); console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`); console.log(`   DB Path: ${config.db.sqlitePath}`); console.log(`   Ollama URL: ${config.ollama.baseURL}`); console.log(`   Ollama Model: ${getActiveModel()} (Active)`); console.log(`-------------------------------------------------------`); console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`); console.log(`Health Check: http://localhost:${config.server.port}/api/health`); console.log(`-------------------------------------------------------`); });

export default app;
export type App = typeof app;
