// src/services/ollamaService.ts
import ollama, { ChatResponse, Message } from 'ollama'; // Import default export
import config from '../config'; // Relative
import { BackendChatMessage } from '../types'; // Relative

// --- REMOVED INCORRECT CONFIG CALL ---
// The library typically reads OLLAMA_HOST env var or uses default http://localhost:11434
// ollama.config({ host: config.ollama.baseURL }); // REMOVE THIS - Only needed for non-standard setup

// Log the host being used (either default or from environment variable)
// Note: The library doesn't expose the configured host easily, so we log the config value
// but the actual host used might differ if OLLAMA_HOST is set.
console.log(`[OllamaService] Configured to target host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript.
The user will provide the full session transcript followed by the current chat history.
Your task is to answer the user's questions based *only* on the provided transcript and chat history.
Be concise and directly address the user's query. Do not add pleasantries or extraneous information unless asked.
If the answer cannot be found in the transcript or history, state that clearly ("Based on the provided transcript and chat history, I cannot answer that.").
Do not make up information. Refer to the participants as "Therapist" and "Patient" or by name if mentioned clearly in the transcript.
Focus solely on the content provided in the transcript and history.`;

export const generateChatResponse = async (
  contextTranscript: string,
  chatHistory: BackendChatMessage[] // Expects history including the latest user message
): Promise<string> => {
  // --- Validation ---
  if (!contextTranscript && chatHistory.length <= 1) {
      console.warn("[OllamaService] Called with empty transcript and minimal history.");
      // Provide a helpful message if context is missing
      return "I need more context or a transcript to analyze. Please provide the session transcript or ask a general question if applicable.";
  }
   if (!chatHistory || chatHistory.length === 0) {
      console.error("[OllamaService] generateChatResponse called with empty chat history.");
      // This indicates a programming error upstream
      throw new Error("Internal Error: Cannot generate response without chat history.");
  }
  // --- End Validation ---

  console.log(`[OllamaService] Generating response for ${chatHistory.length} messages using model '${config.ollama.model}'...`);

  // --- Message Formatting ---
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    // Provide transcript context as a distinct user message
    {
        role: 'user',
        content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript provided.'}\n"""\n\nCHAT HISTORY STARTS BELOW:`
    },
    // Map chat history to Ollama message format
    ...chatHistory.map((msg): Message => ({
      role: msg.sender === 'ai' ? 'assistant' : 'user',
      content: msg.text,
    })),
    // The latest user message is assumed to be the last element in chatHistory
  ];
  // --- End Message Formatting ---

  // Log message count for debugging (don't log content)
  console.log(`[OllamaService] Sending ${messages.length} total messages (system, context, history) to Ollama.`);

  try {
    // --- Direct Ollama API Call ---
    const response: ChatResponse = await ollama.chat({
      model: config.ollama.model,
      messages: messages,
      stream: false, // Request full response, not stream
      keep_alive: config.ollama.keepAlive, // Let Ollama manage model loading duration
      // host: config.ollama.baseURL, // Explicitly set host if needed (overrides env var/default)
    });
    // --- End Direct Ollama API Call ---

    // --- Response Validation ---
     if (!response || !response.message || typeof response.message.content !== 'string') {
        console.error('[OllamaService] Received invalid response structure from Ollama:', response);
        throw new Error('Received invalid response structure from AI service.');
    }
    // --- End Response Validation ---

    // Log success and duration if available
    const durationInfo = response.total_duration ? ` (${(response.total_duration / 1e9).toFixed(2)}s)` : '';
    console.log(`[OllamaService] Response received successfully${durationInfo}.`);

    return response.message.content.trim(); // Return trimmed content

  } catch (error) {
    // --- Error Handling ---
    console.error('[OllamaService] Error interacting with Ollama:', error);
    if (error instanceof Error) {
        // Check for common connection/network errors (works in Node.js)
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
             throw new Error(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}. Ensure Ollama is running and accessible.`);
        }
        // Check for model not found errors (common Ollama error message patterns)
        if (error.message.toLowerCase().includes('model') && (error.message.toLowerCase().includes('not found') || error.message.toLowerCase().includes('missing'))) {
             throw new Error(`Ollama model '${config.ollama.model}' not found or is missing. Please ensure the model is available (e.g., run 'ollama pull ${config.ollama.model}').`);
        }
         // Check for timeout errors
         if (error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout')) {
             throw new Error('The request to the AI service timed out. Ollama might be busy or the request too complex.');
         }
         // Handle other potential errors from the Ollama library if known
         // e.g., if (error.message.includes('some specific ollama error')) { ... }
    }
    // Generic fallback error if specific checks don't match
    throw new Error('Failed to get response from AI service due to an unexpected error.');
    // --- End Error Handling ---
  }
};
