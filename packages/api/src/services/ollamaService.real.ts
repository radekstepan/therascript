/* packages/api/src/services/ollamaService.real.ts */
// Contains the original, real implementation of ollamaService.ts

// --- Keep original imports for ollama, axios, crypto, etc. ---
import ollama, { ChatResponse, Message, ListResponse, ShowResponse, GenerateResponse, Message as OllamaApiMessage, ProgressResponse, PullRequest, ModelResponse } from 'ollama'; // Added ModelResponse type explicit import
import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto'; // Import crypto for job ID
import config from '../config/index.js';
// --- Use imported types from central location ---
import { BackendChatMessage, OllamaModelInfo, OllamaPullJobStatus, OllamaPullJobStatusState } from '../types/index.js';
// --- End Import ---
import { InternalServerError, BadRequestError, ApiError, NotFoundError, ConflictError } from '../errors.js'; // Added ConflictError
import { getActiveModel, getConfiguredContextSize } from './activeModelService.js';
import { exec as callbackExec } from 'node:child_process';
import * as util from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs'; // For checking compose file
import { fileURLToPath } from 'node:url';

const exec = util.promisify(callbackExec);

console.log('[Real Service] Using Real Ollama Service'); // Identify real service

// --- Keep original Docker Management Logic ---
const OLLAMA_PACKAGE_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../..', 'ollama');
const OLLAMA_COMPOSE_FILE = path.join(OLLAMA_PACKAGE_DIR, 'docker-compose.yml');
const OLLAMA_SERVICE_NAME = 'ollama'; // Match service name in ollama's compose file

