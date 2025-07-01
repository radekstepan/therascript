import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  // FIX: Correct the import path for the creation parameters type.
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type { Model } from 'openai/resources/models';

// Extract error classes from the OpenAI main export for robust type guarding.
const { APIConnectionError, APIError } = OpenAI;

// Load configuration from environment variables
const VLLM_BASE_URL = process.env.VLLM_BASE_URL || 'http://localhost:8000/v1';
const VLLM_API_KEY = process.env.VLLM_API_KEY || 'not-needed';

// --- OpenAI Client Initialization ---
let client: OpenAI;
try {
  client = new OpenAI({
    baseURL: VLLM_BASE_URL,
    apiKey: VLLM_API_KEY,
  });
  console.log(`[vLLM Client] Initialized for base URL: ${VLLM_BASE_URL}`);
} catch (error) {
  console.error('[vLLM Client] Failed to initialize OpenAI client:', error);
  throw error;
}

// Re-export types for convenience in other modules
export type VllmMessageParam = ChatCompletionMessageParam;
export type VllmMessage = ChatCompletionMessage;

// Interface for vLLM-specific extra parameters
export interface VllmExtraParams {
  guided_choice?: string[];
}

/**
 * Sends a chat completion request to the vLLM server.
 * @param payload The request payload, including model, messages, and any extra parameters.
 * @returns The resulting chat completion from the assistant.
 * @throws An error if the request fails.
 */
export async function sendChatRequest(payload: {
  model: string;
  messages: VllmMessageParam[];
  stream?: false;
  temperature?: number;
  max_tokens?: number;
  extra_body?: VllmExtraParams;
}): Promise<ChatCompletion> {
  try {
    console.log(
      `\n🚀 Sending request to vLLM (${payload.model}) at ${VLLM_BASE_URL}...`
    );

    const requestParams = {
      model: payload.model,
      messages: payload.messages,
      stream: false,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
      ...(payload.extra_body && { extra_body: payload.extra_body }),
    };

    const response = await client.chat.completions.create(
      requestParams as ChatCompletionCreateParamsNonStreaming
    );

    console.log('✅ vLLM response received.');
    return response;
  } catch (error) {
    console.error('❌ Error communicating with vLLM API:');
    if (error instanceof APIConnectionError) {
      console.error(
        `🔌 Connection refused. Is the vLLM Docker container running and accessible at ${VLLM_BASE_URL}?`
      );
      console.error(
        `   Try running 'npm run docker:logs' or check Docker Desktop.`
      );
    } else if (error instanceof APIError) {
      console.error(`API Error Status: ${error.status}`);
      console.error('Error Details:', error.error);
      if (
        error.status === 404 &&
        error.message.toLowerCase().includes('model not found')
      ) {
        console.error(
          `❓ Model "${payload.model}" not found. Make sure the 'VLLM_MODEL' in your .env file is correct and the server has started successfully.`
        );
      }
    } else {
      console.error('An unexpected error occurred:', error);
    }
    throw new Error(
      `Failed to get response from vLLM. Is the server running and is model '${payload.model}' available?`
    );
  }
}

/**
 * Fetches the list of available models from the vLLM server.
 * Since the server is typically configured with one model, this will usually return a single item.
 * @returns A promise that resolves to an array of model ID strings.
 */
export async function listAvailableModels(): Promise<string[]> {
  try {
    const response = await client.models.list();
    return response.data.map((m: Model) => m.id);
  } catch (error) {
    console.error('❌ Error fetching available models from vLLM API.');
    if (error instanceof APIConnectionError) {
      console.error(
        `🔌 Connection refused. Is the vLLM Docker container running at ${VLLM_BASE_URL}?`
      );
    }
    return [];
  }
}
