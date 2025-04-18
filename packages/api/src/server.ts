import http from 'node:http';
import { WritableStream, ReadableStream } from 'node:stream/web';
import { Elysia, t, ValidationError, type Context, type Static } from 'elysia'; // Ensure Context is imported
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import ollama from 'ollama';
import config from './config/index.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { ApiError, InternalServerError, ConflictError, BadRequestError, NotFoundError } from './errors.js'; // Added NotFoundError
// --- Update service imports ---
import {
    checkModelStatus, listModels, loadOllamaModel,
    // pullOllamaModel, // Removed old SSE pull
    startPullModelJob, getPullModelJobStatus, cancelPullModelJob, // Added new pull functions
    OllamaPullJobStatus, // Added job status type
} from './services/ollamaService.js';
import { setActiveModelAndContext, getActiveModel, getConfiguredContextSize } from './services/activeModelService.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import type { OllamaModelInfo } from './types/index.js'; // <-- Import OllamaModelInfo type

// Removed TextEncoder as it's not needed for polling

// --- Initial setup, version reading, CORS, request logging (unchanged) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let appVersion = '0.0.0';
try {
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
    // Optional fields from /ps check
    size_vram: t.Optional(t.Number()),
    expires_at: t.Optional(t.String()),
    size_total: t.Optional(t.Number()),
});
const AvailableModelsResponseSchema = t.Object({
    models: t.Array(OllamaModelInfoSchema),
});
// --- Update Ollama Status Response Schema ---
const OllamaStatusResponseSchema = t.Object({
    status: t.Union([t.Literal('available'), t.Literal('unavailable')]), // Added status field
    activeModel: t.String(), // Keep, might be N/A if unavailable
    modelChecked: t.String(), // Keep
    loaded: t.Boolean(), // Keep
    details: t.Optional(OllamaModelInfoSchema), // Keep
    configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])), // Keep
});
const SetModelBodySchema = t.Object({
    modelName: t.String({ minLength: 1, error: "Model name is required." }),
    // Context size can be number or null (for default)
    contextSize: t.Optional(t.Union([
        t.Number({ minimum: 1, error: "Context size must be a positive integer." }),
        t.Null()
    ]))
});
const PullModelBodySchema = t.Object({
    modelName: t.String({ minLength: 1, error: "Model name is required." })
});
// --- NEW Schemas for Polling ---
const StartPullResponseSchema = t.Object({
    jobId: t.String(),
    message: t.String()
});
const PullStatusResponseSchema = t.Object({
    jobId: t.String(),
    modelName: t.String(),
    status: t.String(), // Keep as string for simplicity, frontend maps to specific states
    message: t.String(),
    progress: t.Optional(t.Number()),
    completedBytes: t.Optional(t.Number()),
    totalBytes: t.Optional(t.Number()),
    startTime: t.Number(),
    endTime: t.Optional(t.Number()),
    error: t.Optional(t.String()),
});
const JobIdParamSchema = t.Object({
    jobId: t.String({ minLength: 1, error: "Job ID must be provided" })
});
const CancelPullResponseSchema = t.Object({
    message: t.String()
});
// --- END NEW ---


