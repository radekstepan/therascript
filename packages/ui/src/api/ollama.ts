// =========================================
// File: packages/ui/src/api/ollama.ts
// NEW FILE - Contains API calls related to Ollama Management
// =========================================
import axios from 'axios';
import type {
    OllamaStatus,
    AvailableModelsResponse,
    UIPullJobStatus,
} from '../types';

// POST /api/ollama/unload
export const unloadOllamaModel = async (): Promise<{ message: string }> => {
    const response = await axios.post('/api/ollama/unload');
    return response.data;
};

// GET /api/ollama/status
export const fetchOllamaStatus = async (modelName?: string): Promise<OllamaStatus> => {
    const endpoint = '/api/ollama/status';
    const params = modelName ? { modelName } : {};
    const response = await axios.get<OllamaStatus>(endpoint, { params });
    return response.data;
};

// GET /api/ollama/available-models
export const fetchAvailableModels = async (): Promise<AvailableModelsResponse> => {
    const response = await axios.get<AvailableModelsResponse>('/api/ollama/available-models');
    return response.data;
};

// POST /api/ollama/set-model
export const setOllamaModel = async (modelName: string, contextSize?: number | null): Promise<{ message: string }> => {
    const payload = { modelName, contextSize: contextSize === undefined || (contextSize ?? 0) <= 0 ? null : contextSize };
    const response = await axios.post('/api/ollama/set-model', payload);
    return response.data;
};

// POST /api/ollama/pull-model
export const startPullOllamaModel = async (modelName: string): Promise<{ jobId: string }> => {
    const response = await axios.post<{ jobId: string; message: string }>('/api/ollama/pull-model', { modelName });
    if (response.status !== 202 || !response.data.jobId) throw new Error(`Failed to start pull job.`);
    return { jobId: response.data.jobId };
};

// GET /api/ollama/pull-status/{jobId}
export const fetchPullOllamaModelStatus = async (jobId: string): Promise<UIPullJobStatus> => {
     if (!jobId) throw new Error("Cannot fetch status without a Job ID.");
     const response = await axios.get<UIPullJobStatus>(`/api/ollama/pull-status/${jobId}`);
     if (!response.data || typeof response.data !== 'object' || !response.data.jobId || !response.data.status) throw new Error("Received invalid status object from API");
     return response.data;
 };

// POST /api/ollama/cancel-pull/{jobId}
export const cancelPullOllamaModel = async (jobId: string): Promise<{ message: string }> => {
     if (!jobId) throw new Error("Cannot cancel job without a Job ID.");
     const response = await axios.post<{ message: string }>(`/api/ollama/cancel-pull/${jobId}`);
     return response.data;
 };

// POST /api/ollama/delete-model
export const deleteOllamaModel = async (modelName: string): Promise<{ message: string }> => {
    const response = await axios.post<{ message: string }>('/api/ollama/delete-model', { modelName });
    return response.data;
};
