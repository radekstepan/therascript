// packages/api/src/services/ollamaService.ts
import ollama, { ChatResponse, Message, ListResponse, ShowResponse, GenerateResponse, Message as OllamaApiMessage, ProgressResponse, PullRequest } from 'ollama'; // Added PullRequest type
import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto'; // Import crypto for job ID
import config from '../config/index.js';
import { BackendChatMessage, OllamaModelInfo } from '../types/index.js';
import { InternalServerError, BadRequestError, ApiError, NotFoundError } from '../errors.js';
import { getActiveModel, getConfiguredContextSize } from './activeModelService.js';

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// --- NEW: Interface and Store for Pull Job Status ---
export type OllamaPullJobStatusState = 'queued' | 'parsing' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'canceling' | 'canceled';

export interface OllamaPullJobStatus {
    jobId: string;
    modelName: string;
    status: OllamaPullJobStatusState;
    message: string;
    progress?: number; // Overall percentage
    completedBytes?: number;
    totalBytes?: number;
    currentLayer?: string; // For more detail
    startTime: number;
    endTime?: number;
    error?: string;
}

// Simple in-memory store for job statuses. NOTE: This will be lost on server restart.
// TODO: Persist job statuses in the database for resilience?
const activePullJobs = new Map<string, OllamaPullJobStatus>();
// Store for background task cancellation flags
const pullJobCancellationFlags = new Map<string, boolean>();
// --- END NEW ---


