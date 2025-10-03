// packages/ui/src/api/transcription.ts
import axios from 'axios';
import type { UITranscriptionStatus } from '../types';

// Re-export the type for convenience
export type { UITranscriptionStatus };

/**
 * Fetches the current transcription status for a given job ID
 * @param jobId - The job ID to check status for
 * @returns Promise<UITranscriptionStatus> - The current transcription status
 */
export const fetchTranscriptionStatus = async (
  jobId: string
): Promise<UITranscriptionStatus> => {
  try {
    const response = await axios.get(`/api/transcription/status/${jobId}`);
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error('Transcription job not found');
    }
    throw new Error(`Failed to fetch transcription status: ${error.message}`);
  }
};
