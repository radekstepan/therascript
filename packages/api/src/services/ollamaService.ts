/* packages/api/src/services/ollamaService.ts */
import ollama, { ChatResponse, Message } from 'ollama';
import axios from 'axios'; // Import axios for the pull and status requests
import config from '../config/index.js';
import { BackendChatMessage } from '../types/index.js';
import { InternalServerError } from '../errors.js'; // Import InternalServerError

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. Context transcript and chat history will follow. Answer user questions based *only* on this provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

// Helper function to attempt pulling the model
async function pullOllamaModel(modelName: string): Promise<boolean> {
    const pullUrl = `${config.ollama.baseURL}/api/pull`;
    console.log(`[OllamaService] Attempting to pull model '${modelName}' from ${pullUrl}...`);
    try {
        // Use axios to make the POST request
        const response = await axios.post(pullUrl, {
            name: modelName,
            stream: false, // Wait for the pull to complete
        }, {
            // Set a longer timeout for model pulling if necessary
            timeout: 300000, // 5 minutes timeout for pull
        });

        // Check response status - Ollama API might return 200 even if already exists
        if (response.status === 200 && response.data?.status?.includes('success')) {
             console.log(`[OllamaService] Successfully pulled model '${modelName}' or it was already present.`);
             return true;
        } else {
            console.warn(`[OllamaService] Pull request for model '${modelName}' completed, but status was unexpected:`, response.data?.status);
            // Assume success if status is 200, as Ollama might just report completion
            return response.status === 200;
        }

    } catch (error: any) {
        console.error(`[OllamaService] Error pulling model '${modelName}':`, error.message);
        if (axios.isAxiosError(error) && error.response) {
             console.error('[OllamaService] Pull Error Details:', error.response.data);
        }
        return false;
    }
}

// Check if a model is loaded
export const checkModelStatus = async (modelName: string = config.ollama.model): Promise<boolean> => {
    const psUrl = `${config.ollama.baseURL}/api/ps`;
    console.log(`[OllamaService] Checking if model '${modelName}' is loaded using ${psUrl}...`);
    try {
        const response = await axios.get(psUrl, {
            timeout: 10000, // 10 seconds timeout for status check
        });

        if (response.status === 200) {
            // /api/ps returns { models: [{ name, ... }, ...] }
            const loadedModels = response.data.models || [];
            // Normalize model names by removing tags (e.g., ':latest')
            const normalizedModelName = modelName.split(':')[0]; // Get base name (e.g., 'llama3' from 'llama3:latest')
            const isLoaded = loadedModels.some((model: any) => {
                const normalizedLoadedModelName = model.name.split(':')[0];
                return normalizedLoadedModelName === normalizedModelName;
            });
            console.log(`[OllamaService] Model '${modelName}' ${isLoaded ? 'is' : 'is not'} loaded in memory. Found models:`, loadedModels.map((m: any) => m.name));
            return isLoaded;
        } else {
            console.warn(`[OllamaService] Unexpected response status for /api/ps: ${response.status}`);
            return false;
        }
    } catch (error: any) {
        console.error(`[OllamaService] Error checking model '${modelName}' status:`, error.message);
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 404) {
                // /api/ps should return 200 with empty models if none are loaded
                console.log(`[OllamaService] No models loaded (404 from /api/ps).`);
                return false;
            }
            if (error.code === 'ECONNREFUSED') {
                throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
            }
        }
        // Treat other errors (e.g., timeouts, network issues) as not loaded
        console.log(`[OllamaService] Assuming model '${modelName}' is not loaded due to error.`);
        return false;
    }
};

export const generateChatResponse = async (
    // Accepts the stringified transcript
    contextTranscript: string,
    chatHistory: BackendChatMessage[],
    retryAttempt: boolean = false // Flag to prevent infinite retry loops
): Promise<string> => {
    // Check if contextTranscript is empty/null/undefined, but proceed anyway
    if (!contextTranscript) {
        console.warn("[OllamaService] Generating response with empty or missing transcript context.");
        // No longer return early, let the prompt handle it
    }
    if (!chatHistory || chatHistory.length === 0) {
        console.error("[OllamaService] generateChatResponse called with empty chat history.");
        // Use the custom error class
        throw new InternalServerError("Internal Error: Cannot generate response without chat history.");
    }

    console.log(`[OllamaService] Generating response (model: ${config.ollama.model})...`);

    // Construct messages array, ensuring transcript context is included
    const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        // Include the transcript string. Handle the case where it might be empty.
        { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""\n\nCHAT HISTORY:` },
        // Append the actual chat history
        ...chatHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
    ];

    console.log(`[OllamaService] Sending ${messages.length} messages to Ollama (including system prompt and transcript context).`);

    try {
        const response: ChatResponse = await ollama.chat({
            model: config.ollama.model,
            messages: messages,
            stream: false,
            keep_alive: config.ollama.keepAlive,
            // host: config.ollama.baseURL, // Explicit host if needed
        });

        if (!response?.message?.content) {
             // Use the custom error class
             throw new InternalServerError('Invalid response structure from AI.');
        }

        const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
        console.log(`[OllamaService] Response received ${durationInfo}.`);
        return response.message.content.trim();

    } catch (error: any) {
        console.error('[OllamaService] Error:', error);

        // Check if it's a "model not found" error and if we haven't retried yet
        const isModelNotFoundError = error.message?.includes('model') &&
                                     (error.message?.includes('not found') || error.message?.includes('missing'));

        if (isModelNotFoundError && !retryAttempt) {
            console.warn(`[OllamaService] Model '${config.ollama.model}' not found. Attempting to pull and retry...`);
            const pullSuccess = await pullOllamaModel(config.ollama.model);
            if (pullSuccess) {
                console.log(`[OllamaService] Model pull successful (or model already present). Retrying chat request...`);
                // Retry the function call, marking it as a retry attempt
                return generateChatResponse(contextTranscript, chatHistory, true);
            } else {
                console.error(`[OllamaService] Failed to pull model '${config.ollama.model}'. Aborting chat request.`);
                 // Use the custom error class
                throw new InternalServerError(`Ollama model '${config.ollama.model}' not found and could not be pulled.`);
            }
        }

        // Handle other errors or if retry already happened
        if (error instanceof Error) {
            const isBrowser = typeof window !== 'undefined';
            // Check for connection errors (adjust based on environment if needed)
            const connectionError = isBrowser
                ? error.message.includes('Failed to fetch')
                // Check Node.js specific error code or general Axios error for connection refusal
                : (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' || (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');

            if (connectionError) {
                 // Use the custom error class
                throw new InternalServerError(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
            }
            // Re-throw model not found if it's the second attempt or pull failed
            if (isModelNotFoundError) {
                 // Use the custom error class
                throw new InternalServerError(`Ollama model '${config.ollama.model}' not found.`);
            }
            if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
                 // Use the custom error class
                throw new InternalServerError('AI service request timed out.');
            }
        }
        // Fallback generic error
        throw new InternalServerError('Failed to get response from AI service.', error instanceof Error ? error : undefined);
    }
};