const app = new Elysia()
    .model({
        // Existing models
        setModelBody: SetModelBodySchema,
        pullModelBody: PullModelBodySchema,
        ollamaModelInfo: OllamaModelInfoSchema,
        availableModelsResponse: AvailableModelsResponseSchema,
        ollamaStatusResponse: OllamaStatusResponseSchema, // Use updated schema
        // --- Add new models ---
        startPullResponse: StartPullResponseSchema,
        pullStatusResponse: PullStatusResponseSchema,
        jobIdParam: JobIdParamSchema,
        cancelPullResponse: CancelPullResponseSchema,
        // --- End new models ---
    })
    .use(cors({
        origin: config.server.corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', '*'], // Allow common headers
        // exposedHeaders: [], // Define if UI needs to read specific headers
        // credentials: true, // Set if needed
    }))
    .onRequest(({ request }) => {
        const origin = request.headers.get('origin');
        console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`);
    })
    .onAfterHandle(({ request, set }) => {
        console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`);
    })
    .use(swagger({
        path: '/api/docs',
        exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'], // Exclude swagger endpoints and health/schema
        documentation: {
            info: { title: 'Therascript API (Elysia)', version: appVersion },
            tags: [
                { name: 'Session', description: 'Session and Transcript Endpoints' },
                { name: 'Chat', description: 'Chat Interaction Endpoints' },
                { name: 'Transcription', description: 'Transcription Job Management' },
                { name: 'Ollama', description: 'Ollama LLM Management Endpoints' },
                { name: 'Meta', description: 'API Metadata and Health' },
            ]
        }
    }))
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
             // Log the full error object if it's not a standard Error instance
             if (!(error instanceof Error)) console.error("Full Error Object:", error);
         }

         // Handle specific framework/API errors
         if (error instanceof ApiError) {
             set.status = error.status;
             return { error: error.name, message: error.message, details: error.details };
         }
         if (error instanceof NotFoundError) { // Handle NotFoundError explicitly from polling etc.
             set.status = 404;
             return { error: error.name, message: error.message, details: error.details };
         }
         if (error instanceof ConflictError) { // Handle ConflictError explicitly from cancel etc.
              set.status = 409;
              return { error: error.name, message: error.message, details: error.details };
         }


         // Handle Elysia-specific error codes
         switch (code) {
             case 'NOT_FOUND':
                 set.status = 404;
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
                 set.status = 400;
                 return { error: 'ValidationError', message: 'Request validation failed.', details: errorMessage, validationErrors: validationDetails };
             case 'UNKNOWN':
                 console.error("[Error Handler] Unknown Elysia Error Code:", error);
                 const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined);
                 set.status = unknownInternalError.status;
                 return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
             default:
                 // Let other errors fall through to generic handling
                 break;
         }

         // Handle potential SQLite errors (example)
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

         // Fallback for any other unhandled errors
         console.error("[Error Handler] Unhandled Error Type:", error);
         const fallbackError = new InternalServerError('An unexpected server error occurred.', error instanceof Error ? error : undefined);
         set.status = fallbackError.status;
         return { error: fallbackError.name, message: fallbackError.message, details: fallbackError.details };
    })
    // --- Ollama Management Routes ---
    .group('/api/ollama', { detail: { tags: ['Ollama'] } }, (app) => app
        .get('/available-models', async ({ set }) => {
            console.log(`[API Models] Requesting available models`);
            try {
                const models = await listModels();
                set.status = 200;
                return { models };
            } catch (error: any) {
                console.error(`[API Models] Error fetching available models:`, error);
                // Don't expose internal errors directly unless needed
                if (error instanceof InternalServerError) throw error;
                throw new InternalServerError(`Failed to fetch available models from Ollama.`, error);
            }
        }, {
            response: { 200: 'availableModelsResponse', 500: t.Any() }, // Define potential 500 response
            detail: { summary: 'List locally available Ollama models' }
        })

        .post('/set-model', async ({ body, set }) => {
            const { modelName, contextSize } = body; // Destructure contextSize
            const sizeLog = contextSize === undefined ? 'default' : (contextSize === null ? 'explicit default' : contextSize);
            console.log(`[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}`);
            try {
                // 1. Update active model and context size in the state service
                setActiveModelAndContext(modelName, contextSize); // Pass both

                // 2. Trigger load process (which now includes ensureOllamaReady)
                await loadOllamaModel(modelName);

                set.status = 200;
                return { message: `Active model set to ${modelName} (context: ${getConfiguredContextSize() ?? 'default'}). Load initiated. Check status.` };
            } catch (error: any) {
                 console.error(`[API SetModel] Error setting/loading model ${modelName} (context: ${sizeLog}):`, error);
                 if (error instanceof ApiError) throw error; // Re-throw specific API errors
                 throw new InternalServerError(`Failed to set active model or initiate load for ${modelName}.`, error);
            }
        }, {
            body: 'setModelBody', // Use updated schema
            response: {
                 200: t.Object({ message: t.String() }),
                 // Define specific error responses
                 400: t.Any(), // For BadRequestError (model not found locally, invalid context size)
                 500: t.Any()  // For InternalServerError (connection refused, other load errors)
             },
            detail: { summary: 'Set the active Ollama model and context size, trigger load' }
        })

        .post('/unload', async ({ set }) => {
            const modelToUnload = getActiveModel();
            console.log(`[API Unload] Received request to unload active model: ${modelToUnload}`);
            try {
                // Use ollama.chat with keep_alive: 0 to request unload via the API
                // This asks the Ollama server *running inside the container* to free up resources
                // It does NOT stop or kill the Docker container itself.
                await ollama.chat({
                    model: modelToUnload,
                    messages: [{ role: 'user', content: 'unload request' }], // Trivial message required by API
                    keep_alive: 0, // Key parameter to request unload from memory after this request
                    stream: false,
                });
                console.log(`[API Unload] Sent unload request (keep_alive: 0) for active model ${modelToUnload}`);
                set.status = 200;
                return { message: `Unload request sent for model ${modelToUnload}. It will be unloaded shortly if idle.` };
            } catch (error: any) {
                console.error(`[API Unload] Error sending unload request for ${modelToUnload}:`, error);
                // Handle model not found gracefully (might already be unloaded by Ollama)
                if (error.message?.includes('model') && error.message?.includes('not found')) {
                    console.log(`[API Unload] Model ${modelToUnload} was not found by Ollama (likely already unloaded).`);
                    set.status = 200; // Still OK from API perspective
                    return { message: `Model ${modelToUnload} was not found (likely already unloaded).` };
                }
                 // Handle connection errors
                 const isConnectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED');
                 if (isConnectionError) {
                    // Return 200 but indicate it couldn't connect, maybe it's already stopped/unloaded
                    console.warn(`[API Unload] Connection refused when trying to unload ${modelToUnload}. Assuming stopped/unloaded.`);
                    set.status = 200;
                    return { message: `Could not connect to Ollama to explicitly unload ${modelToUnload}. It might already be stopped or unloaded.`};
                    // Previous: throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
                 }
                // Other errors communicating with Ollama API
                throw new InternalServerError(`Failed to send unload request to Ollama service for model ${modelToUnload}.`);
             }
        }, {
             response: {
                 200: t.Object({ message: t.String() }),
                 500: t.Any() // For connection or other internal errors
             },
             detail: { summary: 'Request Ollama to unload the currently active model from memory' }
        })

        // --- MODIFIED Pull Model Endpoint (Polling - POST to start) ---
        .post('/pull-model', ({ body, set }) => { // Removed async, doesn't need await now
            const { modelName } = body;
            console.log(`[API PullModel] Received request to START pull model job: ${modelName}`);
            try {
                // Start the job in the background, get job ID
                const jobId = startPullModelJob(modelName);
                set.status = 202; // Accepted: Job started, check status later
                return { jobId, message: `Pull job started for ${modelName}. Check status using job ID.` };
            } catch (error: any) {
                 console.error(`[API PullModel] Error initiating pull job for model ${modelName}:`, error);
                 if (error instanceof ApiError) throw error; // Re-throw known API errors
                 throw new InternalServerError(`Failed to initiate pull job for model ${modelName}.`, error);
            }
        }, {
            body: 'pullModelBody',
            response: { // Define responses for starting the job
                202: 'startPullResponse', // Use the new schema for success
                400: t.Any(), // e.g., Invalid model name format (though service checks this now)
                500: t.Any(), // e.g., Internal error starting background task
            },
            detail: {
                summary: 'Initiate downloading a new Ollama model (poll status)',
            }
        })
        // --- END MODIFIED Pull Model ---

        // --- NEW Pull Model Status Endpoint (Polling - GET status) ---
        .get('/pull-status/:jobId', ({ params, set }) => {
            const { jobId } = params;
            console.log(`[API PullStatus] Received status request for job: ${jobId}`);
            try {
                const status = getPullModelJobStatus(jobId);
                if (!status) {
                     // Use the specific NotFoundError for clarity
                     throw new NotFoundError(`Pull job with ID ${jobId} not found.`);
                }
                set.status = 200;
                 // Map internal status to response schema (they match closely here)
                 // Ensure all fields expected by PullStatusResponseSchema are included
                 return {
                     jobId: status.jobId,
                     modelName: status.modelName,
                     status: status.status,
                     message: status.message,
                     progress: status.progress,
                     completedBytes: status.completedBytes,
                     totalBytes: status.totalBytes,
                     startTime: status.startTime,
                     endTime: status.endTime,
                     error: status.error,
                 };
            } catch (error: any) {
                 console.error(`[API PullStatus] Error getting status for job ${jobId}:`, error);
                 if (error instanceof ApiError) throw error; // Re-throw known API errors like NotFoundError
                 throw new InternalServerError(`Failed to get status for pull job ${jobId}.`, error);
            }
        }, {
            params: 'jobIdParam', // Use the new param schema
            response: {
                200: 'pullStatusResponse', // Use the new response schema
                404: t.Any(), // Job not found error
                500: t.Any(), // Other internal errors
            },
            detail: {
                summary: 'Get the status and progress of an ongoing Ollama model pull job',
            }
        })
        // --- END NEW Status Endpoint ---

         // --- NEW Cancel Pull Model Endpoint ---
        .post('/cancel-pull/:jobId', ({ params, set }) => {
            const { jobId } = params;
            console.log(`[API CancelPull] Received cancel request for job: ${jobId}`);
            try {
                const cancelled = cancelPullModelJob(jobId);
                if (!cancelled) {
                    // Could be 404 (not found) or 409 (already finished/canceling)
                    const jobStatus = getPullModelJobStatus(jobId); // Check current status
                    if (!jobStatus) {
                        throw new NotFoundError(`Pull job with ID ${jobId} not found.`);
                    } else {
                        // Throw conflict if already done or canceling
                        throw new ConflictError(`Cannot cancel job ${jobId}, status is ${jobStatus.status}.`);
                    }
                }
                set.status = 200;
                return { message: `Cancellation request sent for job ${jobId}.` };
            } catch (error: any) {
                 console.error(`[API CancelPull] Error cancelling job ${jobId}:`, error);
                 if (error instanceof ApiError) throw error; // Re-throw known API errors
                 throw new InternalServerError(`Failed to cancel pull job ${jobId}.`, error);
            }
        }, {
            params: 'jobIdParam',
            response: {
                 200: 'cancelPullResponse',
                 404: t.Any(), // Not Found error
                 409: t.Any(), // Conflict error (already done/canceling)
                 500: t.Any(), // Other internal errors
            },
            detail: {
                summary: 'Attempt to cancel an ongoing Ollama model pull job',
            }
        })
        // --- END NEW Cancel Endpoint ---

        // --- Updated Status Endpoint ---
        .get('/status', async ({ query, set }) => {
            const currentActiveModel = getActiveModel();
            const currentConfiguredContext = getConfiguredContextSize(); // Get context size
            const modelNameToCheck = query.modelName ?? currentActiveModel;

            console.log(`[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'})`);
            try {
                // checkModelStatus now returns OllamaModelInfo | null | { status: 'unavailable' }
                const loadedModelResult = await checkModelStatus(modelNameToCheck);

                set.status = 200;
                // Handle the different return types from checkModelStatus
                if (loadedModelResult && 'status' in loadedModelResult && loadedModelResult.status === 'unavailable') {
                    // Ollama service is not running or reachable
                    return {
                        status: 'unavailable',
                        activeModel: currentActiveModel, // Still report the configured active model
                        modelChecked: modelNameToCheck,
                        loaded: false,
                        details: undefined,
                        configuredContextSize: currentConfiguredContext,
                    };
                } else {
                    // Ollama is available, check if the specific model is loaded
                    const loadedModelInfo = loadedModelResult as OllamaModelInfo | null; // Cast after checking unavailable case
                    return {
                        status: 'available', // Ollama service is running
                        activeModel: currentActiveModel,
                        modelChecked: modelNameToCheck,
                        loaded: !!loadedModelInfo, // True if model info was returned, false if null
                        details: loadedModelInfo ?? undefined,
                        configuredContextSize: currentConfiguredContext,
                    };
                }
            } catch (error: any) {
                // This catch block might be less likely to be hit now that checkModelStatus handles unavailability
                // but keep it for unexpected errors during the check process.
                console.error(`[API Status] Unexpected error checking status for ${modelNameToCheck}:`, error);
                throw new InternalServerError(`Failed to check status of model ${modelNameToCheck}.`);
            }
        }, {
            query: t.Optional(t.Object({ modelName: t.Optional(t.String()) })),
            response: {
                200: 'ollamaStatusResponse', // Use updated schema
                500: t.Any() // For connection errors etc.
            },
            detail: { summary: 'Check loaded status & configured context size for active/specific model' }
        })
        // --- End Status ---
    ) // End /api/ollama group

    // --- Existing API Routes (unchanged) ---
    .get('/api/health', ({ set }) => {
        // TODO: Add deeper health check (e.g., DB ping, Ollama ping)
        try {
            set.status = 200;
            return { status: 'OK', database: 'connected', timestamp: new Date().toISOString() };
        } catch (dbError) {
            console.error("[Health Check] Database error:", dbError);
            throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined);
        }
     }, { detail: { tags: ['Meta'] } })
    .get('/api/schema', ({ set }) => {
         // Redirect or point to Swagger UI
         set.status = 501; return { message: "API schema definition is not available here. Use /api/docs for Swagger UI." };
     }, { detail: { tags: ['Meta'] } })
    .use(sessionRoutes)
    .use(chatRoutes);