async function runOllamaComposeCommand(command: string): Promise<string> {
    if (!fs.existsSync(OLLAMA_COMPOSE_FILE)) {
        console.error(`[Real Ollama Docker] Compose file not found at: ${OLLAMA_COMPOSE_FILE}`);
        throw new InternalServerError(`Ollama docker-compose.yml not found at ${OLLAMA_COMPOSE_FILE}`);
    }
    const composeCommand = `docker compose -f "${OLLAMA_COMPOSE_FILE}" ${command}`;
    console.log(`[Real Ollama Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn")) {
            console.warn(`[Real Ollama Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Real Ollama Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Real Ollama Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Real Ollama Docker] Stdout: ${error.stdout}`);
        throw new InternalServerError(`Failed to run Ollama Docker Compose command: ${command}. Error: ${error.message}`);
    }
}

async function isOllamaContainerRunning(): Promise<boolean> {
    try {
        const containerId = await runOllamaComposeCommand(`ps -q ${OLLAMA_SERVICE_NAME}`);
        return !!containerId;
    } catch (error: any) {
        console.warn(`[Real Ollama Docker] Error checking running status (likely not running): ${error.message}`);
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
    console.log("[Real Ollama Docker] Ensuring Ollama service is ready...");
    if (await isOllamaContainerRunning() && await isOllamaApiResponsive()) {
        console.log("[Real Ollama Docker] ✅ Ollama container running and API responsive.");
        return;
    }
    if (!(await isOllamaContainerRunning())) {
        console.log("[Real Ollama Docker] 🅾️ Ollama container not running. Attempting to start...");
        try {
            await runOllamaComposeCommand(`up -d ${OLLAMA_SERVICE_NAME}`);
            console.log("[Real Ollama Docker] 'docker compose up -d ollama' command issued.");
        } catch (startError: any) {
            console.error("[Real Ollama Docker] ❌ Failed to issue start command for Ollama service:", startError);
            throw new InternalServerError("Failed to start Ollama Docker service.", startError);
        }
    } else {
        console.log("[Real Ollama Docker] Container process found, but API was not responsive. Waiting...");
    }
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        console.log("[Real Ollama Docker] ⏳ Waiting for Ollama API to become responsive...");
        if (await isOllamaApiResponsive()) {
            console.log("[Real Ollama Docker] ✅ Ollama API is now responsive.");
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    console.error(`[Real Ollama Docker] ❌ Ollama API did not become responsive within ${timeoutMs / 1000} seconds.`);
    throw new InternalServerError(`Ollama service started but API did not respond within timeout.`);
}

// --- Keep original Ollama prompt constants ---
const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;
const STANDALONE_SYSTEM_PROMPT = `You are a helpful AI assistant. Answer the user's questions directly and concisely.`;

// --- Keep original Pull Job Status store ---
// Make sure the type annotation uses the imported type
const activePullJobs = new Map<string, OllamaPullJobStatus>();
const pullJobCancellationFlags = new Map<string, boolean>();

// --- FIX: Ensure listModels returns Date objects internally ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
    console.log(`[Real OllamaService] Request to list available models...`);
    try {
        await ensureOllamaReady();
        console.log(`[Real OllamaService] Ollama ready. Fetching models from ${config.ollama.baseURL}/api/tags`);
        const response: ListResponse = await ollama.list();
        // Map to OllamaModelInfo, creating Date objects from API strings/dates
        return response.models.map((model: ModelResponse): OllamaModelInfo => {
            const modifiedAtDate = typeof model.modified_at === 'string' ? new Date(model.modified_at) : (model.modified_at ?? new Date(0)); // Handle potential missing date
            const expiresAtDate = typeof model.expires_at === 'string' ? new Date(model.expires_at) : (model.expires_at ?? undefined); // Handle Date or string

            return {
                name: model.name,
                modified_at: modifiedAtDate, // Use Date object
                size: model.size,
                digest: model.digest,
                details: {
                    format: model.details.format,
                    family: model.details.family,
                    families: model.details.families,
                    parameter_size: model.details.parameter_size,
                    quantization_level: model.details.quantization_level,
                },
                 size_vram: model.size_vram,
                 expires_at: expiresAtDate, // Use Date object or undefined
                 // size_total removed
            };
         });
    } catch (error: any) {
        console.error('[Real OllamaService] Error fetching available models:', error);
        if (error.message?.includes('ECONNREFUSED')) { throw new InternalServerError(`Connection refused after readiness check: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`); }
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to list models from Ollama service after readiness check.', error instanceof Error ? error : new Error(String(error)));
    }
};
// --- END FIX ---

// --- Keep original Parse Ollama Pull Stream Chunk ---
function parseOllamaPullStreamChunk(chunk: ProgressResponse): Partial<OllamaPullJobStatus> {
     let percentage: number | undefined = undefined;
    if (chunk.total && chunk.completed) { percentage = Math.round((chunk.completed / chunk.total) * 100); }
    let internalStatus: OllamaPullJobStatusState = 'downloading'; // Use imported state type
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

// --- Keep original Background Pull Task Runner ---
async function runPullInBackground(jobId: string, modelName: string) {
     console.log(`[Real OllamaBG ${jobId}] Starting background pull for ${modelName}`);
    const jobStartTime = Date.now();
    // Ensure the job status type is correct here
    activePullJobs.set(jobId, { jobId, modelName, status: 'queued', message: 'Pull queued', startTime: jobStartTime, });
    pullJobCancellationFlags.set(jobId, false);
    try {
        await ensureOllamaReady();
        const stream = await ollama.pull({ model: modelName, stream: true });
        activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, status: 'parsing', message: 'Pulling manifest...', });
        for await (const chunk of stream) {
            if (pullJobCancellationFlags.get(jobId)) {
                 console.log(`[Real OllamaBG ${jobId}] Cancellation requested, stopping pull for ${modelName}.`);
                 activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, status: 'canceled', message: 'Pull canceled by user.', endTime: Date.now(), });
                 return;
            }
            const progressUpdate = parseOllamaPullStreamChunk(chunk);
            const currentStatus = activePullJobs.get(jobId);
            if (currentStatus && !pullJobCancellationFlags.get(jobId)) {
                 // Ensure status update uses correct type
                 activePullJobs.set(jobId, { ...currentStatus, ...progressUpdate, status: progressUpdate.status || currentStatus.status, message: progressUpdate.message || currentStatus.message, progress: progressUpdate.progress ?? currentStatus.progress, error: progressUpdate.error ?? currentStatus.error, });
            } else if (!currentStatus) { console.warn(`[Real OllamaBG ${jobId}] Job status not found during update for ${modelName}. Stopping task.`); return; }
            if (progressUpdate.status === 'completed' || progressUpdate.status === 'failed') {
                 console.log(`[Real OllamaBG ${jobId}] Terminal status '${progressUpdate.status}' detected from chunk for ${modelName}.`);
                 activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, endTime: Date.now() });
                 break;
            }
        }
        const finalStatus = activePullJobs.get(jobId);
        if (finalStatus && finalStatus.status !== 'failed' && finalStatus.status !== 'completed' && finalStatus.status !== 'canceled' && finalStatus.status !== 'canceling') {
             console.log(`[Real OllamaBG ${jobId}] Stream ended normally, marking job as completed for ${modelName}.`);
             activePullJobs.set(jobId, { ...finalStatus, status: 'completed', message: 'Pull finished successfully.', progress: 100, endTime: Date.now(), });
        } else if (finalStatus) { console.log(`[Real OllamaBG ${jobId}] Stream ended, job already had terminal status: ${finalStatus.status}`); if (!finalStatus.endTime) { activePullJobs.set(jobId, { ...finalStatus, endTime: Date.now() }); } }
    } catch (error: any) {
        console.error(`[Real OllamaBG ${jobId}] Error during background pull for ${modelName}:`, error);
        const finalStatus = activePullJobs.get(jobId);
        // Ensure status update uses correct type
        activePullJobs.set(jobId, { ...(finalStatus ?? { jobId, modelName, status: 'failed' as OllamaPullJobStatusState, message: 'Pull failed', startTime: jobStartTime }), status: 'failed', error: error.message || 'Unknown error during pull', message: `Pull failed: ${error.message || 'Unknown'}`, endTime: Date.now(), });
    } finally {
        pullJobCancellationFlags.delete(jobId);
        console.log(`[Real OllamaBG ${jobId}] Background pull task finished for ${modelName}. Final status: ${activePullJobs.get(jobId)?.status}`);
    }
}

