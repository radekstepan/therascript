// packages/api/src/server.ts
import http from 'node:http';
import { WritableStream, ReadableStream } from 'node:stream/web';
import { Elysia, t, ValidationError, type Context as ElysiaContext, type Static } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import ollama from 'ollama';
import config from './config/index.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { ApiError, InternalServerError, ConflictError, BadRequestError, NotFoundError } from './errors.js';
import {
    checkModelStatus, listModels, loadOllamaModel,
    startPullModelJob, getPullModelJobStatus, cancelPullModelJob,
    deleteOllamaModel as deleteOllamaModelService,
    OllamaPullJobStatus,
} from './services/ollamaService.js';
import { setActiveModelAndContext, getActiveModel, getConfiguredContextSize } from './services/activeModelService.js';
// --- Import new Docker service ---
import { getProjectContainerStatus } from './services/dockerManagementService.js';
// --- End Import ---
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import type { OllamaModelInfo, DockerContainerStatus } from './types/index.js'; // <-- Added DockerContainerStatus
import { closeDb } from './db/sqliteService.js'; // Import closeDb
// REMOVED: import { stopManagedContainers } from './services/dockerService.js'; // Docker cleanup handled externally

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

// --- Ollama Response/Request Schemas (unchanged) ---
const OllamaModelDetailSchema = t.Object({ format: t.String(), family: t.String(), families: t.Union([t.Array(t.String()), t.Null()]), parameter_size: t.String(), quantization_level: t.String(), });
const OllamaModelInfoSchema = t.Object({ name: t.String(), modified_at: t.String(), size: t.Number(), digest: t.String(), details: OllamaModelDetailSchema, size_vram: t.Optional(t.Number()), expires_at: t.Optional(t.String()), size_total: t.Optional(t.Number()), });
const AvailableModelsResponseSchema = t.Object({ models: t.Array(OllamaModelInfoSchema), });
const OllamaStatusResponseSchema = t.Object({ status: t.Union([t.Literal('available'), t.Literal('unavailable')]), activeModel: t.String(), modelChecked: t.String(), loaded: t.Boolean(), details: t.Optional(OllamaModelInfoSchema), configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])), });
const SetModelBodySchema = t.Object({ modelName: t.String({ minLength: 1, error: "Model name is required." }), contextSize: t.Optional(t.Union([ t.Number({ minimum: 1, error: "Context size must be a positive integer." }), t.Null() ])) });
const PullModelBodySchema = t.Object({ modelName: t.String({ minLength: 1, error: "Model name is required." }) });
const StartPullResponseSchema = t.Object({ jobId: t.String(), message: t.String() });
const PullStatusResponseSchema = t.Object({ jobId: t.String(), modelName: t.String(), status: t.String(), message: t.String(), progress: t.Optional(t.Number()), completedBytes: t.Optional(t.Number()), totalBytes: t.Optional(t.Number()), startTime: t.Number(), endTime: t.Optional(t.Number()), error: t.Optional(t.String()), });
const JobIdParamSchema = t.Object({ jobId: t.String({ minLength: 1, error: "Job ID must be provided" }) });
const CancelPullResponseSchema = t.Object({ message: t.String() });
const DeleteModelBodySchema = t.Object({ modelName: t.String({ minLength: 1, error: "Model name is required." }) });
const DeleteModelResponseSchema = t.Object({ message: t.String() });

// --- Docker Status Schemas ---
const DockerPortSchema = t.Object({
    PrivatePort: t.Number(),
    PublicPort: t.Optional(t.Number()),
    Type: t.String(),
    IP: t.Optional(t.String()),
});
const DockerContainerStatusSchema = t.Object({
    id: t.String(),
    name: t.String(),
    image: t.String(),
    state: t.String(),
    status: t.String(),
    ports: t.Array(DockerPortSchema),
});
const DockerStatusResponseSchema = t.Object({
    containers: t.Array(DockerContainerStatusSchema),
});
// --- End Docker Schemas ---

