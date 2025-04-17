/* packages/api/src/services/ollamaService.ts */
import ollama, { ChatResponse, Message, ListResponse, ShowResponse, GenerateResponse, Message as OllamaApiMessage } from 'ollama'; // Added OllamaApiMessage
import axios, { AxiosError } from 'axios';
import config from '../config/index.js';
import { BackendChatMessage, OllamaModelInfo } from '../types/index.js';
import { InternalServerError, BadRequestError, ApiError } from '../errors.js';
// --- Import context size getter ---
import { getActiveModel, getConfiguredContextSize } from './activeModelService.js';
// --- End Import ---

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// --- List Models (no change) ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
    // ... existing code ...
    console.log(`[OllamaService] Fetching available models from ${config.ollama.baseURL}/api/tags`);
    try {
        const response: ListResponse = await ollama.list();

        if (response.models && response.models.length > 0) {
            const firstModel = response.models[0];
            console.log(`[OllamaService DEBUG] Runtime typeof first model.modified_at: ${typeof firstModel.modified_at}`);
            console.log(`[OllamaService DEBUG] Does first model.modified_at have toISOString method? ${typeof firstModel.modified_at?.toISOString === 'function'}`);
             try { console.log(`[OllamaService DEBUG] Value of first model.modified_at: ${firstModel.modified_at}`); } catch (e) { console.error("[OllamaService DEBUG] Error logging raw modified_at value:", e); }
        }

        return response.models.map(model => {
             const modifiedAtString = typeof model.modified_at?.toISOString === 'function' ? model.modified_at.toISOString() : String(model.modified_at);
            return {
                name: model.name,
                modified_at: modifiedAtString,
                size: model.size,
                digest: model.digest,
                details: { format: model.details.format, family: model.details.family, families: model.details.families, parameter_size: model.details.parameter_size, quantization_level: model.details.quantization_level, },
            };
         });
    } catch (error: any) {
        console.error('[OllamaService] Error fetching available models:', error);
        if (error.message?.includes('ECONNREFUSED')) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`); }
        console.error('[OllamaService] Raw error object during listModels:', error);
        if (error instanceof TypeError && error.message.includes('.toISOString')) { console.error("[OllamaService CRITICAL] Still getting toISOString error despite checking. Check library version/behavior."); }
        throw new InternalServerError('Failed to list models from Ollama service.', error instanceof Error ? error : new Error(String(error)));
    }
};
// --- End List Models ---


// --- Pull Model (no change) ---
export const pullOllamaModel = async (modelName: string): Promise<void> => {
    // ... existing code ...
    const pullUrl = `${config.ollama.baseURL}/api/pull`;
    console.log(`[OllamaService] Initiating pull for model '${modelName}' via POST to ${pullUrl}...`);
    try {
        // Send the request but don't wait for the potentially long stream
        const response = await axios.post(pullUrl, { name: modelName, stream: false }, {
            // Very short timeout just to ensure the request is accepted by Ollama
            timeout: 15000, // 15 seconds should be enough for Ollama to start the process
        });

        // Check if Ollama accepted the request (200 OK)
        if (response.status === 200) {
             console.log(`[OllamaService] Pull request for model '${modelName}' accepted by Ollama (status: ${response.data?.status}). Check logs or list models later.`);
             // Returning void, success indicates the request was accepted, not that the pull is finished.
             return;
        } else {
            // Should not happen if status is 200, but good practice
            console.warn(`[OllamaService] Pull request for model '${modelName}' returned status ${response.status}, but expected 200.`);
             throw new InternalServerError(`Ollama returned unexpected status ${response.status} when initiating pull.`);
        }
    } catch (error: any) {
        console.error(`[OllamaService] Error initiating pull for model '${modelName}':`, error.message);
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                // Handle specific errors like 400 Bad Request (e.g., invalid model format)
                if (axiosError.response.status === 400) {
                    throw new BadRequestError(`Invalid model name format or request: ${JSON.stringify(axiosError.response.data)}`);
                }
                console.error('[OllamaService] Pull Initiation Error Details:', axiosError.response.data);
                throw new InternalServerError(`Ollama service failed to initiate pull: ${axiosError.response.status} ${JSON.stringify(axiosError.response.data)}`, error);
            } else if (axiosError.request) {
                 if (axiosError.code === 'ECONNREFUSED') {
                     throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to initiate pull.`);
                 }
                throw new InternalServerError('Ollama service did not respond during pull initiation.', error);
            } else {
                 // Network error before request could be made
                throw new InternalServerError('Network error initiating pull request.', error);
            }
        }
        throw new InternalServerError('Failed to initiate pull from Ollama service.', error instanceof Error ? error : undefined);
    }
};
// --- End Pull Model ---