// --- Keep original Start Pull Model Job ---
export const startPullModelJob = (modelName: string): string => {
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) { throw new BadRequestError("Invalid model name provided."); }
    const jobId = crypto.randomUUID();
    console.log(`[Real OllamaService] Queuing pull job ${jobId} for model: ${modelName}`);
    void runPullInBackground(jobId, modelName).catch(err => { console.error(`[Real OllamaService] CRITICAL: Uncaught error escaped background pull job ${jobId} for ${modelName}:`, err); const currentStatus = activePullJobs.get(jobId); if(currentStatus && currentStatus.status !== 'completed' && currentStatus.status !== 'failed' && currentStatus.status !== 'canceled') { activePullJobs.set(jobId, { ...currentStatus, status: 'failed', error: 'Background task crashed unexpectedly', message: 'Background task crashed', endTime: Date.now(), }); } });
    return jobId;
};

// --- Keep original Get Pull Model Job Status ---
// Ensure return type uses the imported type
export const getPullModelJobStatus = (jobId: string): OllamaPullJobStatus | null => {
    const status = activePullJobs.get(jobId);
    if (config.server.isProduction) { console.log(`[Real OllamaService] Getting status for job ${jobId}. Found: ${!!status}`); }
    else { console.log(`[Real OllamaService] Getting status for job ${jobId}. Status:`, status); }
    return status ? { ...status } : null; // Return copy or null
};

// --- Keep original Cancel Pull Model Job ---
export const cancelPullModelJob = (jobId: string): boolean => {
     const job = activePullJobs.get(jobId);
     if (!job) { console.log(`[Real OllamaService] Cancel request for non-existent job ${jobId}`); return false; }
     if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled' || job.status === 'canceling') { console.log(`[Real OllamaService] Job ${jobId} is already in state (${job.status}), cannot cancel.`); return false; }
     console.log(`[Real OllamaService] Setting cancellation flag for job ${jobId}`);
     pullJobCancellationFlags.set(jobId, true);
     // Ensure status update uses correct type
     activePullJobs.set(jobId, { ...job, status: 'canceling', message: 'Cancellation requested...' });
     return true;
};