const app = new Elysia()
    .model({
        // Existing models...
        setModelBody: SetModelBodySchema,
        pullModelBody: PullModelBodySchema,
        ollamaModelInfo: OllamaModelInfoSchema,
        availableModelsResponse: AvailableModelsResponseSchema,
        ollamaStatusResponse: OllamaStatusResponseSchema,
        startPullResponse: StartPullResponseSchema,
        pullStatusResponse: PullStatusResponseSchema,
        jobIdParam: JobIdParamSchema,
        cancelPullResponse: CancelPullResponseSchema,
        deleteModelBody: DeleteModelBodySchema,
        deleteModelResponse: DeleteModelResponseSchema,
        // Add Docker models
        dockerContainerStatus: DockerContainerStatusSchema,
        dockerStatusResponse: DockerStatusResponseSchema,
    })
    .use(cors({
        origin: config.server.corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', '*'],
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
        exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'],
        documentation: {
            info: { title: 'Therascript API (Elysia)', version: appVersion },
            tags: [
                { name: 'Session', description: 'Session and Transcript Endpoints' },
                { name: 'Chat', description: 'Chat Interaction Endpoints' },
                { name: 'Transcription', description: 'Transcription Job Management' },
                { name: 'Ollama', description: 'Ollama LLM Management Endpoints' },
                // --- Add Docker Tag ---
                { name: 'Docker', description: 'Docker Container Management' },
                // --- End Add ---
                { name: 'Meta', description: 'API Metadata and Health' },
            ]
        }
    }))
    .onError(({ code, error, set, request }) => {
         const errorMessage = getErrorMessage(error);
         let path = 'N/A';
         let method = 'N/A';
         try { if (request?.url) path = new URL(request.url).pathname; if (request?.method) method = request.method; } catch { }

         console.error(`[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`);
         if (!config.server.isProduction) { const stack = getErrorStack(error); if (stack) console.error("Stack:", stack); if (!(error instanceof Error)) console.error("Full Error Object:", error); }

         if (error instanceof ApiError) { set.status = error.status; return { error: error.name, message: error.message, details: error.details }; }
         if (error instanceof NotFoundError) { set.status = 404; return { error: error.name, message: error.message, details: error.details }; }
         if (error instanceof ConflictError) { set.status = 409; return { error: error.name, message: error.message, details: error.details }; }

         switch (code) {
             case 'NOT_FOUND': set.status = 404; return { error: 'NotFound', message: `Route ${method} ${path} not found.` };
             case 'INTERNAL_SERVER_ERROR': const internalError = new InternalServerError('An unexpected internal error occurred.', error instanceof Error ? error : undefined); set.status = internalError.status; return { error: internalError.name, message: internalError.message, details: internalError.details };
             case 'PARSE': set.status = 400; return { error: 'ParseError', message: 'Failed to parse request body.', details: errorMessage };
             case 'VALIDATION': const validationDetails = error instanceof ValidationError ? error.all : undefined; set.status = 400; return { error: 'ValidationError', message: 'Request validation failed.', details: errorMessage, validationErrors: validationDetails };
             case 'UNKNOWN': console.error("[Error Handler] Unknown Elysia Error Code:", error); const unknownInternalError = new InternalServerError('An unknown internal error occurred.', error instanceof Error ? error : undefined); set.status = unknownInternalError.status; return { error: unknownInternalError.name, message: unknownInternalError.message, details: unknownInternalError.details };
             default: break;
         }

         const sqliteCode = (error as any)?.code;
         if (typeof sqliteCode === 'string' && sqliteCode.startsWith('SQLITE_')) {
             if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteCode.includes('CONSTRAINT')) { const conflictError = new ConflictError('Database constraint violation.', config.server.isProduction ? undefined : errorMessage); set.status = conflictError.status; return { error: conflictError.name, message: conflictError.message, details: conflictError.details }; }
             else { const dbError = new InternalServerError('A database operation failed.', error instanceof Error ? error : undefined); set.status = dbError.status; return { error: dbError.name, message: dbError.message, details: dbError.details }; }
         }

         console.error("[Error Handler] Unhandled Error Type:", error); const fallbackError = new InternalServerError('An unexpected server error occurred.', error instanceof Error ? error : undefined); set.status = fallbackError.status; return { error: fallbackError.name, message: fallbackError.message, details: fallbackError.details };
    })
    // --- Ollama Management Routes (unchanged logic) ---
    .group('/api/ollama', { detail: { tags: ['Ollama'] } }, (app) => app
        // ... (keep existing ollama routes) ...
        .get('/available-models', async ({ set }) => {
            console.log(`[API Models] Requesting available models`);
            try { const models = await listModels(); set.status = 200; return { models }; }
            catch (error: any) { console.error(`[API Models] Error fetching available models:`, error); if (error instanceof InternalServerError) throw error; throw new InternalServerError(`Failed to fetch available models from Ollama.`, error); }
        }, { response: { 200: 'availableModelsResponse', 500: t.Any() }, detail: { summary: 'List locally available Ollama models' } })
        .post('/set-model', async ({ body, set }) => {
            const { modelName, contextSize } = body;
            const sizeLog = contextSize === undefined ? 'default' : (contextSize === null ? 'explicit default' : contextSize);
            console.log(`[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}`);
            try { setActiveModelAndContext(modelName, contextSize); await loadOllamaModel(modelName); set.status = 200; return { message: `Active model set to ${modelName} (context: ${getConfiguredContextSize() ?? 'default'}). Load initiated. Check status.` }; }
            catch (error: any) { console.error(`[API SetModel] Error setting/loading model ${modelName} (context: ${sizeLog}):`, error); if (error instanceof ApiError) throw error; throw new InternalServerError(`Failed to set active model or initiate load for ${modelName}.`, error); }
        }, { body: 'setModelBody', response: { 200: t.Object({ message: t.String() }), 400: t.Any(), 500: t.Any() }, detail: { summary: 'Set the active Ollama model and context size, trigger load' } })
        .post('/unload', async ({ set }) => {
            const modelToUnload = getActiveModel();
            console.log(`[API Unload] Received request to unload active model: ${modelToUnload}`);
            try { await ollama.chat({ model: modelToUnload, messages: [{ role: 'user', content: 'unload request' }], keep_alive: 0, stream: false, }); console.log(`[API Unload] Sent unload request (keep_alive: 0) for active model ${modelToUnload}`); set.status = 200; return { message: `Unload request sent for model ${modelToUnload}. It will be unloaded shortly if idle.` }; }
            catch (error: any) { console.error(`[API Unload] Error sending unload request for ${modelToUnload}:`, error); if (error.message?.includes('model') && error.message?.includes('not found')) { console.log(`[API Unload] Model ${modelToUnload} was not found by Ollama (likely already unloaded).`); set.status = 200; return { message: `Model ${modelToUnload} was not found (likely already unloaded).` }; } const isConnectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED'); if (isConnectionError) { console.warn(`[API Unload] Connection refused when trying to unload ${modelToUnload}. Assuming stopped/unloaded.`); set.status = 200; return { message: `Could not connect to Ollama to explicitly unload ${modelToUnload}. It might already be stopped or unloaded.`}; } throw new InternalServerError(`Failed to send unload request to Ollama service for model ${modelToUnload}.`); }
        }, { response: { 200: t.Object({ message: t.String() }), 500: t.Any() }, detail: { summary: 'Request Ollama to unload the currently active model from memory' } })
        .post('/pull-model', ({ body, set }) => {
            const { modelName } = body;
            console.log(`[API PullModel] Received request to START pull model job: ${modelName}`);
            try { const jobId = startPullModelJob(modelName); set.status = 202; return { jobId, message: `Pull job started for ${modelName}. Check status using job ID.` }; }
            catch (error: any) { console.error(`[API PullModel] Error initiating pull job for model ${modelName}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError(`Failed to initiate pull job for model ${modelName}.`, error); }
        }, { body: 'pullModelBody', response: { 202: 'startPullResponse', 400: t.Any(), 500: t.Any(), }, detail: { summary: 'Initiate downloading a new Ollama model (poll status)' } })
        .get('/pull-status/:jobId', ({ params, set }) => {
            const { jobId } = params;
            console.log(`[API PullStatus] Received status request for job: ${jobId}`);
            try { const status = getPullModelJobStatus(jobId); if (!status) { throw new NotFoundError(`Pull job with ID ${jobId} not found.`); } set.status = 200; return { jobId: status.jobId, modelName: status.modelName, status: status.status, message: status.message, progress: status.progress, completedBytes: status.completedBytes, totalBytes: status.totalBytes, startTime: status.startTime, endTime: status.endTime, error: status.error, }; }
            catch (error: any) { console.error(`[API PullStatus] Error getting status for job ${jobId}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError(`Failed to get status for pull job ${jobId}.`, error); }
        }, { params: 'jobIdParam', response: { 200: 'pullStatusResponse', 404: t.Any(), 500: t.Any(), }, detail: { summary: 'Get the status and progress of an ongoing Ollama model pull job' } })
        .post('/cancel-pull/:jobId', ({ params, set }) => {
            const { jobId } = params;
            console.log(`[API CancelPull] Received cancel request for job: ${jobId}`);
            try { const cancelled = cancelPullModelJob(jobId); if (!cancelled) { const jobStatus = getPullModelJobStatus(jobId); if (!jobStatus) { throw new NotFoundError(`Pull job with ID ${jobId} not found.`); } else { throw new ConflictError(`Cannot cancel job ${jobId}, status is ${jobStatus.status}.`); } } set.status = 200; return { message: `Cancellation request sent for job ${jobId}.` }; }
            catch (error: any) { console.error(`[API CancelPull] Error cancelling job ${jobId}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError(`Failed to cancel pull job ${jobId}.`, error); }
        }, { params: 'jobIdParam', response: { 200: 'cancelPullResponse', 404: t.Any(), 409: t.Any(), 500: t.Any(), }, detail: { summary: 'Attempt to cancel an ongoing Ollama model pull job' } })
        .post('/delete-model', async ({ body, set }) => {
            const { modelName } = body;
            console.log(`[API DeleteModel] Received request to delete model: ${modelName}`);
            try { const resultMessage = await deleteOllamaModelService(modelName); set.status = 200; return { message: resultMessage }; }
            catch (error: any) { console.error(`[API DeleteModel] Error deleting model ${modelName}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError(`Failed to delete model ${modelName}.`, error); }
        }, { body: 'deleteModelBody', response: { 200: 'deleteModelResponse', 400: t.Any(), 404: t.Any(), 409: t.Any(), 500: t.Any(), }, detail: { summary: 'Delete a locally downloaded Ollama model', } })
        .get('/status', async ({ query, set }) => {
            const currentActiveModel = getActiveModel();
            const currentConfiguredContext = getConfiguredContextSize();
            const modelNameToCheck = query.modelName ?? currentActiveModel;
            console.log(`[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'})`);
            try { const loadedModelResult = await checkModelStatus(modelNameToCheck); set.status = 200; if (loadedModelResult && 'status' in loadedModelResult && loadedModelResult.status === 'unavailable') { return { status: 'unavailable', activeModel: currentActiveModel, modelChecked: modelNameToCheck, loaded: false, details: undefined, configuredContextSize: currentConfiguredContext, }; } else { const loadedModelInfo = loadedModelResult as OllamaModelInfo | null; return { status: 'available', activeModel: currentActiveModel, modelChecked: modelNameToCheck, loaded: !!loadedModelInfo, details: loadedModelInfo ?? undefined, configuredContextSize: currentConfiguredContext, }; } }
            catch (error: any) { console.error(`[API Status] Unexpected error checking status for ${modelNameToCheck}:`, error); throw new InternalServerError(`Failed to check status of model ${modelNameToCheck}.`); }
        }, { query: t.Optional(t.Object({ modelName: t.Optional(t.String()) })), response: { 200: 'ollamaStatusResponse', 500: t.Any() }, detail: { summary: 'Check loaded status & configured context size for active/specific model' } })
    ) // End /api/ollama group

    // --- NEW Docker Status Route ---
    .group('/api/docker', { detail: { tags: ['Docker'] } }, (app) => app
        .get('/status', async ({ set }) => {
            console.log('[API Docker] Requesting project container status...');
            try {
                const containers = await getProjectContainerStatus();
                set.status = 200;
                return { containers };
            } catch (error: any) {
                console.error('[API Docker] Error fetching Docker status:', error);
                if (error instanceof InternalServerError) throw error;
                throw new InternalServerError('Failed to fetch Docker container status.', error);
            }
        }, {
            response: {
                200: 'dockerStatusResponse',
                500: t.Any() // For InternalServerError
            },
            detail: {
                summary: 'Get status of project-related Docker containers'
            }
        })
    ) // End /api/docker group
    // --- END NEW Docker Route ---

    // --- Existing API Routes (unchanged) ---
    .get('/api/health', ({ set }) => { try { set.status = 200; return { status: 'OK', database: 'connected', timestamp: new Date().toISOString() }; } catch (dbError) { console.error("[Health Check] Database error:", dbError); throw new InternalServerError('Database connection failed', dbError instanceof Error ? dbError : undefined); } }, { detail: { tags: ['Meta'] } })
    .get('/api/schema', ({ set }) => { set.status = 501; return { message: "API schema definition is not available here. Use /api/docs for Swagger UI." }; }, { detail: { tags: ['Meta'] } })
    .use(sessionRoutes)
    .use(chatRoutes);

// --- Server Startup Check (unchanged) ---
async function checkOllamaConnectionOnStartup() {
    console.log(`[Server Startup] Checking Ollama connection at ${config.ollama.baseURL}...`);
    try { await axios.get(config.ollama.baseURL, { timeout: 2000 }); console.log("[Server Startup] ✅ Ollama connection successful."); return true; }
    catch (error: any) { console.warn("-------------------------------------------------------"); console.warn(`[Server Startup] ⚠️ Ollama service NOT DETECTED at ${config.ollama.baseURL}`); if (axios.isAxiosError(error)) { if (error.code === 'ECONNREFUSED') { console.warn("   Reason: Connection refused. (This is expected if not started yet)."); } else { console.warn(`   Reason: ${error.message}`); } } else { console.warn(`   Reason: An unexpected error occurred: ${error.message}`); } console.warn("   Ollama service will be started on demand when needed (e.g., loading a model)."); console.warn("-------------------------------------------------------"); return false; }
}

// --- Server Creation & Start (unchanged) ---
console.log(`[Server] Creating Node.js HTTP server wrapper on port ${config.server.port}...`);
const server = http.createServer((req, res) => {
    // This complex setup might be simplified if not strictly needed, but keeping it for now
    const host = req.headers.host || `localhost:${config.server.port}`; const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : '/'; const url = `http://${host}${pathAndQuery}`;
    let bodyChunks: Buffer[] = [];
    req.on('data', chunk => { bodyChunks.push(chunk); })
    .on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks); const requestInit: RequestInit = { method: req.method, headers: req.headers as HeadersInit, body: (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) ? bodyBuffer : undefined, };
        app.handle(new Request(url, requestInit)).then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) {
                try { if (response.body instanceof ReadableStream) { await response.body.pipeTo(new WritableStream({ write(chunk) { res.write(chunk); }, close() { res.end(); }, abort(err) { console.error('Response stream aborted:', err); res.destroy(err instanceof Error ? err : new Error(String(err))); } })); } else { res.end(response.body); } }
                catch (pipeError) { console.error('Error piping response body:', pipeError); if (!res.writableEnded) { res.end(); } }
            } else { res.end(); }
        }).catch((err) => { console.error('Error in app.handle:', err); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Internal Server Error during request handling' })); } });
    })
    .on('error', (err) => { console.error('Request stream error:', err); if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); } if (!res.writableEnded) { res.end(JSON.stringify({ error: 'Bad Request stream' })); } });
});