// --- Check Model Status (no change) ---
export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null> => {
    // ... existing code ...
    const psUrl = `${config.ollama.baseURL}/api/ps`;
    console.log(`[OllamaService] Checking if specific model '${modelToCheck}' is loaded using ${psUrl}...`); // Log specific model
    try {
        // Using axios directly as ollama lib has no 'ps' wrapper
        const response = await axios.get(psUrl, { timeout: 10000 });
        if (response.status === 200) {
            const loadedModels = response.data.models || [];
            // --- Find the specific model requested ---
            const loadedModel = loadedModels.find((model: any) => model.name === modelToCheck);
            // --- End Change ---

            if (loadedModel) {
                console.log(`[OllamaService] Specific model '${modelToCheck}' found loaded.`);
                // Map the response to OllamaModelInfo
                return {
                    name: loadedModel.name,
                    modified_at: loadedModel.modified_at ?? 'N/A', // modified_at might not be in /ps, treat as string
                    size: loadedModel.size ?? 0, // Use 'size' from /ps if available, else 0
                    digest: loadedModel.digest,
                    details: loadedModel.details ?? { // Ensure details object exists
                        format: 'unknown', family: 'unknown', families: null,
                        parameter_size: 'unknown', quantization_level: 'unknown'
                    },
                    // Add optional fields from /ps if they exist
                    size_vram: loadedModel.size_vram,
                    expires_at: loadedModel.expires_at,
                    size_total: loadedModel.size, // Keep total size from /ps
                };
            } else {
                console.log(`[OllamaService] Specific model '${modelToCheck}' not found among loaded models:`, loadedModels.map((m: any) => m.name));
                return null;
            }
        } else { console.warn(`[OllamaService] Unexpected status for /api/ps: ${response.status}`); return null; }
    } catch (error: any) {
        console.error(`[OllamaService] Error checking status for specific model '${modelToCheck}':`, error.message);
        if (axios.isAxiosError(error)) { if (error.code === 'ECONNREFUSED') { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); } }
        console.log(`[OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to error.`); return null;
     }
};
// --- End Check Model Status ---