// --- List Models (no change) ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
    console.log(`[OllamaService] Fetching available models from ${config.ollama.baseURL}/api/tags`);
    try {
        const response: ListResponse = await ollama.list();
        // TODO: Add more robust mapping and error handling for details
        return response.models.map(model => {
             const modifiedAtString = typeof model.modified_at?.toISOString === 'function' ? model.modified_at.toISOString() : String(model.modified_at);
            return {
                name: model.name,
                modified_at: modifiedAtString,
                size: model.size,
                digest: model.digest,
                details: {
                    format: model.details.format,
                    family: model.details.family,
                    families: model.details.families,
                    parameter_size: model.details.parameter_size,
                    quantization_level: model.details.quantization_level,
                },
            };
         });
    } catch (error: any) {
        console.error('[OllamaService] Error fetching available models:', error);
        if (error.message?.includes('ECONNREFUSED')) {
             throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`);
        }
        throw new InternalServerError('Failed to list models from Ollama service.', error instanceof Error ? error : new Error(String(error)));
    }
};

// --- Parse Ollama /api/pull Stream Chunk (for internal use) ---
function parseOllamaPullStreamChunk(chunk: ProgressResponse): Partial<OllamaPullJobStatus> {
    let percentage: number | undefined = undefined;
    if (chunk.total && chunk.completed) {
        percentage = Math.round((chunk.completed / chunk.total) * 100);
    }
    // Map Ollama status strings to our internal statuses
    let internalStatus: OllamaPullJobStatusState = 'downloading'; // Default assumption
    const message = chunk.status; // Use Ollama's status message directly

    if (message.includes('pulling manifest')) internalStatus = 'parsing';
    else if (message.includes('verifying sha256 digest')) internalStatus = 'verifying';
    else if (message.includes('writing manifest')) internalStatus = 'verifying';
    else if (message.includes('removing any unused layers')) internalStatus = 'verifying';
    else if (message.toLowerCase().includes('success')) internalStatus = 'completed'; // Use 'completed' for final success state
    else if (message.toLowerCase().includes('error')) internalStatus = 'failed';

    // Extract layer digest if present (for more detailed message maybe)
    const currentLayer = chunk.digest ? chunk.digest.substring(7, 19) : undefined; // sha256:... -> first 12 chars

    return {
        status: internalStatus,
        message: message,
        progress: percentage,
        completedBytes: chunk.completed,
        totalBytes: chunk.total,
        currentLayer: currentLayer, // Add layer info
        // Set error message if status is failed
        ...(internalStatus === 'failed' && { error: message }),
    };
}

// --- NEW: Background Pull Task Runner ---
async function runPullInBackground(jobId: string, modelName: string) {
    console.log(`[OllamaBG ${jobId}] Starting background pull for ${modelName}`);
    const jobStartTime = Date.now();
    // Initialize job status
    activePullJobs.set(jobId, {
        jobId, modelName, status: 'queued', message: 'Pull queued', startTime: jobStartTime,
    });
    pullJobCancellationFlags.set(jobId, false); // Initialize cancellation flag

    try {
        // --- FIX: Use 'model' property instead of 'name' ---
        const stream = await ollama.pull({ model: modelName, stream: true });
        // --- END FIX ---

        // Update status to indicate process has started (e.g., parsing manifest)
        activePullJobs.set(jobId, {
            ...activePullJobs.get(jobId)!, status: 'parsing', message: 'Pulling manifest...',
        });

        for await (const chunk of stream) {
            // Check cancellation flag before processing each chunk
            if (pullJobCancellationFlags.get(jobId)) {
                 console.log(`[OllamaBG ${jobId}] Cancellation requested, stopping pull for ${modelName}.`);
                 activePullJobs.set(jobId, {
                     ...activePullJobs.get(jobId)!, status: 'canceled', message: 'Pull canceled by user.', endTime: Date.now(),
                 });
                 // --- CLARIFICATION COMMENT ---
                 // NOTE: This stops processing the stream in the backend and updates the job status.
                 // However, due to limitations in the 'ollama-js' library and the Ollama API,
                 // this *does not* guarantee the underlying download process on the Ollama
                 // server itself is aborted. The server might continue downloading the layer.
                 // We are relying on breaking the loop and letting the connection potentially close.
                 // A more robust solution would require ollama-js supporting AbortSignal
                 // or a dedicated Ollama API endpoint for cancelling pulls.
                 // --- END CLARIFICATION ---
                 return; // Exit the background task
            }

            // Parse the chunk and update the job status map
            const progressUpdate = parseOllamaPullStreamChunk(chunk);
            const currentStatus = activePullJobs.get(jobId);

            // Ensure the job wasn't cancelled between the check and the update
            if (currentStatus && !pullJobCancellationFlags.get(jobId)) {
                 activePullJobs.set(jobId, {
                     ...currentStatus,
                     ...progressUpdate, // Apply parsed updates (status, message, progress, bytes etc)
                     // Ensure status and error fields are explicitly updated if present in progressUpdate
                     status: progressUpdate.status || currentStatus.status,
                     message: progressUpdate.message || currentStatus.message,
                     progress: progressUpdate.progress ?? currentStatus.progress,
                     error: progressUpdate.error ?? currentStatus.error,
                 });
            } else if (!currentStatus) {
                // Job might have been removed or an error occurred, stop processing
                console.warn(`[OllamaBG ${jobId}] Job status not found during update for ${modelName}. Stopping task.`);
                return;
            }

             // If a terminal status is reached from the chunk, break the loop early
            if (progressUpdate.status === 'completed' || progressUpdate.status === 'failed') {
                 console.log(`[OllamaBG ${jobId}] Terminal status '${progressUpdate.status}' detected from chunk for ${modelName}.`);
                 activePullJobs.set(jobId, { ...activePullJobs.get(jobId)!, endTime: Date.now() });
                 break; // Exit the loop
            }
        }

        // After the loop finishes (stream ends)
        const finalStatus = activePullJobs.get(jobId);
        // If the job wasn't explicitly marked as failed, completed or canceled during the loop, mark it as completed now.
        if (finalStatus && finalStatus.status !== 'failed' && finalStatus.status !== 'completed' && finalStatus.status !== 'canceled' && finalStatus.status !== 'canceling') {
             console.log(`[OllamaBG ${jobId}] Stream ended normally, marking job as completed for ${modelName}.`);
             activePullJobs.set(jobId, {
                 ...finalStatus, status: 'completed', message: 'Pull finished successfully.', progress: 100, endTime: Date.now(),
             });
        } else if (finalStatus) {
             console.log(`[OllamaBG ${jobId}] Stream ended, job already had terminal status: ${finalStatus.status}`);
             if (!finalStatus.endTime) { // Ensure end time is set
                activePullJobs.set(jobId, { ...finalStatus, endTime: Date.now() });
             }
        }

    } catch (error: any) {
        console.error(`[OllamaBG ${jobId}] Error during background pull for ${modelName}:`, error);
        const finalStatus = activePullJobs.get(jobId);
        // Ensure status is marked as failed on error
        activePullJobs.set(jobId, {
             // Use existing status if available, otherwise create a basic failed entry
             ...(finalStatus ?? { jobId, modelName, status: 'failed', message: 'Pull failed', startTime: jobStartTime }),
             status: 'failed',
             error: error.message || 'Unknown error during pull', // Store error message
             message: `Pull failed: ${error.message || 'Unknown'}`,
             endTime: Date.now(),
        });
    } finally {
        // Clean up cancellation flag regardless of outcome
        pullJobCancellationFlags.delete(jobId);
        console.log(`[OllamaBG ${jobId}] Background pull task finished for ${modelName}. Final status: ${activePullJobs.get(jobId)?.status}`);
        // TODO: Implement cleanup logic for old jobs in activePullJobs map (e.g., based on endTime)
    }
}
// --- END NEW ---


// --- NEW: Start Pull Model Job (Non-Streaming) ---
export const startPullModelJob = (modelName: string): string => {
    if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
        throw new BadRequestError("Invalid model name provided.");
    }
    // TODO: Check if a job for this model is already running or recently completed?
    const jobId = crypto.randomUUID();
    console.log(`[OllamaService] Queuing pull job ${jobId} for model: ${modelName}`);

    // Start the background process but don't wait for it (`void` indicates fire-and-forget)
    void runPullInBackground(jobId, modelName).catch(err => {
        // This catch is for unhandled errors *within* the async background function itself
        console.error(`[OllamaService] CRITICAL: Uncaught error escaped background pull job ${jobId} for ${modelName}:`, err);
         // Attempt to update job status to failed if it wasn't already terminal
         const currentStatus = activePullJobs.get(jobId);
         if(currentStatus && currentStatus.status !== 'completed' && currentStatus.status !== 'failed' && currentStatus.status !== 'canceled') {
             activePullJobs.set(jobId, {
                 ...currentStatus, status: 'failed', error: 'Background task crashed unexpectedly', message: 'Background task crashed', endTime: Date.now(),
             });
         }
    });

    // Return the job ID immediately
    return jobId;
};
// --- END NEW ---

// --- NEW: Get Pull Model Job Status ---
export const getPullModelJobStatus = (jobId: string): OllamaPullJobStatus | null => {
    const status = activePullJobs.get(jobId);
    // Avoid logging potentially sensitive details in production if status exists
    if (config.server.isProduction) {
        console.log(`[OllamaService] Getting status for job ${jobId}. Found: ${!!status}`);
    } else {
        console.log(`[OllamaService] Getting status for job ${jobId}. Status:`, status);
    }
    return status ?? null; // Return null if job ID not found
};
// --- END NEW ---

// --- NEW: Cancel Pull Model Job ---
export const cancelPullModelJob = (jobId: string): boolean => {
     const job = activePullJobs.get(jobId);
     if (!job) {
         console.log(`[OllamaService] Cancel request for non-existent job ${jobId}`);
         return false; // Job doesn't exist or already cleaned up
     }

     // Check if already in a terminal state
     if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled' || job.status === 'canceling') {
          console.log(`[OllamaService] Job ${jobId} is already in state (${job.status}), cannot cancel.`);
          return false; // Already finished or already canceling
     }

     console.log(`[OllamaService] Setting cancellation flag for job ${jobId}`);
     pullJobCancellationFlags.set(jobId, true); // Set the flag for the background task to check

     // Update status immediately to 'canceling' for immediate feedback via polling
     activePullJobs.set(jobId, { ...job, status: 'canceling', message: 'Cancellation requested...' });

     // TODO: If ollama-js library or future API provides an abort handle for ollama.pull, call it here.
     // --- CLARIFICATION COMMENT ---
     // NOTE: Currently, setting the flag only stops the *backend* from processing further updates.
     // It doesn't abort the actual download process running within the Ollama container.
     // --- END CLARIFICATION ---

     return true; // Cancellation initiated
};
// --- END NEW ---


// --- Check Model Status (no change) ---
export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null> => {
    const psUrl = `${config.ollama.baseURL}/api/ps`;
    console.log(`[OllamaService] Checking if specific model '${modelToCheck}' is loaded using ${psUrl}...`);
    try {
        const response = await axios.get(psUrl, { timeout: 10000 }); // Using axios directly
        if (response.status === 200) {
            const loadedModels = response.data.models || [];
            const loadedModel = loadedModels.find((model: any) => model.name === modelToCheck); // Find specific model

            if (loadedModel) {
                console.log(`[OllamaService] Specific model '${modelToCheck}' found loaded.`);
                // Map the response to OllamaModelInfo
                return {
                    name: loadedModel.name,
                    modified_at: loadedModel.modified_at ?? 'N/A', // modified_at might not be in /ps
                    size: loadedModel.size ?? 0, // Use 'size' from /ps if available
                    digest: loadedModel.digest,
                    details: loadedModel.details ?? { // Ensure details object exists
                        format: 'unknown', family: 'unknown', families: null,
                        parameter_size: 'unknown', quantization_level: 'unknown'
                    },
                    size_vram: loadedModel.size_vram, // Optional fields from /ps
                    expires_at: loadedModel.expires_at,
                    size_total: loadedModel.size, // Keep total size from /ps
                };
            } else {
                console.log(`[OllamaService] Specific model '${modelToCheck}' not found among loaded models:`, loadedModels.map((m: any) => m.name));
                return null;
            }
        } else {
            console.warn(`[OllamaService] Unexpected status code ${response.status} from /api/ps`);
            return null;
        }
    } catch (error: any) {
        console.error(`[OllamaService] Error checking status for specific model '${modelToCheck}':`, error.message);
        if (axios.isAxiosError(error)) {
             if (error.code === 'ECONNREFUSED') {
                 throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
             }
        }
        console.log(`[OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to error.`);
        return null; // Don't throw, just indicate not loaded on error
     }
};


// --- Load Model Function (no change) ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
     if (!modelName) {
        throw new BadRequestError("Model name must be provided to load.");
    }
    console.log(`[OllamaService] Triggering load for model '${modelName}' using a minimal chat request...`);
    try {
        // Send a trivial chat request to force loading
        const response = await ollama.chat({
            model: modelName,
            messages: [{ role: 'user', content: 'ping' }], // Minimal prompt
            stream: false,
            // keep_alive defaults might be sufficient, or use config: keep_alive: config.ollama.keepAlive
        });
        console.log(`[OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`);
        // TODO: Could add a checkModelStatus poll here to confirm load before resolving?

    } catch (error: any) {
        console.error(`[OllamaService] Error during load trigger chat request for '${modelName}':`, error);
        // Check if it's a model not found error
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError) {
             console.error(`[OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`);
             // TODO: Should this just warn or throw BadRequestError? Throwing seems better.
             throw new BadRequestError(`Model '${modelName}' not found locally. Please pull the model first.`);
        }
        // Check for connection errors
        if (error.message?.includes('ECONNREFUSED')) {
             throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`);
        }
        // General internal server error for other issues
        throw new InternalServerError(`Failed to trigger load for model '${modelName}' via chat request.`, error instanceof Error ? error : undefined);
    }
};


// --- Generate Chat Response (no change) ---
export const generateChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> => {

    const modelToUse = getActiveModel();
    const contextSize = getConfiguredContextSize(); // Get configured size
    console.log(`[OllamaService:generateChatResponse] Attempting chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);

    if (!contextTranscript) console.warn("[OllamaService] Generating response with empty or missing transcript context string.");
    else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot generate response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");

    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);
    // TODO: Consider token limits when constructing the context message
    const transcriptContextMessage: Message = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        // Map previous history
        ...previousHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
        // Add context and latest user message
        transcriptContextMessage,
        { role: 'user', content: latestUserMessage.text }
    ];
    console.log(`[OllamaService] Generating response (model: ${modelToUse})...`);
    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama.`);

    try {
        const response: ChatResponse = await ollama.chat({
            model: modelToUse,
            messages: messages,
            stream: false,
            keep_alive: config.ollama.keepAlive,
             options: {
                 // Add num_ctx if configured
                 ...(contextSize !== null && { num_ctx: contextSize }),
             }
        });

        if (!response?.message?.content) {
             throw new InternalServerError('Invalid response structure from AI.');
        }
        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
        const tokensInfo = response.prompt_eval_count && response.eval_count ? `(${response.prompt_eval_count} prompt + ${response.eval_count} completion tokens)` : '';
        console.log(`[OllamaService] Response received ${durationInfo} ${tokensInfo}.`);

        return {
            content: response.message.content.trim(),
            promptTokens: response.prompt_eval_count,
            completionTokens: response.eval_count
        };

    } catch (error: any) { // Error handling including potential pull/retry
        console.error('[OllamaService] Error during generateChatResponse:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));

        if (isModelNotFoundError) {
             console.error(`[OllamaService] Active Model '${modelToUse}' not found during chat.`);
             // TODO: Maybe trigger a status check or inform the user more directly?
             throw new BadRequestError(`Model '${modelToUse}' not found. Please pull or select an available model.`);
        }

        // Handle connection errors and timeouts
        if (error instanceof Error) {
             const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
             if (connectionError) {
                 throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
             }
             if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
                 throw new InternalServerError('AI service request timed out.');
             }
        }
        // Fallback for other errors
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};


// --- Stream Chat Response (no change) ---
export const streamChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<AsyncIterable<ChatResponse>> => {

    const modelToUse = getActiveModel();
    const contextSize = getConfiguredContextSize(); // Get configured size
    console.log(`[OllamaService:streamChatResponse] Attempting streaming chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);

    if (!contextTranscript) console.warn("[OllamaService] Streaming response with empty or missing transcript context string.");
    else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot stream response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");

    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);
    // TODO: Consider token limits when constructing the context message
    const transcriptContextMessage: OllamaApiMessage = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: OllamaApiMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...previousHistory.map((msg): OllamaApiMessage => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
        transcriptContextMessage,
        { role: 'user', content: latestUserMessage.text }
    ];
    console.log(`[OllamaService] Streaming response (model: ${modelToUse})...`);
    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama for streaming.`);

    try {
        // Use ollama.chat with stream: true
        const stream = await ollama.chat({
            model: modelToUse,
            messages: messages,
            stream: true, // Enable streaming
            keep_alive: config.ollama.keepAlive,
             options: {
                 // Add num_ctx if configured
                 ...(contextSize !== null && { num_ctx: contextSize }),
             }
        });
        console.log(`[OllamaService] Stream initiated for model ${modelToUse}.`);
        return stream; // Return the async iterator directly

    } catch (error: any) { // Error handling for initiating the stream
        console.error('[OllamaService] Error initiating chat stream:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));

        if (isModelNotFoundError) {
            console.error(`[OllamaService] Active Model '${modelToUse}' not found during stream init.`);
            // TODO: Maybe trigger a status check or inform the user more directly?
            throw new BadRequestError(`Model '${modelToUse}' not found. Please pull or select an available model.`);
        }
        // Handle connection errors
        if (error instanceof Error) {
            const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
            if (connectionError) {
                throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
            }
        }
        // Fallback for other errors
        throw new InternalServerError('Failed to initiate stream from AI service.', error instanceof Error ? error : undefined);
    }
};