checkOllamaConnectionOnStartup().then(() => {
    server.listen(config.server.port, () => {
        console.log(`-------------------------------------------------------`); console.log(`🚀 Therapy Analyzer Backend (Elysia/Node) listening on port ${config.server.port}`); console.log(`   Version: ${appVersion}`); console.log(`   Mode: ${config.server.nodeEnv}`); console.log(`   CORS Origin Allowed: ${config.server.corsOrigin}`); console.log(`   DB Path: ${config.db.sqlitePath}`); console.log(`   Ollama URL: ${config.ollama.baseURL}`); console.log(`   Ollama Model: ${getActiveModel()} (Active)`); console.log(`   Configured Context: ${getConfiguredContextSize() ?? 'default'}`); console.log(`-------------------------------------------------------`); console.log(`Access API Docs at: http://localhost:${config.server.port}/api/docs`); console.log(`Health Check: http://localhost:${config.server.port}/api/health`); console.log(`-------------------------------------------------------`);
    });
});

// --- Graceful Shutdown (Simplified for External Cleanup) ---
let isShuttingDown = false;
async function shutdown(signal: string) {
    console.log(`[API Server Shutdown] Received signal: ${signal}. Checking shutdown status.`);
    if (isShuttingDown) {
        console.log("[API Server Shutdown] Already shutting down. Ignoring signal.");
        return;
    }
    isShuttingDown = true;
    // Log that Docker cleanup is handled externally now
    console.log(`[API Server Shutdown] Initiating graceful shutdown (Docker cleanup handled externally)...`);

    // 1. Stop HTTP server from accepting new connections
    console.log("[API Server Shutdown] Closing HTTP server...");
    server.close((err) => { // Removed async here, no await needed
        if (err) {
            console.error("[API Server Shutdown] Error closing HTTP server:", err);
        } else {
            console.log("[API Server Shutdown] HTTP server closed successfully.");
        }

        // 2. Close Database connection ONLY
        console.log("[API Server Shutdown] Closing database connection...");
        closeDb();

        // 3. Exit process
        console.log("🚪 [API Server Shutdown] Shutdown sequence complete. Exiting process.");
        process.exitCode = err ? 1 : 0;
        // Give a very short time for logs to flush before exit
        setTimeout(() => process.exit(process.exitCode), 100);
    });

    // Force exit after a timeout
    setTimeout(() => {
        console.error("🛑 [API Server Shutdown] Shutdown timed out after 10 seconds. Forcing exit.");
        try { closeDb(); } catch { /* ignore */ }
        process.exit(1);
    }, 10000);
}

// Listen for SIGINT (Ctrl+C) and SIGTERM (standard termination)
process.on('SIGINT', () => {
    console.log("[API Server Process] SIGINT received.");
    shutdown('SIGINT').catch(e => console.error("[API Server Process] Error during SIGINT shutdown:", e));
});
process.on('SIGTERM', () => {
    console.log("[API Server Process] SIGTERM received.");
    shutdown('SIGTERM').catch(e => console.error("[API Server Process] Error during SIGTERM shutdown:", e));
});

process.on('uncaughtException', (error, origin) => {
    console.error(`[API Server FATAL] Uncaught Exception at: ${origin}`, error);
    if (!isShuttingDown) { try { closeDb(); } catch {} }
    // Exit immediately on fatal error
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[API Server FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
    if (!isShuttingDown) { try { closeDb(); } catch {} }
    process.exit(1); // Exit immediately
});
// --- End Graceful Shutdown ---

export default app;
export type App = typeof app;