// --- Load Model Function (no change) ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
    // ... existing code ...
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
        });
        console.log(`[OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`);

    } catch (error: any) {
        console.error(`[OllamaService] Error during load trigger chat request for '${modelName}':`, error);
        if (error.status === 404 || (error.message?.includes('model') && error.message?.includes('not found'))) {
             console.error(`[OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`);
             console.warn(`[OllamaService] Model '${modelName}' not found locally during load. Attempting to pull...`);
             try {
                 await pullOllamaModel(modelName); // Call the pull initiator, returns void
                 console.log(`[OllamaService] Pull initiated for '${modelName}'. Load *might* succeed later. Returning success from load trigger.`);
                 return;
             } catch (pullError) {
                console.error(`[OllamaService] Failed to initiate pull for '${modelName}'. Load cannot proceed. Pull error:`, pullError);
                throw new BadRequestError(`Model '${modelName}' not found locally and could not be pulled.`);
             }
        }
        if (error.message?.includes('ECONNREFUSED')) {
             throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`);
        }
        throw new InternalServerError(`Failed to trigger load for model '${modelName}' via chat request.`, error instanceof Error ? error : undefined);
    }
};
// --- End Load Model Function ---


// --- Generate Chat Response (Deprecated Internally - Use context size) ---
export const generateChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> => {

    const modelToUse = getActiveModel();
    const contextSize = getConfiguredContextSize(); // <-- Get configured size
    console.log(`[OllamaService:generateChatResponse] Attempting chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);

    // ... (rest of setup logic unchanged) ...
    if (!contextTranscript) console.warn("[OllamaService] Generating response with empty or missing transcript context string.");
    else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot generate response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");

    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);
    const transcriptContextMessage: Message = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: Message[] = [ { role: 'system', content: SYSTEM_PROMPT }, ...previousHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })), transcriptContextMessage, { role: 'user', content: latestUserMessage.text } ];
    console.log(`[OllamaService] Generating response (model: ${modelToUse})...`);
    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama.`);

    try {
        const response: ChatResponse = await ollama.chat({
            model: modelToUse,
            messages: messages,
            stream: false,
            keep_alive: config.ollama.keepAlive,
             options: {
                 // --- Add num_ctx if configured ---
                 ...(contextSize !== null && { num_ctx: contextSize }),
                 // --- End Add ---
             }
        });

        // ... (rest of response handling unchanged) ...
        if (!response?.message?.content) throw new InternalServerError('Invalid response structure from AI.');
        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
        const tokensInfo = response.prompt_eval_count && response.eval_count ? `(${response.prompt_eval_count} prompt + ${response.eval_count} completion tokens)` : '';
        console.log(`[OllamaService] Response received ${durationInfo} ${tokensInfo}.`);
        return { content: response.message.content.trim(), promptTokens: response.prompt_eval_count, completionTokens: response.eval_count };

    } catch (error: any) { // Error handling including pull/retry
        // ... (error handling logic unchanged) ...
        console.error('[OllamaService] Error during generateChatResponse:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError && !retryAttempt) {
            console.warn(`[OllamaService] Active Model '${modelToUse}' not found during chat. Attempting pull initiation...`);
            try {
                await pullOllamaModel(modelToUse); // Initiate pull
                console.log(`[OllamaService] Pull initiated for '${modelToUse}'. Retrying chat request...`);
                return generateChatResponse(contextTranscript, chatHistory, true); // Retry the chat
            } catch (pullError) {
                console.error(`[OllamaService] Failed to initiate pull for '${modelToUse}'. Aborting chat. Pull error:`, pullError);
                 throw new InternalServerError(`Ollama model '${modelToUse}' not found and could not be pulled.`);
            }
        }
        if (error instanceof Error) {
             const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
             if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); }
             if (isModelNotFoundError && retryAttempt) {
                 throw new InternalServerError(`Ollama model '${modelToUse}' not found even after attempting pull.`);
             }
             if (error.name === 'TimeoutError' || error.message.includes('timeout')) { throw new InternalServerError('AI service request timed out.'); }
        }
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};
// --- End Generate Chat Response ---

// --- Stream Chat Response (Use context size) ---
export const streamChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<AsyncIterable<ChatResponse>> => {

    const modelToUse = getActiveModel();
    const contextSize = getConfiguredContextSize(); // <-- Get configured size
    console.log(`[OllamaService:streamChatResponse] Attempting streaming chat with ACTIVE model: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`);

    // ... (rest of setup logic unchanged) ...
    if (!contextTranscript) console.warn("[OllamaService] Streaming response with empty or missing transcript context string.");
    else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);
    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot stream response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");

    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);
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
                 // --- Add num_ctx if configured ---
                 ...(contextSize !== null && { num_ctx: contextSize }),
                 // --- End Add ---
             }
        });
        console.log(`[OllamaService] Stream initiated for model ${modelToUse}.`);
        return stream; // Return the async iterator directly

    } catch (error: any) { // Error handling for initiating the stream
        // ... (error handling logic unchanged) ...
        console.error('[OllamaService] Error initiating chat stream:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));

        if (isModelNotFoundError && !retryAttempt) {
            console.warn(`[OllamaService] Active Model '${modelToUse}' not found during stream init. Attempting pull...`);
            try {
                await pullOllamaModel(modelToUse);
                console.log(`[OllamaService] Pull initiated for '${modelToUse}'. Retrying stream request...`);
                return streamChatResponse(contextTranscript, chatHistory, true); // Retry
            } catch (pullError) {
                 console.error(`[OllamaService] Failed to initiate pull for '${modelToUse}'. Aborting stream. Pull error:`, pullError);
                 throw new InternalServerError(`Ollama model '${modelToUse}' not found and could not be pulled.`);
            }
        }
        if (error instanceof Error) {
            const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
            if (connectionError) throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
            if (isModelNotFoundError && retryAttempt) throw new InternalServerError(`Ollama model '${modelToUse}' not found even after attempting pull.`);
        }
        throw new InternalServerError('Failed to initiate stream from AI service.', error instanceof Error ? error : undefined);
    }
};
// --- End Stream Chat Response ---
