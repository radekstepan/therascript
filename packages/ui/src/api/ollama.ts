// Purpose: Contains functions for interacting with the backend API endpoints
//          related to Ollama language model management.
import axios from 'axios'; // Import Axios for making HTTP requests
import type {
  OllamaStatus, // Status of the currently active model
  AvailableModelsResponse, // Response structure for listing available models
  UIPullJobStatus, // UI-specific type for pull job status
} from '../types'; // Import type definitions

/**
 * Sends a request to the backend to unload the currently active Ollama model from memory.
 * Makes a POST request to `/api/ollama/unload`.
 *
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const unloadOllamaModel = async (): Promise<{ message: string }> => {
  const response = await axios.post('/api/ollama/unload');
  return response.data;
};

/**
 * Fetches the status of the Ollama service and optionally a specific model.
 * Makes a GET request to `/api/ollama/status` with an optional `modelName` query parameter.
 *
 * @param {string} [modelName] - Optional name of a specific model to check the loaded status for. If omitted, checks the active model.
 * @returns {Promise<OllamaStatus>} A promise resolving to the Ollama status object.
 * @throws {Error} If the API request fails.
 */
export const fetchOllamaStatus = async (
  modelName?: string
): Promise<OllamaStatus> => {
  const endpoint = '/api/ollama/status';
  const params = modelName ? { modelName } : {}; // Construct query parameters if modelName is provided
  const response = await axios.get<OllamaStatus>(endpoint, { params });
  return response.data;
};

/**
 * Fetches the list of locally available Ollama models from the backend.
 * Makes a GET request to `/api/ollama/available-models`.
 *
 * @returns {Promise<AvailableModelsResponse>} A promise resolving to the list of available models.
 * @throws {Error} If the API request fails.
 */
export const fetchAvailableModels =
  async (): Promise<AvailableModelsResponse> => {
    const response = await axios.get<AvailableModelsResponse>(
      '/api/ollama/available-models'
    );
    return response.data;
  };

/**
 * Sends a request to the backend to set the active Ollama model and optionally its context size.
 * This triggers the backend to load the specified model.
 * Makes a POST request to `/api/ollama/set-model`.
 *
 * @param {string} modelName - The name of the model to set as active.
 * @param {number | null} [contextSize] - Optional context window size (num_ctx). Null or <= 0 means use Ollama's default.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const setOllamaModel = async (
  modelName: string,
  contextSize?: number | null
): Promise<{ message: string }> => {
  // Prepare payload, ensuring contextSize is null if invalid or not provided
  const payload = {
    modelName,
    contextSize:
      contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize,
  };
  const response = await axios.post('/api/ollama/set-model', payload);
  return response.data;
};

/**
 * Initiates a background job on the backend to pull (download) a new Ollama model.
 * Makes a POST request to `/api/ollama/pull-model`.
 *
 * @param {string} modelName - The name of the model to pull (e.g., "llama3:latest").
 * @returns {Promise<{ jobId: string }>} A promise resolving to the job ID for status polling.
 * @throws {Error} If the API request fails or doesn't return a valid job ID (e.g., status is not 202).
 */
export const startPullOllamaModel = async (
  modelName: string
): Promise<{ jobId: string }> => {
  // Expecting a 202 Accepted response with a jobId and message
  const response = await axios.post<{ jobId: string; message: string }>(
    '/api/ollama/pull-model',
    { modelName }
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
 * Fetches the status and progress of an ongoing Ollama model pull job from the backend.
 * Makes a GET request to `/api/ollama/pull-status/{jobId}`.
 *
 * @param {string} jobId - The ID of the pull job to check.
 * @returns {Promise<UIPullJobStatus>} A promise resolving to the pull job status object.
 * @throws {Error} If the jobId is missing, the API request fails, or the response structure is invalid.
 */
export const fetchPullOllamaModelStatus = async (
  jobId: string
): Promise<UIPullJobStatus> => {
  if (!jobId) throw new Error('Cannot fetch status without a Job ID.');
  // Make GET request to the specific job status endpoint
  const response = await axios.get<UIPullJobStatus>(
    `/api/ollama/pull-status/${jobId}`
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
 * Sends a request to the backend to cancel an ongoing Ollama model pull job.
 * Makes a POST request to `/api/ollama/cancel-pull/{jobId}`.
 *
 * @param {string} jobId - The ID of the pull job to cancel.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the jobId is missing or the API request fails.
 */
export const cancelPullOllamaModel = async (
  jobId: string
): Promise<{ message: string }> => {
  if (!jobId) throw new Error('Cannot cancel job without a Job ID.');
  const response = await axios.post<{ message: string }>(
    `/api/ollama/cancel-pull/${jobId}`
  );
  return response.data;
};

/**
 * Sends a request to the backend to delete a locally downloaded Ollama model.
 * Makes a POST request to `/api/ollama/delete-model`.
 *
 * @param {string} modelName - The name of the model to delete.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 * @throws {Error} If the API request fails.
 */
export const deleteOllamaModel = async (
  modelName: string
): Promise<{ message: string }> => {
  const response = await axios.post<{ message: string }>(
    '/api/ollama/delete-model',
    { modelName }
  );
  return response.data;
};
