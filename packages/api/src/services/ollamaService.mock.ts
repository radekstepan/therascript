/* packages/api/src/services/ollamaService.mock.ts */
import type { ChatResponse, ListResponse, ProgressResponse } from 'ollama'; // Keep ChatResponse
// --- Use imported types from central location ---
import type { BackendChatMessage, OllamaModelInfo, OllamaPullJobStatus, OllamaPullJobStatusState } from '../types/index.js';
// --- End Import ---
import { NotFoundError, BadRequestError, InternalServerError } from '../errors.js';
import config from '../config/index.js';
import { getActiveModel, getConfiguredContextSize } from './activeModelService.js';

// --- Mock Configuration ---
const MOCK_DELAY_MS = parseInt(process.env.MOCK_OLLAMA_DELAY_MS || '800', 10);
const MOCK_MODEL_NAME = process.env.MOCK_LLM_MODEL_NAME || 'mock-llama3:latest';

// --- Mock Data ---
const mockModels: OllamaModelInfo[] = [
    {
        name: MOCK_MODEL_NAME,
        modified_at: new Date(Date.now() - 86400000),
        size: 1500000000, digest: 'mockdigest123',
        details: { format: 'gguf', family: 'llama', families: ['llama'], parameter_size: '1B', quantization_level: 'Q4_0', },
    },
    {
        name: 'mock-alt-model:7b',
        modified_at: new Date(Date.now() - 172800000),
        size: 7000000000, digest: 'mockdigest456',
        details: { format: 'gguf', family: 'mistral', families: ['mistral'], parameter_size: '7B', quantization_level: 'Q5_K_M', },
    },
];
let mockLoadedModel: string | null = null;
const mockPullJobs = new Map<string, OllamaPullJobStatus>();

console.log('[Mock Service] Using Mock Ollama Service');

// --- Mock Service Implementation ---

export const listModels = async (): Promise<OllamaModelInfo[]> => {
    console.log(`[Mock Ollama] Request to list available models.`);
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 5));
    return mockModels.map(m => ({ ...m }));
};

export const checkModelStatus = async (modelToCheck: string): Promise<OllamaModelInfo | null | { status: 'unavailable' }> => {
    console.log(`[Mock Ollama] Checking if model '${modelToCheck}' is loaded.`);
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 10));
    if (modelToCheck === mockLoadedModel) {
        const modelInfo = mockModels.find(m => m.name === modelToCheck);
        console.log(`[Mock Ollama] Model '${modelToCheck}' is currently loaded (mock).`);
        return modelInfo ? { ...modelInfo } : null;
    }
    console.log(`[Mock Ollama] Model '${modelToCheck}' is not loaded (mock).`);
    return null;
};

export const loadOllamaModel = async (modelName: string): Promise<void> => {
    console.log(`[Mock Ollama] Request to load model '${modelName}'...`);
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS));
    const exists = mockModels.some(m => m.name === modelName);
    if (!exists) {
        throw new BadRequestError(`Mock Model '${modelName}' not found locally.`);
    }
    mockLoadedModel = modelName;
    console.log(`[Mock Ollama] Successfully loaded model '${modelName}' (mock).`);
};

export const ensureOllamaReady = async (timeoutMs = 30000): Promise<void> => {
    console.log("[Mock Ollama] Ensuring Ollama service is ready (mock)... always ready.");
    await new Promise(resolve => setTimeout(resolve, 50)); // Tiny delay
    return Promise.resolve();
};

export const reloadActiveModelContext = async (): Promise<void> => {
    const modelName = getActiveModel();
    console.log(`[Mock Ollama] Attempting to reload context for active model: ${modelName} (mock).`);
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 3));
    mockLoadedModel = modelName;
    console.log(`[Mock Ollama] Context reloaded for ${modelName} (mock).`);
};