// --- Keep original Delete Ollama Model Service Function ---
export const deleteOllamaModel = async (modelName: string): Promise<string> => {
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
        throw new BadRequestError("Invalid model name provided for deletion.");
    }
    console.log(`[Real OllamaService] Request to delete model '${modelName}'...`);

    // 1. Ensure Ollama service is running
    try {
        await ensureOllamaReady();
    } catch (error) {
        throw error;
    }

    // 2. Check if the model is currently loaded
    const loadedStatus = await checkModelStatus(modelName);
    if (loadedStatus && typeof loadedStatus === 'object' && 'name' in loadedStatus) {
         console.warn(`[Real OllamaService] Attempting to delete model '${modelName}' which appears to be currently loaded.`);
    } else if (loadedStatus === null) {
        console.log(`[Real OllamaService] Model '${modelName}' confirmed not loaded.`);
    } else if (loadedStatus?.status === 'unavailable') {
         throw new InternalServerError("Ollama service became unavailable after readiness check.");
    }

    // 3. Execute the delete command
    try {
        console.log(`[Real OllamaService] Executing delete command for '${modelName}'...`);
        const deleteOutput = await runOllamaComposeCommand(`exec -T ${OLLAMA_SERVICE_NAME} ollama rm ${modelName}`);
        console.log(`[Real OllamaService] Delete command output for '${modelName}':`, deleteOutput);
        if (deleteOutput.toLowerCase().includes('deleted') || deleteOutput.toLowerCase().includes('removed')) {
             return `Model '${modelName}' deleted successfully.`;
        } else if (deleteOutput.toLowerCase().includes('not found')) {
            console.warn(`[Real OllamaService] Model '${modelName}' not found during delete attempt.`);
            throw new NotFoundError(`Model '${modelName}' not found locally.`);
        } else {
            console.error(`[Real OllamaService] Unknown response from 'ollama rm ${modelName}': ${deleteOutput}`);
            throw new InternalServerError(`Failed to delete model '${modelName}'. Output: ${deleteOutput}`);
        }
    } catch (error: any) {
        console.error(`[Real OllamaService] Error executing delete command for '${modelName}':`, error);
        if (error.message?.toLowerCase().includes('not found')) {
             throw new NotFoundError(`Model '${modelName}' not found locally.`);
        }
        if (error instanceof ApiError) throw error;
        throw new InternalServerError(`Failed to execute delete command for model '${modelName}'.`, error instanceof Error ? error : new Error(String(error)));
    }
};

// --- FIX: Ensure checkModelStatus returns Date objects internally ---
export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null | { status: 'unavailable' }> => {
    console.log(`[Real OllamaService] Checking if specific model '${modelToCheck}' is loaded...`);
    try {
        const response = await ollama.ps();
        const loadedModel = response.models.find((model: any) => model.name === modelToCheck); // Use any if type is uncertain

        if (loadedModel) {
            console.log(`[Real OllamaService] Specific model '${modelToCheck}' found loaded.`);
            // Map to OllamaModelInfo, ensuring dates are Date objects
            const modifiedAtDate = loadedModel.modified_at ? new Date(loadedModel.modified_at) : new Date(0); // Default if missing
            const expiresAtDate = loadedModel.expires_at ? new Date(loadedModel.expires_at) : undefined;

            return {
                name: loadedModel.name,
                modified_at: modifiedAtDate, // Keep as Date
                size: loadedModel.size ?? 0,
                digest: loadedModel.digest,
                details: loadedModel.details ?? { format: 'unknown', family: 'unknown', families: null, parameter_size: 'unknown', quantization_level: 'unknown' },
                size_vram: loadedModel.size_vram,
                expires_at: expiresAtDate, // Keep as Date or undefined
            };
        } else {
            console.log(`[Real OllamaService] Specific model '${modelToCheck}' not found among loaded models:`, response.models.map((m: any) => m.name));
            return null;
        }
    } catch (error: any) {
        console.warn(`[Real OllamaService] Error checking status for specific model '${modelToCheck}':`, error.message);
        if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') { console.warn(`[Real OllamaService] Connection refused. Ollama service appears to be unavailable.`); return { status: 'unavailable' }; }
        if (error instanceof Error && error.message.includes('ECONNREFUSED')) { console.warn(`[Real OllamaService] Connection refused (ollama lib). Ollama service appears to be unavailable.`); return { status: 'unavailable' }; }
        console.log(`[Real OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to other error.`);
        return null;
     }
};
// --- END FIX ---


