// packages/api/src/services/ollamaService.ts
import ollama, { ChatResponse, Message, ListResponse, ShowResponse, GenerateResponse, Message as OllamaApiMessage, ProgressResponse, PullRequest } from 'ollama'; // Added PullRequest type
import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto'; // Import crypto for job ID
import config from '../config/index.js';
import { BackendChatMessage, OllamaModelInfo } from '../types/index.js';
import { InternalServerError, BadRequestError, ApiError, NotFoundError, ConflictError } from '../errors.js'; // Added ConflictError
import { getActiveModel, getConfiguredContextSize } from './activeModelService.js';
import { exec as callbackExec } from 'node:child_process';
import * as util from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs'; // For checking compose file
import { fileURLToPath } from 'node:url';

const exec = util.promisify(callbackExec);

// --- Docker Management Logic for Ollama ---
const OLLAMA_PACKAGE_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../..', 'ollama');
const OLLAMA_COMPOSE_FILE = path.join(OLLAMA_PACKAGE_DIR, 'docker-compose.yml');
const OLLAMA_SERVICE_NAME = 'ollama'; // Match service name in ollama's compose file

async function runOllamaComposeCommand(command: string): Promise<string> {
    if (!fs.existsSync(OLLAMA_COMPOSE_FILE)) {
        console.error(`[Ollama Docker] Compose file not found at: ${OLLAMA_COMPOSE_FILE}`);
        throw new InternalServerError(`Ollama docker-compose.yml not found at ${OLLAMA_COMPOSE_FILE}`);
    }
    const composeCommand = `docker compose -f "${OLLAMA_COMPOSE_FILE}" ${command}`;
    console.log(`[Ollama Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn")) {
            console.warn(`[Ollama Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Ollama Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Ollama Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Ollama Docker] Stdout: ${error.stdout}`);
        throw new InternalServerError(`Failed to run Ollama Docker Compose command: ${command}. Error: ${error.message}`);
    }
}

async function isOllamaContainerRunning(): Promise<boolean> {
    try {
        const containerId = await runOllamaComposeCommand(`ps -q ${OLLAMA_SERVICE_NAME}`);
        return !!containerId;
    } catch (error: any) {
        console.warn(`[Ollama Docker] Error checking running status (likely not running): ${error.message}`);
        return false;
    }
}

async function isOllamaApiResponsive(): Promise<boolean> {
    try {
        await axios.get(config.ollama.baseURL, { timeout: 3000 });
        return true;
    } catch (error) {
        return false;
    }
}

export async function ensureOllamaReady(timeoutMs = 30000): Promise<void> {
    console.log("[Ollama Docker] Ensuring Ollama service is ready...");
    if (await isOllamaContainerRunning() && await isOllamaApiResponsive()) {
        console.log("[Ollama Docker] ✅ Ollama container running and API responsive.");
        return;
    }
    if (!(await isOllamaContainerRunning())) {
        console.log("[Ollama Docker] 🅾️ Ollama container not running. Attempting to start...");
        try {
            await runOllamaComposeCommand(`up -d ${OLLAMA_SERVICE_NAME}`);
            console.log("[Ollama Docker] 'docker compose up -d ollama' command issued.");
        } catch (startError: any) {
            console.error("[Ollama Docker] ❌ Failed to issue start command for Ollama service:", startError);
            throw new InternalServerError("Failed to start Ollama Docker service.", startError);
        }
    } else {
        console.log("[Ollama Docker] Container process found, but API was not responsive. Waiting...");
    }
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        console.log("[Ollama Docker] ⏳ Waiting for Ollama API to become responsive...");
        if (await isOllamaApiResponsive()) {
            console.log("[Ollama Docker] ✅ Ollama API is now responsive.");
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    console.error(`[Ollama Docker] ❌ Ollama API did not become responsive within ${timeoutMs / 1000} seconds.`);
    throw new InternalServerError(`Ollama service started but API did not respond within timeout.`);
}
// --- End Docker Management Logic ---

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// --- Interface and Store for Pull Job Status ---
export type OllamaPullJobStatusState = 'queued' | 'parsing' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'canceling' | 'canceled';
export interface OllamaPullJobStatus {
    jobId: string;
    modelName: string;
    status: OllamaPullJobStatusState;
    message: string;
    progress?: number;
    completedBytes?: number;
    totalBytes?: number;
    currentLayer?: string;
    startTime: number;
    endTime?: number;
    error?: string;
}
const activePullJobs = new Map<string, OllamaPullJobStatus>();
const pullJobCancellationFlags = new Map<string, boolean>();
// --- END ---

// --- List Models ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
    console.log(`[OllamaService] Request to list available models...`);
    try {
        await ensureOllamaReady();
        console.log(`[OllamaService] Ollama ready. Fetching models from ${config.ollama.baseURL}/api/tags`);
        const response: ListResponse = await ollama.list();
        return response.models.map(model => {
             const modifiedAtString = typeof model.modified_at?.toISOString === 'function' ? model.modified_at.toISOString() : String(model.modified_at);
            return {
                name: model.name, modified_at: modifiedAtString, size: model.size, digest: model.digest,
                details: { format: model.details.format, family: model.details.family, families: model.details.families, parameter_size: model.details.parameter_size, quantization_level: model.details.quantization_level, },
            };
         });
    } catch (error: any) {
        console.error('[OllamaService] Error fetching available models:', error);
        if (error.message?.includes('ECONNREFUSED')) { throw new InternalServerError(`Connection refused after readiness check: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`); }
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to list models from Ollama service after readiness check.', error instanceof Error ? error : new Error(String(error)));
    }
};

// --- Parse Ollama Pull Stream Chunk ---
function parseOllamaPullStreamChunk(chunk: ProgressResponse): Partial<OllamaPullJobStatus> {
    let percentage: number | undefined = undefined;
    if (chunk.total && chunk.completed) { percentage = Math.round((chunk.completed / chunk.total) * 100); }
    let internalStatus: OllamaPullJobStatusState = 'downloading';
    const message = chunk.status;
    if (message.includes('pulling manifest')) internalStatus = 'parsing';
    else if (message.includes('verifying sha256 digest')) internalStatus = 'verifying';
    else if (message.includes('writing manifest')) internalStatus = 'verifying';
    else if (message.includes('removing any unused layers')) internalStatus = 'verifying';
    else if (message.toLowerCase().includes('success')) internalStatus = 'completed';
    else if (message.toLowerCase().includes('error')) internalStatus = 'failed';
    const currentLayer = chunk.digest ? chunk.digest.substring(7, 19) : undefined;
    return { status: internalStatus, message: message, progress: percentage, completedBytes: chunk.completed, totalBytes: chunk.total, currentLayer: currentLayer, ...(internalStatus === 'failed' && { error: message }), };
}

// --- Background Pull Task Runner ---
async function runPullInBackground(jobId: string, modelName: string) {
    console.log(`[OllamaBG ${jobId}] Starting background pull for ${modelName}`);
    const jobStartTime = Date.now();
    activePullJobs.set(jobId, { jobId, modelName, status: 'queued', message: 'Pull queued', startTime: jobStartTime, });
    pullJobCancellationFlags.set(jobId, false);
    try {
        await ensureOllamaReady();
        const stream = await ollama.pull({ model: modelName, stream: true });
        activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, status: 'parsing', message: 'Pulling manifest...', });
        for await (const chunk of stream) {
            if (pullJobCancellationFlags.get(jobId)) {
                 console.log(`[OllamaBG ${jobId}] Cancellation requested, stopping pull for ${modelName}.`);
                 activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, status: 'canceled', message: 'Pull canceled by user.', endTime: Date.now(), });
                 return;
            }
            const progressUpdate = parseOllamaPullStreamChunk(chunk);
            const currentStatus = activePullJobs.get(jobId);
            if (currentStatus && !pullJobCancellationFlags.get(jobId)) {
                 activePullJobs.set(jobId, { ...currentStatus, ...progressUpdate, status: progressUpdate.status || currentStatus.status, message: progressUpdate.message || currentStatus.message, progress: progressUpdate.progress ?? currentStatus.progress, error: progressUpdate.error ?? currentStatus.error, });
            } else if (!currentStatus) { console.warn(`[OllamaBG ${jobId}] Job status not found during update for ${modelName}. Stopping task.`); return; }
            if (progressUpdate.status === 'completed' || progressUpdate.status === 'failed') {
                 console.log(`[OllamaBG ${jobId}] Terminal status '${progressUpdate.status}' detected from chunk for ${modelName}.`);
                 activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, endTime: Date.now() });
                 break;
            }
        }
        const finalStatus = activePullJobs.get(jobId);
        if (finalStatus && finalStatus.status !== 'failed' && finalStatus.status !== 'completed' && finalStatus.status !== 'canceled' && finalStatus.status !== 'canceling') {
             console.log(`[OllamaBG ${jobId}] Stream ended normally, marking job as completed for ${modelName}.`);
             activePullJobs.set(jobId, { ...finalStatus, status: 'completed', message: 'Pull finished successfully.', progress: 100, endTime: Date.now(), });
        } else if (finalStatus) { console.log(`[OllamaBG ${jobId}] Stream ended, job already had terminal status: ${finalStatus.status}`); if (!finalStatus.endTime) { activePullJobs.set(jobId, { ...finalStatus, endTime: Date.now() }); } }
    } catch (error: any) {
        console.error(`[OllamaBG ${jobId}] Error during background pull for ${modelName}:`, error);
        const finalStatus = activePullJobs.get(jobId);
        activePullJobs.set(jobId, { ...(finalStatus ?? { jobId, modelName, status: 'failed', message: 'Pull failed', startTime: jobStartTime }), status: 'failed', error: error.message || 'Unknown error during pull', message: `Pull failed: ${error.message || 'Unknown'}`, endTime: Date.now(), });
    } finally {
        pullJobCancellationFlags.delete(jobId);
        console.log(`[OllamaBG ${jobId}] Background pull task finished for ${modelName}. Final status: ${activePullJobs.get(jobId)?.status}`);
    }
}

// --- Start Pull Model Job ---
export const startPullModelJob = (modelName: string): string => {
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) { throw new BadRequestError("Invalid model name provided."); }
    const jobId = crypto.randomUUID();
    console.log(`[OllamaService] Queuing pull job ${jobId} for model: ${modelName}`);
    void runPullInBackground(jobId, modelName).catch(err => { console.error(`[OllamaService] CRITICAL: Uncaught error escaped background pull job ${jobId} for ${modelName}:`, err); const currentStatus = activePullJobs.get(jobId); if(currentStatus && currentStatus.status !== 'completed' && currentStatus.status !== 'failed' && currentStatus.status !== 'canceled') { activePullJobs.set(jobId, { ...currentStatus, status: 'failed', error: 'Background task crashed unexpectedly', message: 'Background task crashed', endTime: Date.now(), }); } });
    return jobId;
};

// --- Get Pull Model Job Status ---
export const getPullModelJobStatus = (jobId: string): OllamaPullJobStatus | null => {
    const status = activePullJobs.get(jobId);
    if (config.server.isProduction) { console.log(`[OllamaService] Getting status for job ${jobId}. Found: ${!!status}`); }
    else { console.log(`[OllamaService] Getting status for job ${jobId}. Status:`, status); }
    return status ?? null;
};

// --- Cancel Pull Model Job ---
export const cancelPullModelJob = (jobId: string): boolean => {
     const job = activePullJobs.get(jobId);
     if (!job) { console.log(`[OllamaService] Cancel request for non-existent job ${jobId}`); return false; }
     if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled' || job.status === 'canceling') { console.log(`[OllamaService] Job ${jobId} is already in state (${job.status}), cannot cancel.`); return false; }
     console.log(`[OllamaService] Setting cancellation flag for job ${jobId}`);
     pullJobCancellationFlags.set(jobId, true);
     activePullJobs.set(jobId, { ...job, status: 'canceling', message: 'Cancellation requested...' });
     return true;
};

// --- NEW: Delete Ollama Model Service Function ---
export const deleteOllamaModel = async (modelName: string): Promise<string> => {
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
        throw new BadRequestError("Invalid model name provided for deletion.");
    }
    console.log(`[OllamaService] Request to delete model '${modelName}'...`);

    // 1. Ensure Ollama service is running (needed to execute docker command)
    try {
        await ensureOllamaReady();
    } catch (error) {
        // Propagate error if Ollama couldn't be started/reached
        throw error;
    }

    // 2. Check if the model is currently loaded (optional but recommended)
    const loadedStatus = await checkModelStatus(modelName);
    if (loadedStatus && typeof loadedStatus === 'object' && 'name' in loadedStatus) {
         console.warn(`[OllamaService] Attempting to delete model '${modelName}' which appears to be currently loaded in memory. Ollama might prevent this or require unloading first.`);
         // Option: Throw ConflictError to force unload first
         // throw new ConflictError(`Model '${modelName}' is currently loaded. Please unload it before deleting.`);
    } else if (loadedStatus === null) {
        console.log(`[OllamaService] Model '${modelName}' confirmed not loaded. Proceeding with delete.`);
    } else if (loadedStatus?.status === 'unavailable') {
         // This shouldn't happen after ensureOllamaReady, but handle defensively
         throw new InternalServerError("Ollama service became unavailable after readiness check.");
    }

    // 3. Execute the delete command via docker compose exec
    try {
        console.log(`[OllamaService] Executing delete command for '${modelName}'...`);
        // Use -T to disable pseudo-tty, good for non-interactive exec
        const deleteOutput = await runOllamaComposeCommand(`exec -T ${OLLAMA_SERVICE_NAME} ollama rm ${modelName}`);
        console.log(`[OllamaService] Delete command output for '${modelName}':`, deleteOutput);

        // Check output for success/failure messages (Ollama's output isn't always consistent)
        if (deleteOutput.toLowerCase().includes('deleted') || deleteOutput.toLowerCase().includes('removed')) {
             return `Model '${modelName}' deleted successfully.`;
        } else if (deleteOutput.toLowerCase().includes('not found')) {
            // Model was likely already deleted or never existed
            console.warn(`[OllamaService] Model '${modelName}' not found during delete attempt.`);
            throw new NotFoundError(`Model '${modelName}' not found locally.`);
        } else {
            // Assume failure if no clear success message
            console.error(`[OllamaService] Unknown response from 'ollama rm ${modelName}': ${deleteOutput}`);
            throw new InternalServerError(`Failed to delete model '${modelName}'. Output: ${deleteOutput}`);
        }

    } catch (error: any) {
        console.error(`[OllamaService] Error executing delete command for '${modelName}':`, error);
        // Check stderr from compose command if available
        if (error.message?.toLowerCase().includes('not found')) {
             throw new NotFoundError(`Model '${modelName}' not found locally.`);
        }
        // Re-throw other internal server errors or wrap unknown errors
        if (error instanceof ApiError) throw error;
        throw new InternalServerError(`Failed to execute delete command for model '${modelName}'.`, error instanceof Error ? error : new Error(String(error)));
    }
};
// --- END NEW ---

// --- Check Model Status ---
export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null | { status: 'unavailable' }> => {
    const psUrl = `${config.ollama.baseURL}/api/ps`;
    console.log(`[OllamaService] Checking if specific model '${modelToCheck}' is loaded using ${psUrl}...`);
    try {
        const response = await axios.get(psUrl, { timeout: 5000 });
        if (response.status === 200) {
            const loadedModels = response.data.models || [];
            const loadedModel = loadedModels.find((model: any) => model.name === modelToCheck);
            if (loadedModel) {
                console.log(`[OllamaService] Specific model '${modelToCheck}' found loaded.`);
                return {
                    name: loadedModel.name, modified_at: loadedModel.modified_at ?? 'N/A', size: loadedModel.size ?? 0, digest: loadedModel.digest,
                    details: loadedModel.details ?? { format: 'unknown', family: 'unknown', families: null, parameter_size: 'unknown', quantization_level: 'unknown' },
                    size_vram: loadedModel.size_vram, expires_at: loadedModel.expires_at, size_total: loadedModel.size,
                };
            } else { console.log(`[OllamaService] Specific model '${modelToCheck}' not found among loaded models:`, loadedModels.map((m: any) => m.name)); return null; }
        } else { console.warn(`[OllamaService] Unexpected status code ${response.status} from /api/ps`); return null; }
    } catch (error: any) {
        console.warn(`[OllamaService] Error checking status for specific model '${modelToCheck}':`, error.message);
        if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') { console.warn(`[OllamaService] Connection refused. Ollama service appears to be unavailable.`); return { status: 'unavailable' }; }
        console.log(`[OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to other error.`); return null;
     }
};

// --- Load Model Function ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
     if (!modelName) { throw new BadRequestError("Model name must be provided to load."); }
    console.log(`[OllamaService] Request to load model '${modelName}'...`);
    try { await ensureOllamaReady(); console.log(`[OllamaService] Ollama service is ready. Proceeding with load trigger for '${modelName}'.`); }
    catch (error) { throw error; }
    console.log(`[OllamaService] Triggering load for model '${modelName}' using a minimal chat request...`);
    try {
        const response = await ollama.chat({ model: modelName, messages: [{ role: 'user', content: 'ping' }], stream: false, keep_alive: config.ollama.keepAlive, });
        console.log(`[OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`);
    } catch (error: any) {
        console.error(`[OllamaService] Error during load trigger chat request for '${modelName}':`, error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) { console.error(`[OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`); throw new BadRequestError(`Model '${modelName}' not found locally. Please pull the model first.`); }
        if (error.message?.includes('ECONNREFUSED')) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`); }
        throw new InternalServerError(`Failed to trigger load for model '${modelName}' via chat request.`, error instanceof Error ? error : undefined);
    }
};

// --- Generate Chat Response ---
export const generateChatResponse = async ( contextTranscript: string, chatHistory: BackendChatMessage[], retryAttempt: boolean = false ): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> => {
    const modelToUse = getActiveModel(); const contextSize = getConfiguredContextSize();
    console.log(`[OllamaService:generateChatResponse] Attempting chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);
    try { await ensureOllamaReady(); console.log(`[OllamaService:generateChatResponse] Ollama service is ready.`); }
    catch (error) { throw error; }
    if (!contextTranscript) console.warn("[OllamaService] Generating response with empty or missing transcript context string."); else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot generate response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");
    const latestUserMessage = chatHistory[chatHistory.length - 1]; const previousHistory = chatHistory.slice(0, -1);
    const transcriptContextMessage: Message = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: Message[] = [ { role: 'system', content: SYSTEM_PROMPT }, ...previousHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })), transcriptContextMessage, { role: 'user', content: latestUserMessage.text } ];
    console.log(`[OllamaService] Generating response (model: ${modelToUse})...`); console.log(`[OllamaService] Sending ${messages.length} messages to Ollama.`);
    try {
        const response: ChatResponse = await ollama.chat({ model: modelToUse, messages: messages, stream: false, keep_alive: config.ollama.keepAlive, options: { ...(contextSize !== null && { num_ctx: contextSize }), } });
        if (!response?.message?.content) { throw new InternalServerError('Invalid response structure from AI.'); }
        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : ''; const tokensInfo = response.prompt_eval_count && response.eval_count ? `(${response.prompt_eval_count} prompt + ${response.eval_count} completion tokens)` : ''; console.log(`[OllamaService] Response received ${durationInfo} ${tokensInfo}.`);
        return { content: response.message.content.trim(), promptTokens: response.prompt_eval_count, completionTokens: response.eval_count };
    } catch (error: any) {
        console.error('[OllamaService] Error during generateChatResponse:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) { console.error(`[OllamaService] Active Model '${modelToUse}' not found during chat.`); throw new BadRequestError(`Model '${modelToUse}' not found. Please pull or select an available model.`); }
        if (error instanceof Error) { const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED'); if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); } if (error.name === 'TimeoutError' || error.message.includes('timeout')) { throw new InternalServerError('AI service request timed out.'); } }
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};

// --- Stream Chat Response ---
export const streamChatResponse = async ( contextTranscript: string, chatHistory: BackendChatMessage[], retryAttempt: boolean = false ): Promise<AsyncIterable<ChatResponse>> => {
    const modelToUse = getActiveModel(); const contextSize = getConfiguredContextSize();
    console.log(`[OllamaService:streamChatResponse] Attempting streaming chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);
    try { await ensureOllamaReady(); console.log(`[OllamaService:streamChatResponse] Ollama service is ready.`); }
    catch (error) { throw error; }
    if (!contextTranscript) console.warn("[OllamaService] Streaming response with empty or missing transcript context string."); else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot stream response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");
    const latestUserMessage = chatHistory[chatHistory.length - 1]; const previousHistory = chatHistory.slice(0, -1);
    const transcriptContextMessage: OllamaApiMessage = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: OllamaApiMessage[] = [ { role: 'system', content: SYSTEM_PROMPT }, ...previousHistory.map((msg): OllamaApiMessage => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })), transcriptContextMessage, { role: 'user', content: latestUserMessage.text } ];
    console.log(`[OllamaService] Streaming response (model: ${modelToUse})...`); console.log(`[OllamaService] Sending ${messages.length} messages to Ollama for streaming.`);
    try {
        const stream = await ollama.chat({ model: modelToUse, messages: messages, stream: true, keep_alive: config.ollama.keepAlive, options: { ...(contextSize !== null && { num_ctx: contextSize }), } });
        console.log(`[OllamaService] Stream initiated for model ${modelToUse}.`); return stream;
    } catch (error: any) {
        console.error('[OllamaService] Error initiating chat stream:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) { console.error(`[OllamaService] Active Model '${modelToUse}' not found during stream init.`); throw new BadRequestError(`Model '${modelToUse}' not found. Please pull or select an available model.`); }
        if (error instanceof Error) { const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED'); if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); } }
        throw new InternalServerError('Failed to initiate stream from AI service.', error instanceof Error ? error : undefined);
    }
};