export const streamChatResponse = async (
    contextTranscript: string | null,
    chatHistory: BackendChatMessage[]
): Promise<AsyncIterable<ChatResponse>> => {
    const modelToUse = getActiveModel();
    const contextSize = getConfiguredContextSize();
    const isStandalone = contextTranscript === null;
    console.log(`[Mock Ollama] Starting STREAM chat (${isStandalone ? 'standalone' : 'session'}) with model: ${modelToUse}, Context: ${contextSize ?? 'default'}`);
    const lastUserMessage = chatHistory[chatHistory.length - 1]?.text || "No message found";

    const mockResponseText = `This is a mocked streaming response to: "${lastUserMessage.substring(0, 50)}${lastUserMessage.length > 50 ? '...' : ''}". The mock model (${modelToUse}) processed this.`;
    const words = mockResponseText.split(' ');

    async function* generateMockStream(): AsyncIterable<ChatResponse> {
        await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 4)); // Initial delay
        let fullContent = '';
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const isLast = i === words.length - 1;
            const chunkContent = word + (isLast ? '' : ' ');
            fullContent += chunkContent;

            // --- FIX: Provide default 0 values for numeric fields ---
            yield {
                model: modelToUse,
                created_at: new Date(),
                message: { role: 'assistant', content: chunkContent },
                done: false,
                // Add missing optional fields with default 0 for numbers
                done_reason: '', // done_reason likely okay as undefined when done: false
                total_duration: 0,
                load_duration: 0,
                prompt_eval_count: 0,
                prompt_eval_duration: 0,
                eval_count: 0,
                eval_duration: 0,
            };
            // --- End FIX ---
            await new Promise(resolve => setTimeout(resolve, 50)); // Delay between words
        }

        // Yield the final 'done' message with all required fields
        yield {
            model: modelToUse,
            created_at: new Date(),
            message: { role: 'assistant', content: '' },
            done: true,
            done_reason: 'stop', // Add a reason for stopping
            total_duration: MOCK_DELAY_MS * 1000000,
            load_duration: 50 * 1000000,
            prompt_eval_count: 20,
            prompt_eval_duration: 100 * 1000000,
            eval_count: words.length * 2,
            eval_duration: (MOCK_DELAY_MS - 150) * 1000000,
        };
        console.log(`[Mock Ollama Stream] Finished streaming for: "${lastUserMessage.substring(0, 30)}..."`);
    }

    return generateMockStream();
};

// --- Mock Pull Job Logic ---
export const startPullModelJob = (modelName: string): string => {
    if (!modelName || !modelName.trim()) throw new BadRequestError("Invalid model name provided.");
    const jobId = `mock-pull-job-${Date.now()}`;
    console.log(`[Mock Ollama] Queuing pull job ${jobId} for model: ${modelName}`);
    const jobStartTime = Date.now();
    const jobData: OllamaPullJobStatus = { jobId, modelName, status: 'queued', message: 'Pull queued', startTime: jobStartTime, progress: 0 };
    mockPullJobs.set(jobId, jobData);

    // Simulate progress with checks
    setTimeout(() => {
        const currentJob = mockPullJobs.get(jobId);
        if (currentJob?.status === 'queued') {
            currentJob.status = 'downloading';
            currentJob.message = 'Downloading...';
            currentJob.progress = 10;
            console.log(`[Mock Pull BG ${jobId}] Status -> downloading (10%)`);
        }
    }, 500);
    setTimeout(() => {
        const currentJob = mockPullJobs.get(jobId);
        if (currentJob?.status === 'downloading') {
            currentJob.progress = 55;
            currentJob.message = 'Downloading layer...';
            console.log(`[Mock Pull BG ${jobId}] Status -> downloading (55%)`);
        }
    }, 1500);
    setTimeout(() => {
        const currentJob = mockPullJobs.get(jobId);
        if (currentJob?.status === 'downloading') {
            currentJob.status = 'verifying';
            currentJob.message = 'Verifying digest...';
            currentJob.progress = 95;
            console.log(`[Mock Pull BG ${jobId}] Status -> verifying (95%)`);
        }
    }, 2500);
    setTimeout(() => {
        const currentJob = mockPullJobs.get(jobId);
        if (currentJob?.status === 'verifying') {
            currentJob.status = 'completed';
            currentJob.message = 'Pull complete.';
            currentJob.progress = 100;
            currentJob.endTime = Date.now();
            console.log(`[Mock Pull BG ${jobId}] Status -> completed`);
        }
    }, 3000);

    return jobId;
};

export const getPullModelJobStatus = (jobId: string): OllamaPullJobStatus | null => {
    const status = mockPullJobs.get(jobId);
    console.log(`[Mock Ollama] Getting status for pull job ${jobId}. Found: ${!!status}`);
    return status ? { ...status } : null; // Return copy or null
};

export const cancelPullModelJob = (jobId: string): boolean => {
     const job = mockPullJobs.get(jobId);
     if (!job) { console.log(`[Mock Ollama] Cancel request for non-existent job ${jobId}`); return false; }
     if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') { console.log(`[Mock Ollama] Job ${jobId} is already terminal (${job.status}), cannot cancel.`); return false; }
     console.log(`[Mock Ollama] Cancelling job ${jobId}`);
     job.status = 'canceled';
     job.message = 'Pull canceled by user.';
     job.endTime = Date.now();
     return true;
};

export const deleteOllamaModel = async (modelName: string): Promise<string> => {
    console.log(`[Mock Ollama] Request to delete model '${modelName}'...`);
    await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 2));
    const modelIndex = mockModels.findIndex(m => m.name === modelName);
    if (modelIndex === -1) {
        throw new NotFoundError(`Mock Model '${modelName}' not found locally.`);
    }
    if (mockLoadedModel === modelName) {
         mockLoadedModel = null; // Unload if it was loaded
         console.log(`[Mock Ollama] Unloaded model '${modelName}' during delete.`);
    }
    mockModels.splice(modelIndex, 1);
    console.log(`[Mock Ollama] Successfully deleted model '${modelName}'.`);
    return `Model '${modelName}' deleted successfully.`;
};
