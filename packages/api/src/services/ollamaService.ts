/* packages/api/src/services/ollamaService.ts */
import ollama, { ChatResponse, Message } from 'ollama';
import axios from 'axios'; // Import axios for the pull and status requests
import config from '../config/index.js'; // Import config
import { BackendChatMessage } from '../types/index.js';
import { InternalServerError } from '../errors.js'; // Import InternalServerError

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. Context transcript and chat history will follow. Answer user questions based *only* on this provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// Helper function to attempt pulling the model (Keep as is)
async function pullOllamaModel(modelName: string): Promise<boolean> {
    // ... (implementation remains the same)
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

// Check if a model is loaded (Keep as is)
export const checkModelStatus = async (modelName: string = config.ollama.model): Promise<boolean> => {
    // ... (implementation remains the same)
    const psUrl = `${config.ollama.baseURL}/api/ps`;
    console.log(`[OllamaService] Checking if model '${modelName}' is loaded using ${psUrl}...`);
    try {
        const response = await axios.get(psUrl, { timeout: 10000 });
        if (response.status === 200) {
            const loadedModels = response.data.models || [];
            const normalizedModelName = modelName.split(':')[0];
            const isLoaded = loadedModels.some((model: any) => model.name.split(':')[0] === normalizedModelName);
            console.log(`[OllamaService] Model '${modelName}' ${isLoaded ? 'is' : 'is not'} loaded. Found:`, loadedModels.map((m: any) => m.name));
            return isLoaded;
        } else { console.warn(`[OllamaService] Unexpected status for /api/ps: ${response.status}`); return false; }
    } catch (error: any) { /* ... error handling ... */
        console.error(`[OllamaService] Error checking model '${modelName}' status:`, error.message);
        if (axios.isAxiosError(error)) { /* ... specific checks ... */
             if (error.code === 'ECONNREFUSED') { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); }
        }
        console.log(`[OllamaService] Assuming model '${modelName}' is not loaded due to error.`); return false;
     }
};

export const generateChatResponse = async (
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false
): Promise<string> => {

    // *** ADD THIS LOG ***
    const modelToUse = config.ollama.model;
    console.log(`[OllamaService:generateChatResponse] Attempting chat with model: ${modelToUse}`);
    // *** END ADDED LOG ***


    if (!contextTranscript) { console.warn("[OllamaService] Generating response with empty or missing transcript context."); }
    if (!chatHistory || chatHistory.length === 0) { console.error("[OllamaService] generateChatResponse called with empty chat history."); throw new InternalServerError("Internal Error: Cannot generate response without chat history."); }

    console.log(`[OllamaService] Generating response (model: ${modelToUse})...`); // Use variable

    const messages: Message[] = [ /* ... construct messages ... */
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""\n\nCHAT HISTORY:` },
        ...chatHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
    ];

    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama (including system prompt and transcript context).`);

    try {
        const response: ChatResponse = await ollama.chat({
            model: modelToUse, // Use variable
            messages: messages,
            stream: false,
            keep_alive: config.ollama.keepAlive,
            // host: config.ollama.baseURL, // Explicit host if needed
        });

        if (!response?.message?.content) { throw new InternalServerError('Invalid response structure from AI.'); }
        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
        console.log(`[OllamaService] Response received ${durationInfo}.`);
        return response.message.content.trim();

    } catch (error: any) {
        console.error('[OllamaService] Error:', error);
        const isModelNotFoundError = error.message?.includes('model') && (error.message?.includes('not found') || error.message?.includes('missing'));

        if (isModelNotFoundError && !retryAttempt) {
            console.warn(`[OllamaService] Model '${modelToUse}' not found. Attempting pull/retry...`); // Use variable
            const pullSuccess = await pullOllamaModel(modelToUse); // Use variable
            if (pullSuccess) {
                console.log(`[OllamaService] Model pull ok. Retrying chat request...`);
                return generateChatResponse(contextTranscript, chatHistory, true);
            } else {
                console.error(`[OllamaService] Failed to pull model '${modelToUse}'. Aborting.`); // Use variable
                throw new InternalServerError(`Ollama model '${modelToUse}' not found and could not be pulled.`); // Use variable
            }
        }
        /* ... other error handling ... */
        if (error instanceof Error) { /* ... connection/timeout checks ... */
             const isBrowser = typeof window !== 'undefined';
             const connectionError = isBrowser ? error.message.includes('Failed to fetch') : (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
             if (connectionError) { throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`); }
             if (isModelNotFoundError) { throw new InternalServerError(`Ollama model '${modelToUse}' not found.`); } // Use variable
             if (error.name === 'TimeoutError' || error.message.includes('timeout')) { throw new InternalServerError('AI service request timed out.'); }
        }
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};
