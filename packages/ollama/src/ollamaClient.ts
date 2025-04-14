import axios, { AxiosError } from 'axios';
import { OLLAMA_SERVICE_NAME } from './dockerManager';

// Default to localhost as the script runs on the host now
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
}

// Interface for Ollama API chat request payload
export interface OllamaChatRequest {
    model: string;
    messages: OllamaMessage[];
    stream?: boolean;
    options?: OllamaChatOptions;
    // format?: 'json';
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
    payload.stream = false;

    try {
        console.log(`\n🤖 Sending request to Ollama (${payload.model}) at ${OLLAMA_URL}...`);
        // TODO can we get a streaming response that can be cancelled?
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
            if (axiosError.code === 'ECONNREFUSED') {
                 console.error(`❗ Connection refused. Is the Ollama Docker container running and accessible at ${OLLAMA_URL}?`);
                 console.error(`   Try running 'docker compose ps' or check Docker Desktop.`);
            } else if (axiosError.response) {
                console.error(`Status: ${axiosError.response.status}`);
                console.error("Data:", axiosError.response.data);
                if (axiosError.response.status === 404 && typeof axiosError.response.data === 'object' && axiosError.response.data && 'error' in axiosError.response.data) {
                    const errorData = axiosError.response.data as { error: string };
                    if (errorData.error.includes('model') && errorData.error.includes('not found')) {
                        console.error(`❗ Model "${payload.model}" not found. Make sure it's pulled.`);
                        // Use the imported variable here
                        console.error(`  Use the 'Pull Model' option or run: docker compose exec ${OLLAMA_SERVICE_NAME} ollama pull ${payload.model}`);
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
        throw new Error(`Failed to get response from Ollama. Is the server running and model '${payload.model}' available?`);
    }
}

// Function to list locally available models (communicates via API)
export async function listLocalModels(): Promise<string[]> {
    try {
        const response = await axios.get<{ models: { name: string }[] }>(`${OLLAMA_URL}/api/tags`);
        return response.data.models.map(m => m.name);
    } catch (error) {
        console.error("❌ Error fetching local models from Ollama API.");
        if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
             console.error(`❗ Connection refused. Is the Ollama Docker container running at ${OLLAMA_URL}?`);
        } else {
            // console.error(error); // Could be verbose
        }
        return [];
    }
}