// --- Keep original Load Model Function ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
     if (!modelName) { throw new BadRequestError("Model name must be provided to load."); }
    console.log(`[Real OllamaService] Request to load model '${modelName}'...`);
    try { await ensureOllamaReady(); console.log(`[Real OllamaService] Ollama service is ready. Proceeding with load trigger for '${modelName}'.`); }
    catch (error) { throw error; }
    console.log(`[Real OllamaService] Triggering load for model '${modelName}' using a minimal chat request...`);
    try {
        const response = await ollama.chat({
            model: modelName,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
            keep_alive: config.ollama.keepAlive, // Use configured keep_alive
        });
        console.log(`[Real OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`);
    } catch (error: any) {
        console.error(`[Real OllamaService] Error during load trigger chat request for '${modelName}':`, error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) { console.error(`[Real OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`); throw new BadRequestError(`Model '${modelName}' not found locally. Please pull the model first.`); }
        if (error.message?.includes('ECONNREFUSED')) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`); }
        throw new InternalServerError(`Failed to trigger load for model '${modelName}' via chat request.`, error instanceof Error ? error : undefined);
    }
};

// --- Keep original Reload Active Model Context Function ---
export const reloadActiveModelContext = async (): Promise<void> => {
    const modelName = getActiveModel();
    if (!modelName) {
        console.warn("[Real OllamaService:reload] No active model set. Skipping reload.");
        return;
    }
    console.log(`[Real OllamaService:reload] Attempting to reload context for active model: ${modelName}`);
    try {
        await ensureOllamaReady();
    } catch (error) {
        console.error(`[Real OllamaService:reload] Ollama not ready, cannot reload model ${modelName}:`, error);
        throw error; // Propagate readiness error
    }

    // 1. Attempt Unload (keep_alive: 0)
    try {
        console.log(`[Real OllamaService:reload] Sending unload request (keep_alive: 0) for ${modelName}...`);
        await ollama.chat({
            model: modelName,
            messages: [{ role: 'user', content: 'unload' }], // Minimal message
            stream: false,
            keep_alive: 0, // Explicitly unload
        });
        console.log(`[Real OllamaService:reload] Unload request sent successfully for ${modelName}.`);
    } catch (unloadError: any) {
        const isModelNotFoundError = unloadError.status === 404 || (unloadError.message?.includes('model') && (unloadError.message?.includes('not found') || unloadError.message?.includes('missing')));
        if (isModelNotFoundError) {
            console.log(`[Real OllamaService:reload] Model ${modelName} not found during unload attempt (likely already unloaded). Proceeding to load.`);
        } else if (unloadError.message?.includes('ECONNREFUSED')) {
            console.error(`[Real OllamaService:reload] Connection refused during unload for ${modelName}.`);
            throw new InternalServerError(`Connection refused during unload attempt for ${modelName}.`);
        } else {
            console.warn(`[Real OllamaService:reload] Error during unload request for ${modelName} (will still attempt load):`, unloadError);
        }
    }

    // 2. Trigger Load (keep_alive: configured duration)
    try {
        console.log(`[Real OllamaService:reload] Sending load request (keep_alive: ${config.ollama.keepAlive}) for ${modelName}...`);
        await ollama.chat({
            model: modelName,
            messages: [{ role: 'user', content: 'load' }], // Minimal message
            stream: false,
            keep_alive: config.ollama.keepAlive, // Use configured duration
        });
        console.log(`[Real OllamaService:reload] Load request sent successfully for ${modelName}.`);
    } catch (loadError: any) {
        console.error(`[Real OllamaService:reload] Error during load request for ${modelName}:`, loadError);
        const isModelNotFoundError = loadError.status === 404 || (loadError.message?.includes('model') && (loadError.message?.includes('not found') || loadError.message?.includes('missing')));
         if (isModelNotFoundError) {
             console.error(`[Real OllamaService:reload] Model '${modelName}' not found locally during load attempt.`);
             throw new BadRequestError(`Model '${modelName}' not found locally. Cannot reload.`);
         }
         if (loadError.message?.includes('ECONNREFUSED')) {
             throw new InternalServerError(`Connection refused during load attempt for ${modelName}.`);
         }
        throw new InternalServerError(`Failed to trigger reload for model '${modelName}' via chat request.`, loadError instanceof Error ? loadError : undefined);
    }
    console.log(`[Real OllamaService:reload] Context reload sequence completed for ${modelName}.`);
};

// --- Keep original Stream Chat Response ---
export const streamChatResponse = async ( contextTranscript: string | null, chatHistory: BackendChatMessage[], retryAttempt: boolean = false ): Promise<AsyncIterable<ChatResponse>> => {
     const modelToUse = getActiveModel(); const contextSize = getConfiguredContextSize();
    const isStandalone = contextTranscript === null;
    console.log(`[Real OllamaService:streamChatResponse] Attempting streaming chat (${isStandalone ? 'standalone' : 'session'}) with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);
    try { await ensureOllamaReady(); console.log(`[Real OllamaService:streamChatResponse] Ollama service is ready.`); }
    catch (error) { throw error; }
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot stream response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");
    const latestUserMessage = chatHistory[chatHistory.length - 1]; const previousHistory = chatHistory.slice(0, -1);

    // Prepare messages based on whether it's standalone or session-based
    const messages: OllamaApiMessage[] = [
        { role: 'system', content: isStandalone ? STANDALONE_SYSTEM_PROMPT : SYSTEM_PROMPT },
        ...previousHistory.map((msg): OllamaApiMessage => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
    ];
    if (!isStandalone) {
        const transcriptContextMessage: OllamaApiMessage = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
        messages.push(transcriptContextMessage);
        console.log(`[Real OllamaService] Transcript context string provided (length: ${contextTranscript?.length ?? 0}).`);
    } else {
         console.log(`[Real OllamaService] Standalone chat, no transcript context provided.`);
    }
    messages.push({ role: 'user', content: latestUserMessage.text });

    console.log(`[Real OllamaService] Streaming response (model: ${modelToUse})...`); console.log(`[Real OllamaService] Sending ${messages.length} messages to Ollama for streaming.`);
    try {
        const stream = await ollama.chat({ model: modelToUse, messages: messages, stream: true, keep_alive: config.ollama.keepAlive, options: { ...(contextSize !== null && { num_ctx: contextSize }), } });
        console.log(`[Real OllamaService] Stream initiated for model ${modelToUse}.`); return stream;
    } catch (error: any) {
        console.error('[Real OllamaService] Error initiating chat stream:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) { console.error(`[Real OllamaService] Active Model '${modelToUse}' not found during stream init.`); throw new BadRequestError(`Model '${modelToUse}' not found. Please pull or select an available model.`); }
        if (error instanceof Error) { const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED'); if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); } }
        throw new InternalServerError('Failed to initiate stream from AI service.', error instanceof Error ? error : undefined);
    }
};

// --- Optionally include the deprecated non-streaming function ---
/*
export const generateChatResponse = async ( contextTranscript: string | null, chatHistory: BackendChatMessage[], retryAttempt: boolean = false ): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> => {
    // ... (original implementation) ...
};
*/
