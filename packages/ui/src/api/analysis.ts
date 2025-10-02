// packages/ui/src/api/analysis.ts
import axios from 'axios';
import type { AnalysisJob } from '../types';

interface CreateJobPayload {
  sessionIds: number[];
  prompt: string;
  modelName?: string | null;
  contextSize?: number | null;
}

/**
 * Creates a new multi-session analysis job.
 * @param data - The session IDs, prompt, and optional model settings.
 * @returns A promise resolving to an object containing the new job ID.
 */
export const createAnalysisJob = async (
  data: CreateJobPayload
): Promise<{ jobId: number }> => {
  const response = await axios.post('/api/analysis-jobs', data);
  return response.data;
};

/**
 * Fetches all analysis jobs.
 * @returns A promise resolving to an array of analysis jobs.
 */
export const fetchAnalysisJobs = async (): Promise<AnalysisJob[]> => {
  const response = await axios.get<AnalysisJob[]>('/api/analysis-jobs');
  return response.data;
};

/**
 * Fetches a single analysis job by its ID.
 * @param jobId - The ID of the job to fetch.
 * @returns A promise resolving to the analysis job.
 */
export const fetchAnalysisJob = async (jobId: number): Promise<AnalysisJob> => {
  const response = await axios.get<AnalysisJob>(`/api/analysis-jobs/${jobId}`);
  return response.data;
};

/**
 * Requests to cancel a running analysis job.
 * @param jobId - The ID of the job to cancel.
 * @returns A promise resolving to a confirmation message.
 */
export const cancelAnalysisJob = async (
  jobId: number
): Promise<{ message: string }> => {
  const response = await axios.post(`/api/analysis-jobs/${jobId}/cancel`);
  return response.data;
};

/**
 * Deletes an analysis job and all its associated data.
 * @param jobId - The ID of the job to delete.
 * @returns A promise resolving to a confirmation message.
 */
export const deleteAnalysisJob = async (
  jobId: number
): Promise<{ message: string }> => {
  const response = await axios.delete(`/api/analysis-jobs/${jobId}`);
  return response.data;
};