// --- Server Startup Check (Modified to be less critical) ---
async function checkOllamaConnectionOnStartup() {
    console.log(`[Server Startup] Checking Ollama connection at ${config.ollama.baseURL}...`);
    try {
        // Use a shorter timeout for startup check
        await axios.get(config.ollama.baseURL, { timeout: 2000 });
        console.log("[Server Startup] ✅ Ollama connection successful.");
        return true;
    } catch (error: any) {
        // This is now just a warning, not a fatal error
        console.warn("-------------------------------------------------------");
        console.warn(`[Server Startup] ⚠️ Ollama service NOT DETECTED at ${config.ollama.baseURL}`);
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED') { console.warn("   Reason: Connection refused. (This is expected if not started yet)."); }
            else { console.warn(`   Reason: ${error.message}`); }
        } else { console.warn(`   Reason: An unexpected error occurred: ${error.message}`); }
        console.warn("   Ollama service will be started on demand when needed (e.g., loading a model).");
        console.warn("-------------------------------------------------------");
        return false;
    }
}

// --- Server Creation & Start (unchanged) ---
console.log(`[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`);
const server = http.createServer((req, res) => {
    const host = req.headers.host || `localhost:${config.server.port}`;
    const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/';
    const url = `http://${host}${pathAndQuery}`;

    let bodyChunks: Buffer[] = [];
    req.on('data', chunk => { bodyChunks.push(chunk); })
    .on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks);
        const requestInit: RequestInit = {
            method: req.method,
            headers: req.headers as HeadersInit,
            body: (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) ? bodyBuffer : undefined,
        };

        app.handle(new Request(url, requestInit)).then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) {
                try {
                    // Handle both ReadableStream and other body types
                    if (response.body instanceof ReadableStream) {
                        // Pipe the stream to the response
                        await response.body.pipeTo(new WritableStream({
                            write(chunk) { res.write(chunk); },
                            close() { res.end(); },
                            abort(err) { console.error('Response stream aborted:', err); res.destroy(err instanceof Error ? err : new Error(String(err))); }
                        }));
                    } else {
                        // Handle non-stream bodies (like JSON from error handlers)
                        // console.warn('[Server Response] Response body is not a ReadableStream, attempting direct write/end.');
                        res.end(response.body);
                    }
                } catch (pipeError) {
                    console.error('Error piping response body:', pipeError);
                    if (!res.writableEnded) { res.end(); } // Ensure response ends on error
                }
            } else {
                res.end(); // End response if no body
            }
        }).catch((err) => {
            console.error('Error in app.handle:', err);
            // Attempt to send a 500 response if headers not already sent
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
            }
            if (!res.writableEnded) {
                res.end(JSON.stringify({ error: 'Internal Server Error during request handling' }));
            }
        });
    })
    .on('error', (err) => { // Handle errors on the incoming request stream itself
        console.error('Request stream error:', err);
        if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); }
        if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Bad Request stream' })); }
    });
});

// Start server AFTER checking Ollama connection (check is now non-blocking)
checkOllamaConnectionOnStartup().then(() => {
    server.listen(config.server.port, () => {
        console.log(`-------------------------------------------------------`);
        console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`);
        console.log(`   Version: ${appVersion}`);
        console.log(`   Mode: ${config.server.nodeEnv}`);
        console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`);
        console.log(`   DB Path: ${config.db.sqlitePath}`);
        console.log(`   Ollama URL: ${config.ollama.baseURL}`);
        console.log(`   Ollama Model: ${getActiveModel()} (Active)`);
        console.log(`   Configured Context: ${getConfiguredContextSize() ?? 'default'}`);
        console.log(`-------------------------------------------------------`);
        console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`);
        console.log(`Health Check: http://localhost:${config.server.port}/api/health`);
        console.log(`-------------------------------------------------------`);
    });
});


export default app;
export type App = typeof app; // Export type for potential client generation