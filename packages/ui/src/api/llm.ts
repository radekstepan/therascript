// Purpose: Contains functions for interacting with the backend API endpoints
//          related to Llm language model management.
import axios from 'axios'; // Import Axios for making HTTP requests
import type {
  LlmStatus, // Status of the currently active model
  AvailableModelsResponse, // Response structure for listing available models
  UIDownloadJobStatus, // UI-specific type for download job status
} from '../types'; // Import type definitions

/**
 * Sends a request to the backend to unload the currently active Llm model from memory.
 * Makes a POST request to `/api/llm/unload`.
 *
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const unloadLlmModel = async (): Promise<{ message: string }> => {
  const response = await axios.post('/api/llm/unload');
  return response.data;
};

/**
 * Fetches the status of the Llm service and optionally a specific model.
 * Makes a GET request to `/api/llm/status` with an optional `modelName` query parameter.
 *
 * @param {string} [modelName] - Optional name of a specific model to check the loaded status for. If omitted, checks the active model.
 * @returns {Promise<LlmStatus>} A promise resolving to the Llm status object.
 * @throws {Error} If the API request fails.
 */
export const fetchLlmStatus = async (
  modelName?: string
): Promise<LlmStatus> => {
  const endpoint = '/api/llm/status';
  const params = modelName ? { modelName } : {}; // Construct query parameters if modelName is provided
  const response = await axios.get<LlmStatus>(endpoint, { params });
  return response.data;
};

/**
 * Fetches the list of locally available Llm models from the backend.
 * Makes a GET request to `/api/llm/available-models`.
 *
 * @returns {Promise<AvailableModelsResponse>} A promise resolving to the list of available models.
 * @throws {Error} If the API request fails.
 */
export const fetchAvailableModels =
  async (): Promise<AvailableModelsResponse> => {
    const response = await axios.get<AvailableModelsResponse>(
      '/api/llm/available-models'
    );
    return response.data;
  };

/**
 * Sends a request to the backend to set the active Llm model and optionally its context size.
 * This triggers the backend to load the specified model.
 * Makes a POST request to `/api/llm/set-model`.
 *
 * @param {string} modelName - The name of the model to set as active.
 * @param {number | null} [contextSize] - Optional context window size (num_ctx). Null or <= 0 means use Llm's default.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const setLlmModel = async (
  modelName: string,
  contextSize?: number | null,
  temperature?: number,
  topP?: number,
  repeatPenalty?: number,
  numGpuLayers?: number | null,
  thinkingBudget?: number | null
): Promise<{ message: string }> => {
  // Prepare payload, ensuring contextSize is null if invalid or not provided
  const payload = {
    modelName,
    contextSize:
      contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize,
    temperature,
    topP,
    repeatPenalty,
    numGpuLayers: numGpuLayers ?? null,
    thinkingBudget: thinkingBudget ?? null,
  };
  const response = await axios.post('/api/llm/set-model', payload);
  return response.data;
};

/**
 * Initiates a background job on the backend to download a GGUF model from a URL.
 * Makes a POST request to `/api/llm/pull-model`.
 *
 * @param {string} modelUrl - The URL of the GGUF model to download.
 * @returns {Promise<{ jobId: string }>} A promise resolving to the job ID for status polling.
 * @throws {Error} If the API request fails or doesn't return a valid job ID (e.g., status is not 202).
 */
export const startDownloadLlmModel = async (
  modelUrl: string
): Promise<{ jobId: string }> => {
  // Expecting a 202 Accepted response with a jobId and message
  const response = await axios.post<{ jobId: string; message: string }>(
    '/api/llm/pull-model',
    { modelUrl }
  );
  // Validate the response status and presence of jobId
  if (response.status !== 202 || !response.data.jobId) {
    throw new Error(
      `Failed to start pull job. API responded with status ${response.status}.`
    );
  }
  return { jobId: response.data.jobId }; // Return only the jobId
};

/**
 * Fetches the status and progress of an ongoing Llm model pull job from the backend.
 * Makes a GET request to `/api/llm/pull-status/{jobId}`.
 *
 * @param {string} jobId - The ID of the pull job to check.
 * @returns {Promise<UIDownloadJobStatus>} A promise resolving to the pull job status object.
 * @throws {Error} If the jobId is missing, the API request fails, or the response structure is invalid.
 */
export const fetchDownloadLlmModelStatus = async (
  jobId: string
): Promise<UIDownloadJobStatus> => {
  if (!jobId) throw new Error('Cannot fetch status without a Job ID.');
  // Make GET request to the specific job status endpoint
  const response = await axios.get<UIDownloadJobStatus>(
    `/api/llm/pull-status/${jobId}`
  );
  // Basic validation of the response structure
  if (
    !response.data ||
    typeof response.data !== 'object' ||
    !response.data.jobId ||
    !response.data.status
  ) {
    throw new Error('Received invalid status object from API');
  }
  return response.data;
};

/**
 * Sends a request to the backend to cancel an ongoing Llm model pull job.
 * Makes a POST request to `/api/llm/cancel-pull/{jobId}`.
 *
 * @param {string} jobId - The ID of the pull job to cancel.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the jobId is missing or the API request fails.
 */
export const cancelDownloadLlmModel = async (
  jobId: string
): Promise<{ message: string }> => {
  if (!jobId) throw new Error('Cannot cancel job without a Job ID.');
  const response = await axios.post<{ message: string }>(
    `/api/llm/cancel-pull/${jobId}`
  );
  return response.data;
};

/**
 * Sends a request to the backend to delete a locally downloaded Llm model.
 * Makes a POST request to `/api/llm/delete-model`.
 *
 * @param {string} modelName - The name of the model to delete.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const deleteLlmModel = async (
  modelName: string
): Promise<{ message: string }> => {
  const response = await axios.post<{ message: string }>(
    '/api/llm/delete-model',
    { modelName }
  );
  return response.data;
};

export const estimateModelVram = async (
  modelName: string,
  contextSize?: number | null,
  numGpuLayers?: number | null
): Promise<{
  model: string;
  context_size: number | null;
  num_gpu_layers?: number | null;
  estimated_vram_bytes: number | null;
  estimated_ram_bytes: number | null;
  vram_per_token_bytes: number | null;
  breakdown?: {
    weights_bytes: number;
    weights_vram_bytes: number;
    weights_ram_bytes: number;
    kv_cache_bytes: number;
    overhead_bytes: number;
  };
  error?: string;
}> => {
  const params: Record<string, any> = {};
  if (contextSize !== undefined && contextSize !== null) {
    params.context_size = contextSize;
  }
  if (numGpuLayers !== undefined && numGpuLayers !== null) {
    params.num_gpu_layers = numGpuLayers;
  }
  const response = await axios.get(
    `/api/llm/models/${encodeURIComponent(modelName)}/estimate-vram`,
    { params }
  );
  return response.data;
};
