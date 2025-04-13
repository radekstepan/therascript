import axios, { AxiosError } from 'axios';

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Interface for Ollama API message structure
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // Optional for multimodal models
}

// Interface for Ollama API chat request options
export interface OllamaChatOptions {
  temperature?: number;
  num_ctx?: number; // Context window size
  // Add other options from Ollama API documentation if needed
  // e.g., top_k, top_p, seed, etc.
}

// Interface for Ollama API chat request payload
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: OllamaChatOptions;
  // format?: 'json'; // Uncomment if you need JSON output
}

// Interface for Ollama API chat response (non-streaming)
export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export async function sendChatRequest(payload: OllamaChatRequest): Promise<OllamaChatResponse> {
    // Ensure streaming is off for a single response
    payload.stream = false;

    try {
        console.log(`\n🤖 Sending request to Ollama (${payload.model})...`);
        const response = await axios.post<OllamaChatResponse>(
            `${OLLAMA_URL}/api/chat`,
            payload,
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log("✅ Ollama response received.");
        return response.data;
    } catch (error) {
        console.error("❌ Error communicating with Ollama API:");
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error(`Status: ${axiosError.response.status}`);
                console.error("Data:", axiosError.response.data);
                // Specific check for model not found
                if (axiosError.response.status === 404 && typeof axiosError.response.data === 'object' && axiosError.response.data && 'error' in axiosError.response.data) {
                     const errorData = axiosError.response.data as { error: string };
                     if (errorData.error.includes('model') && errorData.error.includes('not found')) {
                         console.error(`❗ Model "${payload.model}" not found. Make sure it's pulled.`);
                         console.error(`  Run: docker-compose exec ollama ollama pull ${payload.model}`);
                     }
                }

            } else if (axiosError.request) {
                console.error("No response received:", axiosError.request);
            } else {
                console.error('Error', axiosError.message);
            }
        } else {
            console.error("Unexpected error:", error);
        }
         // Re-throw a simplified error or handle it more gracefully
        throw new Error(`Failed to get response from Ollama. Is the model '${payload.model}' available?`);
    }
}

// Optional: Function to list locally available models
export async function listLocalModels(): Promise<string[]> {
    try {
        const response = await axios.get<{ models: { name: string }[] }>(`${OLLAMA_URL}/api/tags`);
        return response.data.models.map(m => m.name);
    } catch (error) {
         console.error("❌ Error fetching local models:", error);
         return [];
    }
}
