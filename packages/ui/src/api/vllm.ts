// packages/ui/src/api/vllm.ts
import axios from 'axios';
import type { OllamaStatus, AvailableModelsResponse } from '../types';

/**
 * Fetches the status of the vLLM service and the model it is serving.
 * Makes a GET request to `/api/vllm/status`.
 * @param {string} [modelName] - Optional name of a specific model to check the loaded status for.
 * @returns {Promise<OllamaStatus>} A promise resolving to the vLLM status object.
 */
export const fetchVllmStatus = async (
  modelName?: string
): Promise<OllamaStatus> => {
  const endpoint = '/api/vllm/status';
  const params = modelName ? { modelName } : {};
  const response = await axios.get<OllamaStatus>(endpoint, { params });
  return response.data;
};

/**
 * Fetches the list of available models from the vLLM service via the backend.
 * Makes a GET request to `/api/vllm/available-models`.
 * @returns {Promise<AvailableModelsResponse>} A promise resolving to the list of available models.
 */
export const fetchAvailableModels =
  async (): Promise<AvailableModelsResponse> => {
    const response = await axios.get<AvailableModelsResponse>(
      '/api/vllm/available-models'
    );
    return response.data;
  };

/**
 * Sends a request to the backend to set the active model name and optionally its context size.
 * This does NOT restart the vLLM service but tells the API which model to request.
 * Makes a POST request to `/api/vllm/set-model`.
 * @param {string} modelName - The name of the model to set as active.
 * @param {number | null} [contextSize] - Optional context window size.
 * @returns {Promise<{ message: string }>} A promise resolving to a confirmation message.
 */
export const setVllmModel = async (
  modelName: string,
  contextSize?: number | null
): Promise<{ message: string }> => {
  const payload = {
    modelName,
    contextSize:
      contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize,
  };
  const response = await axios.post('/api/vllm/set-model', payload);
  return response.data;
};
