// packages/api/src/services/ollamaService.ts
/* packages/api/src/services/ollamaService.ts */
import ollama, { ChatResponse, Message, ListResponse, ShowResponse, GenerateResponse } from 'ollama';
import axios from 'axios';
import config from '../config/index.js';
import { BackendChatMessage, OllamaModelInfo } from '../types/index.js';
import { InternalServerError, BadRequestError } from '../errors.js';
import { getActiveModel } from './activeModelService.js'; // Import the getter

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// --- List Models ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
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


// --- Pull Model ---
async function pullOllamaModel(modelName: string): Promise<boolean> {
    const pullUrl = `${config.ollama.baseURL}/api/pull`;
    console.log(`[OllamaService] Attempting to pull model '${modelName}' from ${pullUrl}...`);
    try {
        const response = await axios.post(pullUrl, { name: modelName, stream: false }, { timeout: 300000 });
        if (response.status === 200 && response.data?.status?.includes('success')) {
             console.log(`[OllamaService] Successfully pulled model '${modelName}' or it was already present.`);
             return true;
        } else {
            console.warn(`[OllamaService] Pull request for model '${modelName}' completed, but status was unexpected:`, response.data?.status);
            return response.status === 200;
        }
    } catch (error: any) {
        console.error(`[OllamaService] Error pulling model '${modelName}':`, error.message);
        if (axios.isAxiosError(error) && error.response) { console.error('[OllamaService] Pull Error Details:', error.response.data); }
        return false;
    }
}

// --- Check Model Status (Accepts model name) ---
// This checks if a *specific* model is loaded in Ollama's memory via /ps
export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null> => {
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
// --- End Modified Check Model Status ---


// --- Load Model Function (Reverted to use ollama.chat AND REMOVED keep_alive: '1s') ---
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
            // --- REMOVED keep_alive: '1s' ---
            // Let Ollama use its default keep-alive mechanism
        });
        console.log(`[OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`);
        // The frontend polling mechanism will verify the final loaded state via /api/ps.

    } catch (error: any) {
        console.error(`[OllamaService] Error during load trigger chat request for '${modelName}':`, error);
        if (error.status === 404 || (error.message?.includes('model') && error.message?.includes('not found'))) {
             console.error(`[OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`);
             throw new BadRequestError(`Model '${modelName}' not found locally. Please ensure it is pulled.`);
        }
        if (error.message?.includes('ECONNREFUSED')) {
             throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`);
        }
        throw new InternalServerError(`Failed to trigger load for model '${modelName}' via chat request.`, error instanceof Error ? error : undefined);
    }
};
// --- End Load Model Function ---


// --- Generate Chat Response (Uses Active Model) ---
export const generateChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<{ content: string; promptTokens?: number; completionTokens?: number }> => {

    const modelToUse = getActiveModel();
    console.log(`[OllamaService:generateChatResponse] Attempting chat with ACTIVE model: ${modelToUse}`);

    if (!contextTranscript) console.warn("[OllamaService] Generating response with empty or missing transcript context string.");
    else console.log(`[OllamaService] Transcript context string provided (length: ${contextTranscript.length}).`);

    if (!chatHistory || chatHistory.length === 0) throw new InternalServerError("Internal Error: Cannot generate response without chat history.");
    if (chatHistory[chatHistory.length - 1].sender !== 'user') throw new InternalServerError("Internal Error: Malformed chat history for LLM.");

    console.log(`[OllamaService] Generating response (model: ${modelToUse})...`);

    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);

    const transcriptContextMessage: Message = { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""` };
    const messages: Message[] = [ { role: 'system', content: SYSTEM_PROMPT }, ...previousHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })), transcriptContextMessage, { role: 'user', content: latestUserMessage.text } ];

    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama.`);
    messages.slice(-3).forEach((msg, index) => { const snippet = msg.content.substring(0, 150).replace(/\n/g, '\\n') + (msg.content.length > 150 ? '...' : ''); console.log(`[OllamaService DEBUG] Message [-${messages.length - index}]: Role=${msg.role}, Content Snippet="${snippet}"`); });

    try {
        const response: ChatResponse = await ollama.chat({
            model: modelToUse, // Use the active model
            messages: messages,
            stream: false,
            keep_alive: config.ollama.keepAlive, // Use keep_alive from config for actual chats
             options: {
                 // TODO: Make context size configurable via the UI/Modal
                 // num_ctx: 4096, // Example: Set context size if needed
             }
        });

        if (!response?.message?.content) throw new InternalServerError('Invalid response structure from AI.');

        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
        const tokensInfo = response.prompt_eval_count && response.eval_count ? `(${response.prompt_eval_count} prompt + ${response.eval_count} completion tokens)` : '';
        console.log(`[OllamaService] Response received ${durationInfo} ${tokensInfo}.`);

        return { content: response.message.content.trim(), promptTokens: response.prompt_eval_count, completionTokens: response.eval_count };

    } catch (error: any) { // Error handling including pull/retry
        console.error('[OllamaService] Error:', error);
        const isModelNotFoundError = error.status === 404 || (error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing')));
        if (isModelNotFoundError && !retryAttempt) {
            console.warn(`[OllamaService] Active Model '${modelToUse}' not found during chat. Attempting pull/retry...`);
            const pullSuccess = await pullOllamaModel(modelToUse);
            if (pullSuccess) { console.log(`[OllamaService] Model pull ok. Retrying chat request...`); return generateChatResponse(contextTranscript, chatHistory, true); }
            else { console.error(`[OllamaService] Failed to pull model '${modelToUse}'. Aborting chat.`); throw new InternalServerError(`Ollama model '${modelToUse}' not found and could not be pulled.`); }
        }
        if (error instanceof Error) {
             const connectionError = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
             if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); }
             if (isModelNotFoundError) { throw new InternalServerError(`Ollama model '${modelToUse}' not found.`); }
             if (error.name === 'TimeoutError' || error.message.includes('timeout')) { throw new InternalServerError('AI service request timed out.'); }
        }
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};
